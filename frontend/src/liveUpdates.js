/**
 * File purpose:
 * Loads recent finance rows from the backend and shows a spend trend chart with
 * related status text and details in the dashboard.
 */
const DEFAULT_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const DEFAULT_POLL_INTERVAL_MS = 60000;
const MAX_QUERY_ROWS = 1000;
const FINANCE_PATH_FILTER = "trusted/%/finance/transactions/";
const MIN_CHART_WIDTH = 680;
const MAX_CHART_WIDTH = 1180;
const MIN_CHART_HEIGHT = 250;
const MAX_CHART_HEIGHT = 320;
// Use the actual transaction date so spend is grouped by when it happened.
const FINANCE_DATE_FIELDS = [
  "transaction_date",
  "txn_ts",
  "event_time",
  "event_timestamp",
  "timestamp",
  "datetime",
  "date"
];
const AMOUNT_FIELDS = ["amount", "transaction_amount", "value", "total", "net_amount"];
const CATEGORY_FIELDS = ["category", "transaction_type", "type", "entry_type"];
const VENDOR_FIELDS = ["merchant", "merchant_name", "vendor", "vendor_name", "supplier", "payee", "counterparty", "description"];
const DEPARTMENT_FIELDS = ["department", "dept", "team", "division"];
const REVENUE_HINTS = ["revenue", "income", "credit", "sale", "sales", "deposit", "inflow", "received"];
const EXPENDITURE_HINTS = ["expense", "expenditure", "debit", "cost", "purchase", "withdrawal", "outflow", "payment"];
const WINDOW_OPTIONS = [7, 30, 90];
const FINANCE_TREND_MISSING_DATE_MESSAGE = "Finance trend unavailable: no transaction date column found.";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

let financeColumnsCache = null;

/**
 * Builds the auth header for finance requests.
 *
 * @param {(() => string) | undefined} getAuthToken
 * @returns {Record<string, string>}
 */
function buildAuthHeaders(getAuthToken) {
  const token = typeof getAuthToken === "function" ? String(getAuthToken() || "").trim() : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Sends a POST request to the backend query endpoint and reads the JSON response.
 *
 * @param {string} path
 * @param {unknown} body
 * @param {(() => string) | undefined} getAuthToken
 * @returns {Promise<any>}
 */
async function postJSON(path, body, getAuthToken) {
  const response = await fetch(`${DEFAULT_API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(getAuthToken)
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || `HTTP ${response.status}`);
  }
  return payload;
}

/**
 * Wraps a SQL name in quotes so the Athena query stays safe.
 *
 * @param {unknown} value
 * @returns {string}
 */
function quoteIdentifier(value) {
  return `"${String(value || "").replace(/"/g, "\"\"")}"`;
}

/**
 * Turns finance values into numbers when possible.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function parseNumeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const cleaned = value.trim().replaceAll(",", "").replaceAll("$", "");
    if (!cleaned) {
      return null;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/**
 * Turns finance dates into `Date` objects.
 *
 * @param {unknown} value
 * @returns {Date | null}
 */
function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    const numericValue = Number(trimmed);
    const ms = trimmed.length >= 13 ? numericValue : numericValue * 1000;
    const numericDate = new Date(ms);
    return Number.isNaN(numericDate.getTime()) ? null : numericDate;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Gets the first filled-in text field from a finance row.
 *
 * @param {Record<string, any>} record
 * @param {string[]} fields
 * @param {string} [fallback=""]
 * @returns {string}
 */
function extractField(record, fields, fallback = "") {
  for (const field of fields) {
    const value = record?.[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

/**
 * Finds the best transaction date to use from a finance row.
 *
 * @param {Record<string, any>} record
 * @returns {Date | null}
 */
function extractDate(record) {
  for (const field of FINANCE_DATE_FIELDS) {
    const parsed = parseDate(record?.[field]);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

/**
 * Finds the signed amount in a finance row.
 *
 * @param {Record<string, any>} record
 * @returns {number | null}
 */
function extractAmount(record) {
  for (const field of AMOUNT_FIELDS) {
    const parsed = parseNumeric(record?.[field]);
    if (parsed !== null) {
      return parsed;
    }
  }

  const credit = parseNumeric(record?.credit);
  const debit = parseNumeric(record?.debit);
  if (credit !== null || debit !== null) {
    return (credit || 0) - (debit || 0);
  }

  return null;
}

/**
 * Decides whether a row is revenue or spending.
 *
 * @param {Record<string, any>} record
 * @param {number} amount
 * @returns {"revenue" | "expenditure"}
 */
function classifyFinanceFlow(record, amount) {
  const hintText = [
    record?.transaction_type,
    record?.type,
    record?.category,
    record?.entry_type,
    record?.direction
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(" ")
    .toLowerCase();

  if (REVENUE_HINTS.some((token) => hintText.includes(token))) {
    return "revenue";
  }
  if (EXPENDITURE_HINTS.some((token) => hintText.includes(token))) {
    return "expenditure";
  }
  return amount >= 0 ? "revenue" : "expenditure";
}

/**
 * Turns raw finance rows into the shape the live spend chart uses.
 *
 * @param {Array<Record<string, any>>} rows
 * @returns {Array<Record<string, any>>}
 */
function normalizeFinanceRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((record) => {
      const signedAmount = extractAmount(record);
      const date = extractDate(record);
      if (!Number.isFinite(signedAmount)) {
        return null;
      }

      return {
        raw: record,
        date,
        dayKey: date ? date.toISOString().slice(0, 10) : "",
        signedAmount,
        amount: Math.abs(signedAmount),
        flow: classifyFinanceFlow(record, signedAmount),
        category: extractField(record, CATEGORY_FIELDS, "Other"),
        vendor: extractField(record, VENDOR_FIELDS, "Unlabelled vendor"),
        department: extractField(record, DEPARTMENT_FIELDS, "")
      };
    })
    .filter(Boolean);
}

/**
 * Checks which extra finance columns exist in the dataset.
 *
 * @param {string[]} columns
 * @returns {{ dateField: string, amountFields: string[], categoryField: string, vendorField: string, departmentField: string }}
 */
function discoverFinanceColumns(columns) {
  const available = new Set(columns || []);
  return {
    dateField: FINANCE_DATE_FIELDS.find((field) => available.has(field)) || "",
    amountFields: ["credit", "debit", ...AMOUNT_FIELDS].filter((field) => available.has(field)),
    categoryField: CATEGORY_FIELDS.find((field) => available.has(field)) || "",
    vendorField: VENDOR_FIELDS.find((field) => available.has(field)) || "",
    departmentField: DEPARTMENT_FIELDS.find((field) => available.has(field)) || ""
  };
}

/**
 * Builds the SQL query that fetches recent finance rows for the live chart.
 *
 * @param {string[]} columns
 * @param {number} [limit=MAX_QUERY_ROWS]
 * @returns {string | null}
 */
function buildFinanceRowsQuery(columns, limit = MAX_QUERY_ROWS) {
  const { dateField, amountFields, categoryField, vendorField, departmentField } = discoverFinanceColumns(columns);
  if (!dateField) {
    return null;
  }
  const projection = Array.from(
    new Set(
      [dateField, ...amountFields, categoryField, vendorField, departmentField]
        .filter(Boolean)
        .map((field) => quoteIdentifier(field))
    )
  );

  const selectedColumns = projection.length ? projection.join(", ") : "*";
  const orderClause = dateField ? ` ORDER BY ${quoteIdentifier(dateField)} DESC` : "";

  return `SELECT ${selectedColumns} FROM trusted WHERE "$path" LIKE '%/${FINANCE_PATH_FILTER}%'${orderClause} LIMIT ${limit}`;
}

/**
 * Looks up the finance columns once, then fetches the recent rows.
 *
 * @param {() => string} getAuthToken
 * @returns {Promise<Record<string, any>>}
 */
async function fetchFinanceRows(getAuthToken) {
  if (!financeColumnsCache) {
    const discovery = await postJSON("/query", {
      query: `SELECT * FROM trusted WHERE "$path" LIKE '%/${FINANCE_PATH_FILTER}%' LIMIT 1`,
      limit: 1
    }, getAuthToken);
    financeColumnsCache = Array.isArray(discovery?.columns) ? discovery.columns : [];
  }

  const { dateField } = discoverFinanceColumns(financeColumnsCache);
  if (!dateField) {
    return {
      columns: financeColumnsCache,
      rows: [],
      rowCount: 0,
      dateField: "",
      missingBusinessDate: true
    };
  }

  const query = buildFinanceRowsQuery(financeColumnsCache, MAX_QUERY_ROWS);
  const payload = await postJSON("/query", {
    query,
    limit: MAX_QUERY_ROWS
  }, getAuthToken);

  return {
    columns: financeColumnsCache,
    rows: Array.isArray(payload?.rows) ? payload.rows : [],
    rowCount: Number(payload?.row_count || 0),
    dateField,
    missingBusinessDate: false
  };
}

/**
 * Formats spend numbers for the live chart summary cards.
 *
 * @param {number} value
 * @returns {string}
 */
function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return currencyFormatter.format(value);
}

/**
 * Formats percentage changes for the live chart summary cards.
 *
 * @param {number} value
 * @returns {string}
 */
function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

/**
 * Picks a short axis label for the current time window.
 *
 * @param {Date} value
 * @param {number} windowDays
 * @returns {string}
 */
function formatDateLabel(value, windowDays) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "--";
  }
  if (windowDays <= 7) {
    return value.toLocaleDateString(undefined, { weekday: "short" });
  }
  return value.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Formats the last refresh time for the status label.
 *
 * @param {string | number | Date} value
 * @returns {string}
 */
function formatBusinessDateTime(value) {
  const date = parseDate(value);
  if (!date) {
    return "Waiting for the latest refresh";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/**
 * Chooses a chart size that fits the screen and stays within the limits.
 *
 * @param {HTMLElement} chartElement
 * @returns {{ width: number, height: number }}
 */
function getChartDimensions(chartElement) {
  const containerWidth = Math.round(chartElement.getBoundingClientRect().width);
  const usableWidth = Math.max(0, containerWidth - 24);
  const width = Math.min(MAX_CHART_WIDTH, Math.max(MIN_CHART_WIDTH, usableWidth || MIN_CHART_WIDTH));
  const height = Math.max(MIN_CHART_HEIGHT, Math.min(MAX_CHART_HEIGHT, Math.round(width * 0.29)));
  return { width, height };
}

/**
 * Builds the smooth SVG line for the live spend chart.
 *
 * @param {{ x: number, y: number }[]} points
 * @returns {string}
 */
function buildSmoothPath(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  }

  const tension = 0.18;
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const c1x = p1.x + ((p2.x - p0.x) * tension) / 6;
    const c1y = p1.y + ((p2.y - p0.y) * tension) / 6;
    const c2x = p2.x - ((p3.x - p1.x) * tension) / 6;
    const c2y = p2.y - ((p3.y - p1.y) * tension) / 6;

    path += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  return path;
}

/**
 * Closes the live chart line back to the bottom so the fill can be drawn.
 *
 * @param {{ x: number, y: number }[]} points
 * @param {number} baselineY
 * @param {string} linePath
 * @returns {string}
 */
function buildAreaPath(points, baselineY, linePath) {
  if (!Array.isArray(points) || points.length === 0) {
    return "";
  }

  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath} L ${last.x.toFixed(1)} ${baselineY.toFixed(1)} L ${first.x.toFixed(1)} ${baselineY.toFixed(1)} Z`;
}

/**
 * Picks evenly spaced x-axis points without repeating the same one.
 *
 * @param {number} length
 * @param {number} [slots=5]
 * @returns {number[]}
 */
function uniqueTickIndices(length, slots = 5) {
  if (length <= 0) {
    return [];
  }

  const indices = Array.from({ length: Math.min(slots, length) }, (_, index) => {
    if (length === 1) {
      return 0;
    }
    return Math.round((index / (Math.min(slots, length) - 1 || 1)) * (length - 1));
  });

  return Array.from(new Set(indices)).sort((left, right) => left - right);
}

/**
 * Groups the last 90 days of spending into daily points.
 *
 * @param {Array<Record<string, any>>} rows
 * @returns {Array<Record<string, any>>}
 */
function buildDailySpendSeries(rows) {
  const expenseRows = rows
    .filter((row) => row.flow === "expenditure" && row.date)
    .sort((left, right) => left.date - right.date);

  if (!expenseRows.length) {
    return [];
  }

  const latestDate = expenseRows[expenseRows.length - 1].date;
  const startDate = new Date(latestDate);
  startDate.setDate(startDate.getDate() - 89);

  const totals = new Map();
  expenseRows.forEach((row) => {
    if (row.date < startDate) {
      return;
    }
    const key = row.dayKey;
    totals.set(key, (totals.get(key) || 0) + row.amount);
  });

  const points = [];
  for (let offset = 0; offset < 90; offset += 1) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + offset);
    const key = date.toISOString().slice(0, 10);
    points.push({
      date,
      dayKey: key,
      label: formatDateLabel(date, 90),
      value: Number((totals.get(key) || 0).toFixed(2))
    });
  }

  return points;
}

/**
 * Builds the data the live chart needs for the chosen time window.
 *
 * @param {Array<Record<string, any>>} rows
 * @param {number} windowDays
 * @returns {Record<string, any>}
 */
function buildChartModel(rows, windowDays) {
  const normalizedRows = normalizeFinanceRows(rows);
  const fullSeries = buildDailySpendSeries(normalizedRows);
  const series = fullSeries.slice(-windowDays);

  if (!series.length) {
    return {
      series: [],
      currentTotal: 0,
      previousTotal: 0,
      average: 0,
      peak: 0,
      anomalies: [],
      latestDate: null,
      transactionCount: normalizedRows.filter((row) => row.flow === "expenditure").length
    };
  }

  const values = series.map((point) => point.value);
  const currentTotal = values.reduce((sum, value) => sum + value, 0);
  const average = currentTotal / series.length;
  const peak = Math.max(0, ...values);
  const previousSeries = fullSeries.slice(-(windowDays * 2), -windowDays);
  const previousTotal = previousSeries.reduce((sum, point) => sum + point.value, 0);
  const latestDate = series[series.length - 1].date;

  const mean = average;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(values.length, 1);
  const deviation = Math.sqrt(variance);
  const anomalyThreshold = mean + deviation * 1.6;
  const anomalies = series.filter((point) => point.value > anomalyThreshold && point.value > mean * 1.25);

  return {
    series,
    currentTotal,
    previousTotal,
    average,
    peak,
    anomalies,
    latestDate,
    transactionCount: normalizedRows.filter((row) => row.flow === "expenditure").length
  };
}

/**
 * Shows the chart empty-state message.
 *
 * @param {HTMLElement} chartElement
 * @param {string} message
 */
function renderEmptyChart(chartElement, message) {
  chartElement.innerHTML = "";
  const empty = document.createElement("p");
  empty.className = "live-chart-empty";
  empty.textContent = message;
  chartElement.append(empty);
}

/**
 * Shows the live spend chart, summary stats, and alert markers.
 *
 * @param {HTMLElement} chartElement
 * @param {Record<string, any>} model
 * @param {number} windowDays
 */
function renderChart(chartElement, model, windowDays) {
  if (!model.series.length) {
    renderEmptyChart(chartElement, "No spend history was available for this period.");
    return;
  }

  const { width, height } = getChartDimensions(chartElement);
  const paddingX = Math.max(22, Math.round(width * 0.04));
  const paddingY = Math.max(18, Math.round(height * 0.12));
  const values = model.series.map((point) => point.value);
  const maxValue = Math.max(1, ...values);
  const minValue = 0;
  const range = Math.max(1, maxValue - minValue);
  const baselineY = height - paddingY;

  const points = model.series.map((point, index) => {
    const x =
      model.series.length === 1
        ? width / 2
        : paddingX + (index / (model.series.length - 1)) * (width - paddingX * 2);
    const y = paddingY + ((maxValue - point.value) / range) * (height - paddingY * 2);
    return { ...point, x, y };
  });

  const linePath = buildSmoothPath(points);
  const areaPath = buildAreaPath(points, baselineY, linePath);
  const gridValues = [0, 0.33, 0.66, 1];
  const gridLines = gridValues
    .map((position) => {
      const y = (paddingY + (height - paddingY * 2) * position).toFixed(1);
      return `<line class="live-chart-grid-line" x1="${paddingX}" y1="${y}" x2="${width - paddingX}" y2="${y}"></line>`;
    })
    .join("");

  const pointDots = points
    .map((point) => {
      const tooltip = `${formatDateLabel(point.date, windowDays)}: ${formatCurrency(point.value)}`;
      return `
        <circle class="live-chart-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.6">
          <title>${tooltip}</title>
        </circle>
      `;
    })
    .join("");

  const anomalyDots = model.anomalies
    .map((anomaly) => {
      const point = points.find((candidate) => candidate.dayKey === anomaly.dayKey);
      if (!point) {
        return "";
      }
      return `
        <circle class="live-chart-anomaly" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="6.4">
          <title>Unusual spend: ${formatDateLabel(point.date, windowDays)} ${formatCurrency(point.value)}</title>
        </circle>
      `;
    })
    .join("");

  const deltaPercent = model.previousTotal > 0
    ? ((model.currentTotal - model.previousTotal) / model.previousTotal) * 100
    : null;

  const tickIndices = uniqueTickIndices(points.length, 5);
  const axisMarkup = tickIndices
    .map((index) => `<span>${formatDateLabel(points[index].date, windowDays)}</span>`)
    .join("");

  chartElement.innerHTML = `
    <div class="live-chart-wrap">
      <div class="live-chart-stats">
        <div class="live-chart-stat">
          <span class="label">Total Spend</span>
          <strong class="value">${formatCurrency(model.currentTotal)}</strong>
        </div>
        <div class="live-chart-stat">
          <span class="label">Daily Average</span>
          <strong class="value">${formatCurrency(model.average)}</strong>
        </div>
        <div class="live-chart-stat ${deltaPercent > 0 ? "live-stat-delta-wrap is-up" : deltaPercent < 0 ? "live-stat-delta-wrap is-down" : ""}">
          <span class="label">Vs Prior Period</span>
          <strong class="value">${deltaPercent === null ? "n/a" : formatPercent(deltaPercent)}</strong>
        </div>
        <div class="live-chart-stat">
          <span class="label">Highest Day</span>
          <strong class="value">${formatCurrency(model.peak)}</strong>
        </div>
      </div>
      <div class="line-chart-wrap live-spend-chart">
        <svg class="live-chart-svg" viewBox="0 0 ${width} ${height}" aria-label="Daily spend trend chart" style="height:${height}px">
          ${gridLines}
          <path class="live-chart-area" d="${areaPath}"></path>
          <path class="live-chart-line" d="${linePath}"></path>
          ${pointDots}
          ${anomalyDots}
        </svg>
        <div class="live-chart-axis">${axisMarkup}</div>
        <div class="live-chart-legend">
          <span><i class="dot spend"></i>Daily spend</span>
          <span><i class="dot alert"></i>Unusual spike</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Stores the latest finance rows so other parts of the app can reuse them.
 *
 * @param {Record<string, any>} state
 */
function publishFinanceState(state) {
  window.__smartstreamFinanceRowsState = state;
  window.dispatchEvent(new CustomEvent("smartstream:finance-rows-updated", {
    detail: state
  }));
}

/**
 * Starts finance polling and the live chart in the dashboard header.
 *
 * @param {{
 *   chartElement: HTMLElement,
 *   metaElement: HTMLElement,
 *   statusElement: HTMLElement,
 *   pollIntervalMs?: number,
 *   getAuthToken?: () => string
 * }} options
 * @returns {() => void}
 */
export function startLiveUpdates({
  chartElement,
  metaElement,
  statusElement,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  getAuthToken = () => ""
}) {
  if (!DEFAULT_API_BASE_URL) {
    metaElement.textContent = "Set VITE_API_BASE_URL to load dashboard data.";
    statusElement.textContent = "Configuration needed";
    statusElement.classList.add("is-error");
    renderEmptyChart(chartElement, "Set VITE_API_BASE_URL to load spend history.");
    return () => {};
  }

  let timer = null;
  let resizeFrame = null;
  let latestRows = [];
  let financeDateField = "";
  let missingBusinessDate = false;
  let selectedWindow = 30;
  const filterButtons = Array.from(document.querySelectorAll("#dashboard-spend-filters .segmented-btn"));

  const updateFilterButtons = () => {
    filterButtons.forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.rangeDays) === selectedWindow);
    });
  };

  const rerender = () => {
    resizeFrame = null;
    if (missingBusinessDate) {
      renderEmptyChart(chartElement, FINANCE_TREND_MISSING_DATE_MESSAGE);
      return;
    }
    const model = buildChartModel(latestRows, selectedWindow);
    renderChart(chartElement, model, selectedWindow);
  };

  const handleResize = () => {
    if (resizeFrame !== null) {
      return;
    }
    resizeFrame = window.requestAnimationFrame(rerender);
  };

  const handleFilterClick = (event) => {
    const button = event.currentTarget;
    const nextWindow = Number(button.dataset.rangeDays);
    if (!WINDOW_OPTIONS.includes(nextWindow) || nextWindow === selectedWindow) {
      return;
    }
    selectedWindow = nextWindow;
    updateFilterButtons();
    rerender();
  };

  filterButtons.forEach((button) => {
    button.addEventListener("click", handleFilterClick);
  });
  updateFilterButtons();
  window.addEventListener("resize", handleResize);

  const refresh = async () => {
    try {
      const payload = await fetchFinanceRows(getAuthToken);
      latestRows = payload.rows;
      financeDateField = payload.dateField || "";
      missingBusinessDate = Boolean(payload.missingBusinessDate);

      if (missingBusinessDate) {
        const refreshedAt = new Date().toISOString();
        metaElement.textContent = FINANCE_TREND_MISSING_DATE_MESSAGE;
        statusElement.textContent = "Finance trend unavailable";
        statusElement.classList.remove("is-live");
        statusElement.classList.add("is-error");
        renderEmptyChart(chartElement, FINANCE_TREND_MISSING_DATE_MESSAGE);
        publishFinanceState({
          rows: latestRows,
          columns: payload.columns,
          refreshedAt,
          selectedWindow,
          dateField: financeDateField,
          missingBusinessDate
        });
        return;
      }

      const model = buildChartModel(latestRows, selectedWindow);
      renderChart(chartElement, model, selectedWindow);

      const refreshedAt = new Date().toISOString();
      const anomalyCount = model.anomalies.length;
      metaElement.textContent = model.series.length
        ? `Showing ${selectedWindow} days of spend from ${payload.rowCount || latestRows.length} finance rows${anomalyCount ? ` with ${anomalyCount} highlighted spike${anomalyCount === 1 ? "" : "s"}` : ""}.`
        : "Finance rows loaded, but no spend history was available for the selected period.";
      statusElement.textContent = `Updated ${formatBusinessDateTime(refreshedAt)}`;
      statusElement.classList.remove("is-error");
      statusElement.classList.add("is-live");

      publishFinanceState({
        rows: latestRows,
        columns: payload.columns,
        refreshedAt,
        selectedWindow,
        dateField: financeDateField,
        missingBusinessDate
      });
    } catch (error) {
      statusElement.textContent = `Update failed: ${error.message}`;
      statusElement.classList.remove("is-live");
      statusElement.classList.add("is-error");
      metaElement.textContent = "Spend history is temporarily unavailable.";
      renderEmptyChart(chartElement, "Recent spend history could not be loaded.");
    }
  };

  refresh();
  timer = window.setInterval(refresh, Math.max(30000, pollIntervalMs));

  return () => {
    filterButtons.forEach((button) => {
      button.removeEventListener("click", handleFilterClick);
    });
    window.removeEventListener("resize", handleResize);
    if (resizeFrame !== null) {
      window.cancelAnimationFrame(resizeFrame);
    }
    if (timer) {
      window.clearInterval(timer);
    }
  };
}
