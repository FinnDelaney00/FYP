/**
 * File purpose:
 * Fetches dashboard, forecast, and query data from the backend API and renders
 * metrics, charts, forecast panels, and query result tables in the UI.
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const QUERY_SINGLE_TABLE = "trusted";
const QUERY_TABLE_OPTIONS = [
  { value: QUERY_SINGLE_TABLE, label: "trusted (all tables)" },
  { value: "employees", label: "employees (path: trusted/employees)" },
  { value: "transactions", label: "transactions (path: trusted/finance/transactions)" },
  { value: "accounts", label: "accounts (path: trusted/finance/accounts)" }
];
const QUERY_TABLE_PATH_FILTERS = {
  employees: "trusted/employees/",
  transactions: "trusted/finance/transactions/",
  accounts: "trusted/finance/accounts/"
};

const QUERY_LIMIT_OPTIONS = ["20", "50", "100", "200"];
const DEFAULT_QUERY_LIMIT = 20;
const DEFAULT_QUERY_TABLE = QUERY_SINGLE_TABLE;

const QUERY_ROW_SQL_PREVIEW_PREFIX = "Generated SQL: ";

let latestDashboardPayload = null;
let latestFinanceRowsState = {
  rows: [],
  columns: [],
  refreshedAt: null
};
const queryRowsCache = new Map();
const FINANCE_DATE_FIELDS = ["transaction_date", "event_time", "event_timestamp", "timestamp", "datetime", "date", "created_at", "updated_at"];
const FINANCE_AMOUNT_FIELDS = ["amount", "transaction_amount", "value", "total", "net_amount"];
const FINANCE_CATEGORY_FIELDS = ["category", "transaction_type", "type", "entry_type"];
const FINANCE_VENDOR_FIELDS = ["merchant", "merchant_name", "vendor", "vendor_name", "supplier", "payee", "counterparty", "description"];
const FINANCE_DEPARTMENT_FIELDS = ["department", "dept", "team", "division"];
const FINANCE_REVENUE_HINTS = ["revenue", "income", "credit", "sale", "sales", "deposit", "inflow", "received"];
const FINANCE_EXPENDITURE_HINTS = ["expense", "expenditure", "debit", "cost", "purchase", "withdrawal", "outflow", "payment"];

function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return currencyFormatter.format(value);
}

function formatDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || "--");
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatCompactCurrency(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: value >= 100000 ? 1 : 0
  }).format(value);
}

function formatBusinessDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Waiting for the latest refresh";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatWholePercent(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

function formatSignedCount(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  if (value === 0) {
    return "0";
  }
  return `${value > 0 ? "+" : "-"}${Math.abs(value)}`;
}

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

function extractFirstField(record, fields, fallback = "") {
  for (const field of fields) {
    const value = record?.[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

function extractFinanceDate(record) {
  for (const field of FINANCE_DATE_FIELDS) {
    const parsed = parseDate(record?.[field]);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function extractFinanceAmount(record) {
  for (const field of FINANCE_AMOUNT_FIELDS) {
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

  if (FINANCE_REVENUE_HINTS.some((token) => hintText.includes(token))) {
    return "revenue";
  }
  if (FINANCE_EXPENDITURE_HINTS.some((token) => hintText.includes(token))) {
    return "expenditure";
  }
  return amount >= 0 ? "revenue" : "expenditure";
}

function normalizeFinanceRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((record) => {
      const signedAmount = extractFinanceAmount(record);
      if (!Number.isFinite(signedAmount)) {
        return null;
      }

      const date = extractFinanceDate(record);
      return {
        raw: record,
        date,
        dayKey: date ? date.toISOString().slice(0, 10) : "",
        signedAmount,
        amount: Math.abs(signedAmount),
        flow: classifyFinanceFlow(record, signedAmount),
        category: extractFirstField(record, FINANCE_CATEGORY_FIELDS, "Other"),
        vendor: extractFirstField(record, FINANCE_VENDOR_FIELDS, "Unlabelled vendor"),
        department: extractFirstField(record, FINANCE_DEPARTMENT_FIELDS, "")
      };
    })
    .filter(Boolean);
}

function aggregateTopItems(rows, key, limit = 5) {
  const totals = new Map();

  rows.forEach((row) => {
    const label = String(row?.[key] || "").trim();
    if (!label) {
      return;
    }
    totals.set(label, (totals.get(label) || 0) + (Number(row.amount) || 0));
  });

  return Array.from(totals.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, limit);
}

function buildFinanceAnalytics(rows) {
  const normalized = normalizeFinanceRows(rows);
  const expenses = normalized.filter((row) => row.flow === "expenditure");
  const datedExpenses = expenses.filter((row) => row.date).sort((left, right) => left.date - right.date);
  const latestDate = datedExpenses[datedExpenses.length - 1]?.date || null;
  const categoryBreakdown = aggregateTopItems(expenses, "category");
  const vendorBreakdown = aggregateTopItems(expenses, "vendor");
  const departmentBreakdown = aggregateTopItems(expenses.filter((row) => row.department), "department");

  const vendorCounts = new Map();
  expenses.forEach((row) => {
    const key = row.vendor || row.category || "Other";
    vendorCounts.set(key, (vendorCounts.get(key) || 0) + 1);
  });

  let recurringSpend = 0;
  let oneOffSpend = 0;
  expenses.forEach((row) => {
    const key = row.vendor || row.category || "Other";
    if ((vendorCounts.get(key) || 0) > 1) {
      recurringSpend += row.amount;
    } else {
      oneOffSpend += row.amount;
    }
  });

  const amounts = expenses.map((row) => row.amount).filter((value) => Number.isFinite(value));
  const average = amounts.length ? amounts.reduce((sum, value) => sum + value, 0) / amounts.length : 0;
  const variance = amounts.length
    ? amounts.reduce((sum, value) => sum + (value - average) ** 2, 0) / amounts.length
    : 0;
  const deviation = Math.sqrt(variance);
  const anomalyThreshold = average + deviation * 1.8;
  const unusualExpenses = expenses
    .filter((row) => row.amount > anomalyThreshold && row.amount > average * 1.35)
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 3);

  return {
    normalized,
    expenses,
    latestDate,
    categoryBreakdown,
    vendorBreakdown,
    departmentBreakdown,
    recurringSpend,
    oneOffSpend,
    unusualExpenses
  };
}

function getMonthlySpendMetrics(monthlySeries) {
  const rows = Array.isArray(monthlySeries) ? monthlySeries : [];
  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];
  const currentSpend = Number(latest?.expenditure) || 0;
  const previousSpend = Number(previous?.expenditure) || 0;
  const spendChangePercent = previousSpend > 0 ? ((currentSpend - previousSpend) / previousSpend) * 100 : null;

  return {
    currentSpend,
    previousSpend,
    spendChangePercent
  };
}

function getEmployeeMetrics(charts, metrics) {
  const points = Array.isArray(charts?.employee_growth) ? charts.employee_growth : [];
  const actualPoints = points.filter((point) => !point.is_forecast);
  const latestActual = actualPoints[actualPoints.length - 1];
  const previousActual = actualPoints[actualPoints.length - 2];
  const growthCount = latestActual && previousActual ? (Number(latestActual.value) || 0) - (Number(previousActual.value) || 0) : 0;
  const totalEmployees = Number(metrics?.total_employees?.value || latestActual?.value || 0);

  return {
    totalEmployees,
    growthCount,
    totalEmployeeDelta: Number(metrics?.total_employees?.delta_percent),
    projectedGrowthPercent: Number(metrics?.growth_rate?.value_percent)
  };
}

function getLargestDepartment(items) {
  const departments = Array.isArray(items) ? items : [];
  return departments
    .map((item) => ({
      label: item.label || "Unknown",
      value: Number(item.value) || 0
    }))
    .sort((left, right) => right.value - left.value)[0] || null;
}

function buildAuthHeaders(getAuthToken) {
  const token = typeof getAuthToken === "function" ? String(getAuthToken() || "").trim() : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getJSON(path, options, getAuthToken) {
  if (!API_BASE_URL) {
    throw new Error("VITE_API_BASE_URL is not configured");
  }

  const headers = {
    ...(options?.headers || {}),
    ...buildAuthHeaders(getAuthToken)
  };

  return fetch(`${API_BASE_URL}${path}`, {
    ...(options || {}),
    headers
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload;
  });
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char])
  );
}

function normalizeDatabaseName(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function sanitizeQueryProjection(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "*";
  }
  if (normalized === "__count__" || /^count\(\s*\*\s*\)/i.test(normalized)) {
    return "COUNT(*) AS row_count";
  }
  if (normalized === "*") {
    return "*";
  }
  if (/^[a-zA-Z_][\w]*$/.test(normalized)) {
    return normalized;
  }
  return `"${normalized.replace(/"/g, '""')}"`;
}

function normalizeQueryLimit(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_QUERY_LIMIT;
  }
  return Math.min(1000, Math.max(1, parsed));
}

function buildQueryFromControls({
  database = DEFAULT_QUERY_TABLE,
  projection = "*",
  limit = DEFAULT_QUERY_LIMIT
}) {
  const safeDatabase = normalizeDatabaseName(database);
  if (!safeDatabase) {
    return "";
  }
  const safeProjection = sanitizeQueryProjection(projection);
  const safeLimit = normalizeQueryLimit(limit);
  if (safeDatabase === QUERY_SINGLE_TABLE) {
    return `SELECT ${safeProjection} FROM ${QUERY_SINGLE_TABLE} LIMIT ${safeLimit}`;
  }

  const pathFilter = QUERY_TABLE_PATH_FILTERS[safeDatabase];
  if (!pathFilter) {
    return `SELECT ${safeProjection} FROM ${safeDatabase} LIMIT ${safeLimit}`;
  }

  const escapedFilter = pathFilter.replace(/'/g, "''");
  return `SELECT ${safeProjection} FROM ${QUERY_SINGLE_TABLE} WHERE "$path" LIKE '%/${escapedFilter}%' LIMIT ${safeLimit}`;
}

function getQueryFormElements() {
  return {
    databaseSelect: document.getElementById("query-database"),
    rowSelect: document.getElementById("query-row"),
    limitSelect: document.getElementById("query-limit"),
    status: document.getElementById("query-status"),
    statusPreview: document.getElementById("query-sql-preview"),
    form: document.getElementById("query-form")
  };
}

function setQuerySqlPreview() {
  const elements = getQueryFormElements();
  if (!elements.statusPreview || !elements.databaseSelect || !elements.rowSelect || !elements.limitSelect) {
    return;
  }

  const query = buildQueryFromControls({
    database: elements.databaseSelect.value,
    projection: elements.rowSelect.value,
    limit: elements.limitSelect.value
  });
  elements.statusPreview.textContent = `${QUERY_ROW_SQL_PREVIEW_PREFIX}${query}`;
}

function setQueryRowOptions(database, getAuthToken) {
  const elements = getQueryFormElements();
  const rowSelect = elements.rowSelect;
  const status = elements.status;
  if (!rowSelect || !database) {
    return Promise.resolve();
  }

  const cachedRows = queryRowsCache.get(database);
  if (cachedRows) {
    rowSelect.innerHTML = cachedRows;
    rowSelect.disabled = false;
    setQuerySqlPreview();
    return Promise.resolve();
  }

  rowSelect.disabled = true;
  if (status) {
    status.textContent = "Loading available rows...";
  }

  const discoveryQuery = buildQueryFromControls({ database, projection: "*", limit: 1 });
  return getJSON("/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: discoveryQuery,
      limit: 1
    })
  }, getAuthToken)
    .then((payload) => {
      const columns = Array.isArray(payload?.columns) ? payload.columns : [];
      const options = [
        `<option value="*">All columns</option>`,
        ...columns
          .map((column) => String(column))
          .filter((column, index, list) => column && list.indexOf(column) === index)
          .map((column) => `<option value="${escapeHtml(column)}">${escapeHtml(column)}</option>`),
        `<option value="__count__">Row count</option>`
      ];
      const optionHtml = options.join("");
      rowSelect.innerHTML = optionHtml;
      queryRowsCache.set(database, optionHtml);
      rowSelect.disabled = false;
      setQuerySqlPreview();
      return optionHtml;
    })
    .catch(() => {
      const fallbackOptions = [
        `<option value="*">All columns</option>`,
        `<option value="__count__">Row count</option>`
      ].join("");
      rowSelect.innerHTML = fallbackOptions;
      queryRowsCache.set(database, fallbackOptions);
      rowSelect.disabled = false;
      setQuerySqlPreview();
      return fallbackOptions;
    });
}

function buildQueryGraphSeries(payload, metric) {
  const charts = payload?.charts || {};
  if (metric === "revenue") {
    return (charts.revenue_expenses || []).map((item) => ({
      label: item.label || "--",
      value: Number(item.revenue) || 0
    }));
  }
  if (metric === "expenses") {
    return (charts.revenue_expenses || []).map((item) => ({
      label: item.label || "--",
      value: Number(item.expenditure) || 0
    }));
  }
  return (charts.employee_growth || []).map((item) => ({
    label: item.label || "--",
    value: Number(item.value) || 0
  }));
}

function applyGraphWindow(series, windowValue) {
  if (!Array.isArray(series) || series.length === 0) {
    return [];
  }

  if (windowValue.includes("12")) {
    return series.slice(-12);
  }
  if (windowValue.includes("year")) {
    return series.slice();
  }
  return series.slice(-6);
}

function graphTypeFromSelection(value) {
  const normalized = (value || "line chart").toLowerCase();
  if (normalized.includes("bar")) {
    return "bar";
  }
  if (normalized.includes("area")) {
    return "area";
  }
  return "line";
}

function graphMetricFromSelection(value) {
  const normalized = (value || "revenue").toLowerCase();
  if (normalized.includes("employee")) {
    return "employees";
  }
  if (normalized.includes("expense")) {
    return "expenses";
  }
  return "revenue";
}

function graphFormatterFromMetric(metric) {
  if (metric === "employees") {
    return (value) => `${Math.round(Number(value) || 0).toLocaleString()}`;
  }
  return formatCurrency;
}

function renderGraphLines(series, withArea) {
  if (!Array.isArray(series) || series.length === 0) {
    return "";
  }

  const width = 500;
  const height = 180;
  const paddingX = 20;
  const paddingY = 15;
  const values = series.map((point) => Number(point.value) || 0);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spread = maxValue - minValue;
  const rangePadding = spread > 0 ? spread * 0.2 : 1;
  const domainMin = minValue - rangePadding;
  const domainMax = maxValue + rangePadding;
  const plotRange = Math.max(1, domainMax - domainMin);

  const points = series.map((point, index) => {
    const x = series.length === 1 ? width / 2 : paddingX + (index / (series.length - 1)) * (width - paddingX * 2);
    const y = paddingY + ((domainMax - (Number(point.value) || 0)) / plotRange) * (height - paddingY * 2);
    return {
      x,
      y,
      label: point.label || "--"
    };
  });

  const linePath = buildSmoothLinePath(points);
  const areaPath = withArea ? buildAreaPath(points, height - paddingY, linePath) : "";
  const gridLines = [0.2, 0.4, 0.6, 0.8]
    .map((position) => {
      const y = (paddingY + (height - paddingY * 2) * position).toFixed(1);
      return `<line class="line-grid-line" x1="${paddingX}" y1="${y}" x2="${width - paddingX}" y2="${y}"></line>`;
    })
    .join("");
  const dots = points
    .map((point) => `<circle class="line-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.6"></circle>`)
    .join("");
  const labels = series.map((item) => `<span>${escapeHtml(item.label || "--")}</span>`).join("");

  return `
    <div class="graph-line-wrap">
      <svg viewBox="0 0 500 180" preserveAspectRatio="none" aria-label="Generated graph preview">
        ${gridLines}
        ${withArea ? `<path class="line-fill" d="${areaPath}"></path>` : ""}
        <path class="line-stroke" d="${linePath}"></path>
        ${dots}
      </svg>
      <div class="graph-x-axis">${labels}</div>
    </div>
  `;
}

function renderGraphBars(series, formatValue) {
  if (!Array.isArray(series) || series.length === 0) {
    return "";
  }

  const max = Math.max(1, ...series.map((point) => Number(point.value) || 0));
  return `
    <div class="graph-bars">
      ${series
        .map((point) => {
          const width = Math.max(10, Math.round(((Number(point.value) || 0) / max) * 100));
          return `
            <div class="graph-bar-row">
              <span class="graph-bar-label">${escapeHtml(point.label || "--")}</span>
              <i class="graph-bar" style="--w:${width}"></i>
              <span class="graph-bar-value">${formatValue(Number(point.value) || 0)}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderGraphPreview({
  metric,
  graphType,
  windowText,
  series
}) {
  const preview = document.getElementById("graph-preview");
  const status = document.getElementById("graph-status");
  if (!preview || !status) {
    return;
  }

  if (!Array.isArray(series) || series.length === 0) {
    preview.innerHTML = `<p class="graph-empty">No ${metric} data available for this window (${windowText}).</p>`;
    status.textContent = `No data found for ${metric}.`;
    return;
  }

  const formatter = graphFormatterFromMetric(metric);
  const values = series.map((point) => ({
    label: point.label || "--",
    value: Number(point.value) || 0
  }));

  const chart = graphType === "bar"
    ? renderGraphBars(values, formatter)
    : renderGraphLines(values, graphType === "area");

  const latestValue = formatter(values[values.length - 1]?.value || 0);
  preview.innerHTML = `
    <p class="muted-note">Showing ${values.length} point(s) for ${metric} (${windowText}). Latest: ${latestValue}</p>
    ${chart}
  `;
  status.textContent = "Graph preview generated.";
}

async function runCreateGraph() {
  const graphTypeSelect = document.getElementById("graph-type");
  const graphMetricSelect = document.getElementById("graph-metric");
  const graphWindowSelect = document.getElementById("graph-window");
  if (!graphTypeSelect || !graphMetricSelect || !graphWindowSelect) {
    return;
  }

  if (!latestDashboardPayload) {
    renderGraphPreview({
      metric: graphMetricFromSelection(graphMetricSelect.value),
      graphType: graphTypeFromSelection(graphTypeSelect.value),
      windowText: graphWindowSelect.value,
      series: []
    });
    return;
  }

  const metric = graphMetricFromSelection(graphMetricSelect.value);
  const windowValue = graphWindowSelect.value;
  const rawSeries = buildQueryGraphSeries(latestDashboardPayload, metric);
  const normalized = applyGraphWindow(rawSeries, windowValue);
  renderGraphPreview({
    metric,
    graphType: graphTypeFromSelection(graphTypeSelect.value),
    windowText: windowValue,
    series: normalized
  });
}

async function initializeQueryPage(getAuthToken) {
  const elements = getQueryFormElements();
  if (!elements.databaseSelect || !elements.rowSelect || !elements.limitSelect || !elements.form) {
    return;
  }

  if (!elements.databaseSelect.options.length || elements.databaseSelect.options[0]?.value === "") {
    elements.databaseSelect.innerHTML = QUERY_TABLE_OPTIONS
      .map((option) => `<option value="${option.value}">${option.label}</option>`)
      .join("");
  }
  if (elements.limitSelect.options.length !== QUERY_LIMIT_OPTIONS.length) {
    elements.limitSelect.innerHTML = QUERY_LIMIT_OPTIONS
      .map((value) => `<option value="${value}">${value}</option>`)
      .join("");
  }

  elements.databaseSelect.value = QUERY_TABLE_OPTIONS.find((option) => option.value === DEFAULT_QUERY_TABLE)?.value || QUERY_TABLE_OPTIONS[0].value;
  elements.limitSelect.value = String(DEFAULT_QUERY_LIMIT);

  elements.databaseSelect.addEventListener("change", () => {
    const db = elements.databaseSelect.value;
    void setQueryRowOptions(db, getAuthToken);
  });

  elements.rowSelect.addEventListener("change", setQuerySqlPreview);
  elements.limitSelect.addEventListener("change", setQuerySqlPreview);
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void runQuery(getAuthToken);
  });

  await setQueryRowOptions(elements.databaseSelect.value, getAuthToken);
  setQuerySqlPreview();
}

function initializeCreateGraphPage() {
  const graphButton = document.getElementById("graph-generate-btn");
  if (!graphButton) {
    return;
  }

  graphButton.addEventListener("click", () => {
    void runCreateGraph();
  });
}

function clearLoadingClasses(element) {
  if (!element) {
    return;
  }
  element.classList.remove("skeleton", "skeleton-value", "skeleton-line");
}

function setMetric(id, value, subtitle) {
  const valueElement = document.getElementById(`${id}-value`);
  const subtitleElement = document.getElementById(`${id}-subtitle`);
  if (valueElement) {
    clearLoadingClasses(valueElement);
    valueElement.textContent = value;
  }
  if (subtitleElement) {
    clearLoadingClasses(subtitleElement);
    subtitleElement.textContent = subtitle;
  }
}

function setMetricTrend(id, value, tone = "neutral") {
  const trendElement = document.getElementById(`${id}-trend`);
  if (!trendElement) {
    return;
  }

  trendElement.textContent = value;
  trendElement.dataset.tone = tone;
}

function buildSmoothLinePath(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  }

  const tension = 0.2;
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

function buildAreaPath(points, baselineY, linePath) {
  if (!Array.isArray(points) || points.length === 0) {
    return "";
  }

  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath} L ${last.x.toFixed(1)} ${baselineY.toFixed(1)} L ${first.x.toFixed(1)} ${baselineY.toFixed(1)} Z`;
}

function pickAxisLabels(series, slots = 6) {
  if (!Array.isArray(series) || series.length === 0) {
    return Array.from({ length: slots }, () => "--");
  }

  if (series.length === 1) {
    return Array.from({ length: slots }, () => series[0].label || "--");
  }

  return Array.from({ length: slots }, (_, index) => {
    const ratio = index / (slots - 1);
    const pointIndex = Math.round(ratio * (series.length - 1));
    return series[pointIndex]?.label || "--";
  });
}

function renderEmployeeGrowth(series) {
  const container = document.getElementById("employee-growth-chart");
  if (!container) {
    return;
  }

  if (!Array.isArray(series) || series.length === 0) {
    container.innerHTML = `
      <svg viewBox="0 0 520 220" preserveAspectRatio="none" aria-label="Employee growth line chart">
        <polyline class="line-fill" points="20,210 500,210 500,210 20,210"></polyline>
        <polyline class="line-stroke" points="20,210 500,210"></polyline>
      </svg>
      <div class="x-axis"><span>--</span><span>--</span><span>--</span><span>--</span><span>--</span><span>--</span></div>
    `;
    return;
  }

  const width = 520;
  const height = 220;
  const paddingX = 20;
  const paddingY = 15;
  const values = series.map((point) => Number(point.value) || 0);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spread = maxValue - minValue;
  const domainPadding = spread > 0 ? spread * 0.2 : Math.max(Math.abs(maxValue) * 0.15, 1);
  const domainMin = minValue - domainPadding;
  const domainMax = maxValue + domainPadding;
  const range = Math.max(1, domainMax - domainMin);
  const baselineY = height - paddingY;

  const coords = series.map((point, index) => {
    const x =
      series.length === 1
        ? width / 2
        : paddingX + (index / (series.length - 1)) * (width - paddingX * 2);
    const y = paddingY + ((domainMax - (Number(point.value) || 0)) / range) * (height - paddingY * 2);
    return { x, y };
  });

  const linePath = buildSmoothLinePath(coords);
  const areaPath = buildAreaPath(coords, baselineY, linePath);
  const labels = pickAxisLabels(series);
  const gridLines = [0.2, 0.4, 0.6, 0.8]
    .map((position) => {
      const y = (paddingY + (height - paddingY * 2) * position).toFixed(1);
      return `<line class="line-grid-line" x1="${paddingX}" y1="${y}" x2="${width - paddingX}" y2="${y}"></line>`;
    })
    .join("");
  const dots = coords
    .map((point, index) => {
      const forecastClass = series[index]?.is_forecast ? " is-forecast" : "";
      return `<circle class="line-point${forecastClass}" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.8"></circle>`;
    })
    .join("");

  container.innerHTML = `
    <svg viewBox="0 0 520 220" preserveAspectRatio="none" aria-label="Employee growth line chart">
      ${gridLines}
      <path class="line-fill" d="${areaPath}"></path>
      <path class="line-stroke" d="${linePath}"></path>
      ${dots}
    </svg>
    <div class="x-axis">
      ${labels.map((label) => `<span>${label}</span>`).join("")}
    </div>
  `;
}

function renderDepartmentDistribution(items) {
  const donut = document.getElementById("department-donut");
  const list = document.getElementById("department-list");
  if (!donut || !list) {
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    donut.style.background = "conic-gradient(#94a3b8 0 100%)";
    list.innerHTML = "<li><span class=\"dot\" style=\"background:#94a3b8\"></span>No department data found</li>";
    return;
  }

  const colors = ["#2563eb", "#7c3aed", "#e11d48", "#0ea5e9", "#0f766e", "#f59e0b"];
  const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0) || 1;
  let offset = 0;

  const gradientStops = items
    .map((item, index) => {
      const value = Number(item.value) || 0;
      const pct = (value / total) * 100;
      const color = colors[index % colors.length];
      const start = offset;
      const end = offset + pct;
      offset = end;
      return `${color} ${start}% ${end}%`;
    })
    .join(", ");

  donut.style.background = `conic-gradient(${gradientStops})`;

  list.innerHTML = items
    .map((item, index) => {
      const value = Number(item.value) || 0;
      const pct = ((value / total) * 100).toFixed(1);
      const color = colors[index % colors.length];
      return `<li><span class="dot" style="background:${color}"></span>${item.label} (${pct}%)</li>`;
    })
    .join("");
}

function renderBreakdownList(containerId, items, emptyMessage) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = `<div class="breakdown-empty">${emptyMessage}</div>`;
    return;
  }

  const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0) || 1;
  const max = Math.max(1, ...items.map((item) => Number(item.value) || 0));

  container.innerHTML = items
    .map((item) => {
      const value = Number(item.value) || 0;
      const width = Math.max(8, Math.round((value / max) * 100));
      const share = ((value / total) * 100).toFixed(1);
      return `
        <div class="breakdown-row" title="${escapeHtml(item.label)}: ${formatCurrency(value)}">
          <div class="breakdown-copy">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${share}% of tracked spend</span>
          </div>
          <div class="breakdown-bar">
            <i style="--w:${width}"></i>
          </div>
          <div class="breakdown-value">${formatCompactCurrency(value)}</div>
        </div>
      `;
    })
    .join("");
}

function renderRecurringBreakdown(recurringSpend, oneOffSpend) {
  const container = document.getElementById("recurring-breakdown");
  if (!container) {
    return;
  }

  const total = recurringSpend + oneOffSpend;
  if (!total) {
    container.innerHTML = "<div class=\"breakdown-empty\">Not enough merchant detail is available yet to separate repeat spend.</div>";
    return;
  }

  const recurringShare = (recurringSpend / total) * 100;
  const oneOffShare = 100 - recurringShare;
  container.innerHTML = `
    <div class="split-bar" aria-hidden="true">
      <i class="split-bar-recurring" style="--w:${recurringShare.toFixed(1)}"></i>
      <i class="split-bar-oneoff" style="--w:${oneOffShare.toFixed(1)}"></i>
    </div>
    <div class="split-summary-grid">
      <div class="split-summary-card">
        <span>Recurring spend</span>
        <strong>${formatCurrency(recurringSpend)}</strong>
        <p>${recurringShare.toFixed(1)}% of tracked spend</p>
      </div>
      <div class="split-summary-card">
        <span>One-off spend</span>
        <strong>${formatCurrency(oneOffSpend)}</strong>
        <p>${oneOffShare.toFixed(1)}% of tracked spend</p>
      </div>
    </div>
  `;
}

function renderAlerts(items) {
  const container = document.getElementById("alerts-list");
  if (!container) {
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = `
      <article class="alert-item is-neutral">
        <div>
          <h4>No unusual payments stand out right now</h4>
          <p>Recent spend is moving within the normal range of your tracked transactions.</p>
        </div>
        <span>Stable</span>
      </article>
    `;
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const vendor = item.vendor || item.category || "Unlabelled vendor";
      const when = item.date ? formatDateLabel(item.date) : "Recent";
      return `
        <article class="alert-item is-warning">
          <div>
            <h4>${escapeHtml(vendor)} needs review</h4>
            <p>${formatCurrency(item.amount)} posted on ${when}, which is above your recent spending pattern.</p>
          </div>
          <span>Review</span>
        </article>
      `;
    })
    .join("");
}

function renderKeyInsights(insights) {
  const container = document.getElementById("key-insights-list");
  if (!container) {
    return;
  }

  if (!Array.isArray(insights) || insights.length === 0) {
    container.innerHTML = `
      <article class="insight-item">
        <h4>Waiting for enough data</h4>
        <p>The dashboard will surface plain-English highlights as soon as recent spend and headcount data are available.</p>
      </article>
    `;
    return;
  }

  container.innerHTML = insights
    .map((insight) => `
      <article class="insight-item">
        <h4>${escapeHtml(insight.title)}</h4>
        <p>${escapeHtml(insight.body)}</p>
      </article>
    `)
    .join("");
}

function buildKeyInsights({ spendMetrics, employeeMetrics, largestDepartment, financeAnalytics }) {
  const insights = [];

  if (Number.isFinite(spendMetrics.spendChangePercent)) {
    insights.push({
      title: "Spend movement",
      body: `Company spend is ${formatWholePercent(spendMetrics.spendChangePercent)} versus last month.`
    });
  } else if (spendMetrics.currentSpend > 0) {
    insights.push({
      title: "Spend this month",
      body: `Tracked company spend is currently ${formatCurrency(spendMetrics.currentSpend)} this month.`
    });
  }

  if (largestDepartment) {
    insights.push({
      title: "Largest team",
      body: `${largestDepartment.label} remains your largest department by headcount.`
    });
  }

  if (financeAnalytics.unusualExpenses.length) {
    insights.push({
      title: "Costs to review",
      body: `${financeAnalytics.unusualExpenses.length} payment${financeAnalytics.unusualExpenses.length === 1 ? "" : "s"} stand out from the recent spending pattern.`
    });
  } else if (employeeMetrics.growthCount > 0) {
    insights.push({
      title: "Hiring pace",
      body: `Headcount increased by ${employeeMetrics.growthCount} in the latest reported period.`
    });
  } else if (Number.isFinite(employeeMetrics.projectedGrowthPercent)) {
    insights.push({
      title: "Workforce outlook",
      body: `The forecast points to ${formatWholePercent(employeeMetrics.projectedGrowthPercent)} employee growth across the current outlook window.`
    });
  }

  return insights.slice(0, 3);
}

function renderDashboard(payload) {
  const metrics = payload.metrics || {};
  const charts = payload.charts || {};
  const spendMetrics = getMonthlySpendMetrics(charts.revenue_expenses || []);
  const employeeMetrics = getEmployeeMetrics(charts, metrics);
  const largestDepartment = getLargestDepartment(charts.department_distribution || []);
  const financeAnalytics = buildFinanceAnalytics(latestFinanceRowsState.rows);
  const dataHealth = metrics.data_health || {};
  const confidenceValue = Number(dataHealth.value_percent);
  const insights = buildKeyInsights({
    spendMetrics,
    employeeMetrics,
    largestDepartment,
    financeAnalytics
  });

  const spendDifference = spendMetrics.currentSpend - spendMetrics.previousSpend;
  const largestCategory = financeAnalytics.categoryBreakdown[0] || null;
  const unusualExpenseCount = financeAnalytics.unusualExpenses.length;
  const dashboardSummary = document.getElementById("dashboard-summary");
  const lastUpdatedValue = document.getElementById("dashboard-last-updated");
  const lastUpdatedSubtitle = document.getElementById("dashboard-last-updated-subtitle");
  const confidenceMetric = document.getElementById("dashboard-confidence-value");
  const confidenceSubtitle = document.getElementById("dashboard-confidence-subtitle");
  const employeeGrowthSummary = document.getElementById("employee-growth-summary");
  const departmentSummary = document.getElementById("department-summary");

  if (dashboardSummary) {
    dashboardSummary.textContent = spendMetrics.currentSpend > 0
      ? `${formatCurrency(spendMetrics.currentSpend)} has been tracked this month while headcount sits at ${employeeMetrics.totalEmployees.toLocaleString()}.`
      : `Headcount sits at ${employeeMetrics.totalEmployees.toLocaleString()} while the dashboard gathers the latest spend detail.`;
  }

  if (lastUpdatedValue) {
    lastUpdatedValue.textContent = formatBusinessDateTime(payload.generated_at || latestFinanceRowsState.refreshedAt);
  }
  if (lastUpdatedSubtitle) {
    const latestSyncDetail = payload?.sources?.latest_prediction_last_modified || latestFinanceRowsState.refreshedAt;
    lastUpdatedSubtitle.textContent = latestSyncDetail
      ? `Last full dashboard refresh: ${formatBusinessDateTime(latestSyncDetail)}`
      : "Waiting for the first full refresh.";
  }
  if (confidenceMetric) {
    confidenceMetric.textContent = Number.isFinite(confidenceValue) ? `${Math.abs(confidenceValue).toFixed(0)}%` : "--";
  }
  if (confidenceSubtitle) {
    confidenceSubtitle.textContent = dataHealth.subtitle || "Confidence improves as more finance and employee rows are processed.";
  }

  setMetric(
    "metric-total-spend",
    formatCurrency(spendMetrics.currentSpend),
    spendMetrics.currentSpend > 0
      ? "Tracked spend so far this month."
      : "Waiting for enough finance history to total this month."
  );
  setMetricTrend("metric-total-spend", "Current month", spendMetrics.currentSpend > 0 ? "neutral" : "muted");

  setMetric(
    "metric-spend-change",
    Number.isFinite(spendMetrics.spendChangePercent) ? formatWholePercent(spendMetrics.spendChangePercent) : "--",
    Number.isFinite(spendMetrics.spendChangePercent)
      ? `${formatCurrency(Math.abs(spendDifference))} ${spendDifference >= 0 ? "more" : "less"} than last month.`
      : "A prior month comparison is not available yet."
  );
  setMetricTrend(
    "metric-spend-change",
    Number.isFinite(spendMetrics.spendChangePercent)
      ? spendDifference > 0 ? "Higher spend" : spendDifference < 0 ? "Lower spend" : "Flat month"
      : "Waiting for history",
    !Number.isFinite(spendMetrics.spendChangePercent)
      ? "muted"
      : spendDifference > 0
        ? "warning"
        : spendDifference < 0
          ? "positive"
          : "neutral"
  );

  setMetric(
    "metric-total-employees",
    employeeMetrics.totalEmployees.toLocaleString(),
    largestDepartment
      ? `${largestDepartment.label} is currently the largest department.`
      : "Department data will appear once employee records load."
  );
  setMetricTrend(
    "metric-total-employees",
    Number.isFinite(employeeMetrics.totalEmployeeDelta)
      ? `${formatWholePercent(employeeMetrics.totalEmployeeDelta)} vs baseline`
      : "Latest headcount",
    Number.isFinite(employeeMetrics.totalEmployeeDelta) && employeeMetrics.totalEmployeeDelta > 0 ? "positive" : "neutral"
  );

  setMetric(
    "metric-employee-growth",
    formatSignedCount(employeeMetrics.growthCount),
    employeeMetrics.growthCount === 0
      ? "No net headcount change in the latest reported period."
      : `${Math.abs(employeeMetrics.growthCount)} ${employeeMetrics.growthCount > 0 ? "new hires" : "fewer employees"} in the latest reported period.`
  );
  setMetricTrend(
    "metric-employee-growth",
    Number.isFinite(employeeMetrics.projectedGrowthPercent)
      ? `Forecast ${formatWholePercent(employeeMetrics.projectedGrowthPercent)}`
      : "Recent movement",
    employeeMetrics.growthCount > 0 ? "positive" : employeeMetrics.growthCount < 0 ? "warning" : "neutral"
  );

  setMetric(
    "metric-unusual-expenses",
    unusualExpenseCount.toLocaleString(),
    unusualExpenseCount
      ? `${unusualExpenseCount} transaction${unusualExpenseCount === 1 ? "" : "s"} need review.`
      : "No unusual transactions are standing out right now."
  );
  setMetricTrend(
    "metric-unusual-expenses",
    unusualExpenseCount ? "Needs review" : "Normal range",
    unusualExpenseCount ? "warning" : "positive"
  );

  setMetric(
    "metric-largest-category",
    largestCategory ? largestCategory.label : "--",
    largestCategory
      ? `${formatCurrency(largestCategory.value)} in recent tracked spend.`
      : "Category labels will appear when transaction tags are available."
  );
  setMetricTrend(
    "metric-largest-category",
    largestCategory ? `${((largestCategory.value / (financeAnalytics.expenses.reduce((sum, row) => sum + row.amount, 0) || 1)) * 100).toFixed(1)}% share` : "Waiting for tags",
    largestCategory ? "neutral" : "muted"
  );

  if (employeeGrowthSummary) {
    employeeGrowthSummary.textContent = employeeMetrics.growthCount > 0
      ? `${employeeMetrics.growthCount} more employees than the prior reported point.`
      : employeeMetrics.growthCount < 0
        ? `${Math.abs(employeeMetrics.growthCount)} fewer employees than the prior reported point.`
        : "Headcount has remained steady across the latest reported points.";
  }

  if (departmentSummary) {
    departmentSummary.textContent = largestDepartment
      ? `${largestDepartment.label} accounts for the largest share of current headcount.`
      : "Department mix will appear once employee records are available.";
  }

  renderEmployeeGrowth(charts.employee_growth || []);
  renderDepartmentDistribution(charts.department_distribution || []);
  renderBreakdownList("category-breakdown", financeAnalytics.categoryBreakdown, "Category tags are not available yet in the recent finance rows.");
  renderBreakdownList("vendor-breakdown", financeAnalytics.vendorBreakdown, "Vendor names are not available yet in the recent finance rows.");
  renderRecurringBreakdown(financeAnalytics.recurringSpend, financeAnalytics.oneOffSpend);
  renderBreakdownList("department-spend-breakdown", financeAnalytics.departmentBreakdown, "No department tags were found in the tracked spend yet.");
  renderKeyInsights(insights);
  renderAlerts(financeAnalytics.unusualExpenses);
}

function renderRevenueForecast(items) {
  const container = document.getElementById("revenue-forecast-list");
  if (!container) {
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = "<div><span>--</span><b>No forecast data</b></div>";
    return;
  }

  container.innerHTML = items
    .slice(0, 6)
    .map((item) => {
      const value = Number(item.predicted_revenue || 0);
      return `<div><span>${formatDateLabel(item.date)}</span><b>${formatCurrency(value)}</b></div>`;
    })
    .join("");
}

function renderHeadcountForecast(items) {
  const container = document.getElementById("headcount-forecast-bars");
  if (!container) {
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = "<div><label>Current</label><i style=\"--w:0\"></i><span>--</span></div>";
    return;
  }

  const values = items.map((item) => Number(item.predicted_headcount || 0));
  const current = values[0] || 0;
  const peak = Math.max(...values);
  const end = values[values.length - 1] || 0;
  const max = Math.max(1, peak);

  const rows = [
    { label: "Current", value: current, display: current.toFixed(0) },
    { label: "Peak", value: peak, display: peak.toFixed(0) },
    { label: "End", value: end, display: end.toFixed(0) }
  ];

  container.innerHTML = rows
    .map((row) => {
      const width = Math.max(10, Math.round((row.value / max) * 100));
      return `<div><label>${row.label}</label><i style="--w:${width}"></i><span>${row.display}</span></div>`;
    })
    .join("");
}

function renderForecasts(payload) {
  const meta = document.getElementById("forecast-generated-at");
  if (meta) {
    if (payload.generated_at) {
      meta.textContent = `Predictions generated: ${new Date(payload.generated_at).toLocaleString()}`;
    } else {
      meta.textContent = "No prediction file available yet.";
    }
  }

  renderRevenueForecast(payload.revenue_forecast || []);
  renderHeadcountForecast(payload.employee_growth_forecast || []);
}

function renderQueryResult(payload) {
  const head = document.getElementById("query-results-head");
  const body = document.getElementById("query-results-body");
  const meta = document.getElementById("query-results-meta");

  if (!head || !body || !meta) {
    return;
  }

  const columns = Array.isArray(payload.columns) ? payload.columns : [];
  const rows = Array.isArray(payload.rows) ? payload.rows : [];

  if (columns.length === 0) {
    head.innerHTML = "<tr><th>No columns returned</th></tr>";
    body.innerHTML = "<tr><td>Query completed with no results.</td></tr>";
  } else {
    head.innerHTML = `<tr>${columns.map((column) => `<th>${column}</th>`).join("")}</tr>`;
    body.innerHTML =
      rows.length === 0
        ? `<tr><td colspan="${columns.length}">No rows returned.</td></tr>`
        : rows
            .map((row) => {
              const tds = columns.map((column) => `<td>${row[column] ?? ""}</td>`).join("");
              return `<tr>${tds}</tr>`;
            })
            .join("");
  }

  meta.textContent = `${payload.row_count || 0} rows returned. Query ID: ${payload.query_execution_id || "n/a"}`;
}

async function runQuery(getAuthToken) {
  const elements = getQueryFormElements();
  const input = document.getElementById("query-input");
  const status = elements.status;
  if (!status) {
    return;
  }

  const hasBuilder = elements.databaseSelect && elements.rowSelect && elements.limitSelect;
  const query = hasBuilder
    ? buildQueryFromControls({
        database: elements.databaseSelect.value,
        projection: elements.rowSelect.value,
        limit: elements.limitSelect.value
      })
    : input?.value?.trim();

  if (!query) {
    status.textContent = "Select a database and row option first.";
    return;
  }

  status.textContent = "Running query...";
  try {
    const payload = await getJSON("/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        limit: 100
      })
    }, getAuthToken);

    renderQueryResult(payload);
    status.textContent = "Query completed.";
  } catch (error) {
    status.textContent = `Query failed: ${error.message}`;
  }
}

async function refreshDashboard(getAuthToken) {
  const payload = await getJSON("/dashboard", undefined, getAuthToken);
  latestDashboardPayload = payload || {};
  renderDashboard(payload);
}

async function refreshForecasts(getAuthToken) {
  const payload = await getJSON("/forecasts", undefined, getAuthToken);
  renderForecasts(payload);
}

export function initInsightsData({ getAuthToken = () => "" } = {}) {
  const queryButton = document.getElementById("query-run-btn");
  const handleFinanceRowsUpdated = (event) => {
    latestFinanceRowsState = event?.detail || latestFinanceRowsState;
    if (latestDashboardPayload) {
      renderDashboard(latestDashboardPayload);
    }
  };

  if (queryButton) {
    queryButton.addEventListener("click", () => {
      runQuery(getAuthToken);
    });
  }

  if (!API_BASE_URL) {
    const status = document.getElementById("query-status");
    if (status) {
      status.textContent = "VITE_API_BASE_URL is missing.";
    }
    return () => {};
  }

  const refreshAll = async () => {
    await Promise.allSettled([refreshDashboard(getAuthToken), refreshForecasts(getAuthToken)]);
  };

  if (window.__smartstreamFinanceRowsState) {
    latestFinanceRowsState = window.__smartstreamFinanceRowsState;
  }
  window.addEventListener("smartstream:finance-rows-updated", handleFinanceRowsUpdated);

  refreshAll();
  const timer = window.setInterval(refreshAll, 20000);

  void initializeQueryPage(getAuthToken);
  initializeCreateGraphPage();

  return () => {
    window.clearInterval(timer);
    window.removeEventListener("smartstream:finance-rows-updated", handleFinanceRowsUpdated);
  };
}
