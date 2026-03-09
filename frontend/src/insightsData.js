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
const DEFAULT_FORECAST_HORIZON_DAYS = 30;
const FORECAST_ACTUAL_WINDOW_BY_HORIZON = {
  7: 14,
  30: 30,
  90: 60
};

let latestDashboardPayload = null;
let latestForecastPayload = null;
let latestFinanceRowsState = {
  rows: [],
  columns: [],
  refreshedAt: null
};
const forecastViewState = {
  horizonDays: DEFAULT_FORECAST_HORIZON_DAYS,
  focus: "all"
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

function parseBusinessDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const [year, month, day] = value.split("-").map((part) => Number(part));
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  return parseDate(value);
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

function formatLongDate(value) {
  const date = parseBusinessDate(value);
  if (!date) {
    return String(value || "--");
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatCount(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return Math.round(value).toLocaleString();
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

function toDayKey(value) {
  const date = parseBusinessDate(value);
  if (!date) {
    return "";
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value, days) {
  const date = parseBusinessDate(value);
  if (!date) {
    return null;
  }

  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getMonthKey(value) {
  const date = parseBusinessDate(value);
  if (!date) {
    return "";
  }
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function getPreviousMonthKey(value) {
  const date = parseBusinessDate(value);
  if (!date) {
    return "";
  }
  return `${date.getMonth() === 0 ? date.getFullYear() - 1 : date.getFullYear()}-${date.getMonth() === 0 ? 11 : date.getMonth() - 1}`;
}

function getDaysRemainingInMonth(value) {
  const date = parseBusinessDate(value);
  if (!date) {
    return 0;
  }

  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12, 0, 0, 0);
  return Math.max(0, Math.round((monthEnd - date) / 86400000));
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

function getLastItem(items) {
  return Array.isArray(items) && items.length ? items[items.length - 1] : null;
}

function averageValues(values) {
  const valid = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(value));
  if (!valid.length) {
    return null;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function buildDailySpendHistory(rows) {
  const totals = new Map();

  normalizeFinanceRows(rows)
    .filter((row) => row.flow === "expenditure" && row.dayKey)
    .forEach((row) => {
      totals.set(row.dayKey, (totals.get(row.dayKey) || 0) + (Number(row.amount) || 0));
    });

  return Array.from(totals.entries())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([dayKey, value]) => ({
      dayKey,
      date: parseBusinessDate(dayKey),
      value: Number(value) || 0,
      axisLabel: formatDateLabel(dayKey),
      tooltipLabel: formatLongDate(dayKey),
      isForecast: false
    }))
    .filter((point) => point.date);
}

function buildSpendActualWindow(dailySeries, horizonDays) {
  const series = Array.isArray(dailySeries) ? dailySeries : [];
  if (!series.length) {
    return [];
  }

  const latest = getLastItem(series);
  const pointsByDay = new Map(series.map((point) => [point.dayKey, point]));
  const daysToShow = FORECAST_ACTUAL_WINDOW_BY_HORIZON[horizonDays] || DEFAULT_FORECAST_HORIZON_DAYS;
  const startDate = addDays(latest.date, -(daysToShow - 1));
  const window = [];

  for (let cursor = new Date(startDate); cursor <= latest.date; cursor = addDays(cursor, 1)) {
    const dayKey = toDayKey(cursor);
    const point = pointsByDay.get(dayKey);
    window.push({
      dayKey,
      date: parseBusinessDate(dayKey),
      value: point ? point.value : 0,
      axisLabel: formatDateLabel(dayKey),
      tooltipLabel: formatLongDate(dayKey),
      isForecast: false
    });
  }

  return window;
}

function normalizeSpendForecastSeries(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const date = parseBusinessDate(item?.date);
      const value = Number(item?.predicted_expenditure ?? item?.predicted_revenue);
      if (!date || !Number.isFinite(value)) {
        return null;
      }

      const lower = parseNumeric(item?.lower_ci);
      const upper = parseNumeric(item?.upper_ci);
      return {
        date,
        value: Math.max(0, value),
        lower_ci: Number.isFinite(lower) ? Math.max(0, lower) : null,
        upper_ci: Number.isFinite(upper) ? Math.max(0, upper) : null,
        axisLabel: formatDateLabel(date),
        tooltipLabel: formatLongDate(date),
        isForecast: true
      };
    })
    .filter(Boolean);
}

function normalizeHeadcountForecastSeries(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const date = parseBusinessDate(item?.date);
      const value = Number(item?.predicted_headcount);
      if (!date || !Number.isFinite(value)) {
        return null;
      }

      const lower = parseNumeric(item?.lower_ci);
      const upper = parseNumeric(item?.upper_ci);
      return {
        date,
        value: Math.max(0, Math.round(value)),
        lower_ci: Number.isFinite(lower) ? Math.max(0, Math.round(lower)) : null,
        upper_ci: Number.isFinite(upper) ? Math.max(0, Math.round(upper)) : null,
        axisLabel: formatDateLabel(date),
        tooltipLabel: formatLongDate(date),
        isForecast: true
      };
    })
    .filter(Boolean);
}

function buildHeadcountActualSeries(dashboardPayload, currentHeadcount) {
  const points = Array.isArray(dashboardPayload?.charts?.employee_growth)
    ? dashboardPayload.charts.employee_growth.filter((point) => !point.is_forecast)
    : [];
  const limit = forecastViewState.horizonDays >= 90 ? 8 : forecastViewState.horizonDays >= 30 ? 6 : 5;
  const series = points.slice(-limit).map((point, index) => ({
    label: point.label || `Point ${index + 1}`,
    axisLabel: point.label || `Point ${index + 1}`,
    tooltipLabel: point.label || `Point ${index + 1}`,
    value: Number(point.value) || 0,
    isForecast: false
  }));

  if (!series.length && Number.isFinite(currentHeadcount) && currentHeadcount > 0) {
    return [
      {
        label: "Current",
        axisLabel: "Current",
        tooltipLabel: "Current reported headcount",
        value: Math.round(currentHeadcount),
        isForecast: false
      }
    ];
  }

  return series;
}

function calculateMonthEndProjection(actualDailySeries, spendForecastSeries) {
  const actualSeries = Array.isArray(actualDailySeries) ? actualDailySeries : [];
  if (!actualSeries.length) {
    return {
      currentMonthActual: null,
      projectedMonthEndSpend: null,
      previousMonthSpend: null,
      projectedVsLastMonth: null,
      coverageDays: 0,
      fallbackDays: 0,
      latestActualDate: null
    };
  }

  const latestActual = getLastItem(actualSeries);
  const currentMonthKey = getMonthKey(latestActual.date);
  const previousMonthKey = getPreviousMonthKey(latestActual.date);
  const currentMonthActual = actualSeries
    .filter((point) => getMonthKey(point.date) === currentMonthKey)
    .reduce((sum, point) => sum + point.value, 0);
  const previousMonthSpend = actualSeries
    .filter((point) => getMonthKey(point.date) === previousMonthKey)
    .reduce((sum, point) => sum + point.value, 0);
  const remainingDays = getDaysRemainingInMonth(latestActual.date);
  const monthEndForecast = (Array.isArray(spendForecastSeries) ? spendForecastSeries : [])
    .filter((point) => point.date > latestActual.date && getMonthKey(point.date) === currentMonthKey);
  const coverageDays = monthEndForecast.length;
  const missingDays = Math.max(0, remainingDays - coverageDays);
  const averageForecastValue = averageValues(monthEndForecast.map((point) => point.value))
    ?? averageValues((Array.isArray(spendForecastSeries) ? spendForecastSeries : []).map((point) => point.value))
    ?? 0;
  const forecastedSpend = monthEndForecast.reduce((sum, point) => sum + point.value, 0);
  const projectedMonthEndSpend = currentMonthActual + forecastedSpend + (missingDays ? averageForecastValue * missingDays : 0);
  const projectedVsLastMonth = previousMonthSpend > 0
    ? ((projectedMonthEndSpend - previousMonthSpend) / previousMonthSpend) * 100
    : null;

  return {
    currentMonthActual,
    projectedMonthEndSpend,
    previousMonthSpend,
    projectedVsLastMonth,
    coverageDays,
    fallbackDays: missingDays,
    latestActualDate: latestActual.date
  };
}

function getAverageIntervalRatio(series) {
  const points = (Array.isArray(series) ? series : []).filter((point) =>
    Number.isFinite(point.value) && Number.isFinite(point.lower_ci) && Number.isFinite(point.upper_ci)
  );

  if (!points.length) {
    return null;
  }

  return points.reduce((sum, point) => {
    const spread = Math.max(0, (point.upper_ci || 0) - (point.lower_ci || 0));
    return sum + spread / Math.max(1, point.value);
  }, 0) / points.length;
}

function deriveForecastConfidence(dashboardPayload, spendForecastSeries, headcountForecastSeries) {
  const healthScore = Number(dashboardPayload?.metrics?.data_health?.value_percent);
  const intervalRatio = averageValues([
    getAverageIntervalRatio(spendForecastSeries),
    getAverageIntervalRatio(headcountForecastSeries)
  ]);

  let intervalScore = 68;
  if (Number.isFinite(intervalRatio)) {
    if (intervalRatio <= 0.15) {
      intervalScore = 90;
    } else if (intervalRatio <= 0.3) {
      intervalScore = 76;
    } else if (intervalRatio <= 0.45) {
      intervalScore = 61;
    } else {
      intervalScore = 46;
    }
  }

  const score = Math.round(
    (Number.isFinite(healthScore) ? healthScore : intervalScore) * 0.65 +
    intervalScore * 0.35
  );

  if (score >= 78) {
    return {
      score,
      label: "High",
      tone: "positive",
      summary: "Recent spend and workforce patterns are consistent, and the prediction ranges remain relatively tight."
    };
  }

  if (score >= 58) {
    return {
      score,
      label: "Medium",
      tone: "muted",
      summary: "The outlook is directionally useful, but later forecast points carry a wider range of likely outcomes."
    };
  }

  return {
    score,
    label: "Low",
    tone: "warning",
    summary: "Use this as a planning guide only for now. The recent data pattern is less stable and the prediction range is wider."
  };
}

function deriveForecastRisk({
  projectedVsLastMonth,
  unusualExpenseCount,
  confidenceScore,
  headcountChange
}) {
  let score = 0;
  const reasons = [];

  if (Number.isFinite(projectedVsLastMonth) && projectedVsLastMonth >= 10) {
    score += 2;
    reasons.push("spend is tracking materially above last month");
  } else if (Number.isFinite(projectedVsLastMonth) && projectedVsLastMonth >= 4) {
    score += 1;
    reasons.push("spend is trending above last month");
  }

  if ((Number(unusualExpenseCount) || 0) > 0) {
    score += 1;
    reasons.push("recent transactions are less predictable");
  }

  if (Number.isFinite(confidenceScore) && confidenceScore < 58) {
    score += 1;
    reasons.push("forecast confidence is limited");
  }

  if (Number.isFinite(headcountChange) && headcountChange >= 5) {
    score += 1;
    reasons.push("payroll demand is increasing");
  }

  if (score >= 3) {
    return {
      label: "High",
      tone: "warning",
      summary: reasons[0]
        ? `High risk of plan drift because ${reasons.slice(0, 2).join(" and ")}.`
        : "High risk of plan drift."
    };
  }

  if (score >= 1) {
    return {
      label: "Medium",
      tone: "muted",
      summary: reasons[0]
        ? `Some variance is worth watching because ${reasons.slice(0, 2).join(" and ")}.`
        : "Some variance is worth watching."
    };
  }

  return {
    label: "Low",
    tone: "positive",
    summary: "No major overspend or hiring spike stands out in the current forecast window."
  };
}

function buildForecastSummaryCards({
  monthProjection,
  projectedHeadcount,
  headcountIncrease,
  risk,
  confidence,
  selectedHorizon,
  spendWindowDays
}) {
  const spendTone = Number.isFinite(monthProjection.projectedVsLastMonth)
    ? monthProjection.projectedVsLastMonth > 0
      ? "warning"
      : "positive"
    : "muted";
  const spendComparison = Number.isFinite(monthProjection.projectedVsLastMonth)
    ? `${Math.abs(monthProjection.projectedVsLastMonth).toFixed(1)}% ${monthProjection.projectedVsLastMonth >= 0 ? "higher" : "lower"}`
    : "Awaiting prior-month baseline";

  return [
    {
      title: "Projected Month-End Spend",
      value: formatCurrency(monthProjection.projectedMonthEndSpend),
      subtitle: monthProjection.projectedMonthEndSpend
        ? "Expected by month end based on current spend pace."
        : "Waiting for enough spend history to estimate month end.",
      trend: `${spendWindowDays} days of actual spend in view`,
      tone: "muted"
    },
    {
      title: "Spend Forecast vs Last Month",
      value: Number.isFinite(monthProjection.projectedVsLastMonth) ? formatWholePercent(monthProjection.projectedVsLastMonth) : "--",
      subtitle: Number.isFinite(monthProjection.projectedVsLastMonth)
        ? `${spendComparison} than last month.`
        : "Comparison appears after a full prior month is available.",
      trend: spendComparison,
      tone: spendTone
    },
    {
      title: "Projected Headcount",
      value: formatCount(projectedHeadcount),
      subtitle: projectedHeadcount
        ? `Expected by the end of the next ${selectedHorizon} days.`
        : "Waiting for enough employee history to project headcount.",
      trend: Number.isFinite(headcountIncrease)
        ? `${formatSignedCount(headcountIncrease)} from today`
        : "No current baseline",
      tone: Number.isFinite(headcountIncrease) && headcountIncrease > 0 ? "positive" : "muted"
    },
    {
      title: "Forecast Risk Level",
      value: risk.label,
      subtitle: risk.summary,
      trend: risk.label === "High" ? "Requires attention" : risk.label === "Medium" ? "Monitor closely" : "Stable outlook",
      tone: risk.tone
    },
    {
      title: "Forecast Confidence",
      value: Number.isFinite(confidence.score) ? `${confidence.score}%` : confidence.label,
      subtitle: "Based on recent data consistency and forecast range width.",
      trend: `${confidence.label} confidence`,
      tone: confidence.tone
    }
  ];
}

function buildForecastHighlights({
  monthProjection,
  selectedHorizon,
  headcountIncrease,
  projectedHeadcount,
  currentHeadcount,
  risk,
  confidence,
  financeAnalytics
}) {
  const largestCategory = financeAnalytics.categoryBreakdown[0] || null;
  const unusualExpenseCount = financeAnalytics.unusualExpenses.length;
  const notes = [];

  if (Number.isFinite(monthProjection.projectedVsLastMonth)) {
    notes.push({
      metric: "spend",
      tag: "Spend",
      tone: monthProjection.projectedVsLastMonth > 0 ? "warning" : "positive",
      title: `Monthly spend is projected to finish ${Math.abs(monthProjection.projectedVsLastMonth).toFixed(1)}% ${monthProjection.projectedVsLastMonth >= 0 ? "above" : "below"} last month.`,
      body: "This compares projected month-end spend against the last completed month."
    });
  }

  if (Number.isFinite(headcountIncrease) && projectedHeadcount > 0) {
    notes.push({
      metric: "headcount",
      tag: "Headcount",
      tone: headcountIncrease > 0 ? "positive" : "muted",
      title: headcountIncrease > 0
        ? `Headcount is expected to rise by ${Math.abs(headcountIncrease)} over the next ${selectedHorizon} days.`
        : headcountIncrease < 0
          ? `Headcount is expected to ease by ${Math.abs(headcountIncrease)} over the next ${selectedHorizon} days.`
          : `Headcount is expected to remain steady over the next ${selectedHorizon} days.`,
      body: currentHeadcount
        ? `Current headcount is ${formatCount(currentHeadcount)} with a projected end point of ${formatCount(projectedHeadcount)}.`
        : "The forecast will sharpen as more workforce updates are processed."
    });
  }

  notes.push({
    metric: "all",
    tag: "Confidence",
    tone: confidence.tone,
    title: `Forecast confidence is ${confidence.label.toLowerCase()}.`,
    body: confidence.summary
  });

  if (largestCategory) {
    notes.push({
      metric: "spend",
      tag: "Cost driver",
      tone: "muted",
      title: `${largestCategory.label} remains the largest recent cost driver.`,
      body: `${formatCurrency(largestCategory.value)} of recent tracked spend sits in this category.`
    });
  }

  notes.push({
    metric: "all",
    tag: "Risk",
    tone: risk.tone,
    title: unusualExpenseCount
      ? `${unusualExpenseCount} unusual payment${unusualExpenseCount === 1 ? "" : "s"} could push spend above forecast.`
      : "No major spending spike is currently forecast.",
    body: unusualExpenseCount
      ? "Treat recent outlier transactions as early warning signals rather than one-off noise."
      : "The current forecast range does not show a sharp late-window spending jump."
  });

  return notes;
}

function buildForecastRisks({
  monthProjection,
  headcountIncrease,
  risk,
  confidence,
  financeAnalytics
}) {
  const largestCategory = financeAnalytics.categoryBreakdown[0] || null;
  const notes = [];

  if (Number.isFinite(monthProjection.projectedVsLastMonth) && monthProjection.projectedVsLastMonth > 4) {
    notes.push({
      metric: "spend",
      tag: "Spend pressure",
      tone: "warning",
      title: "Spend is trending above last month.",
      body: `Projected month-end spend is ${formatWholePercent(monthProjection.projectedVsLastMonth)} versus last month.`
    });
  }

  if (Number.isFinite(headcountIncrease) && headcountIncrease > 0) {
    notes.push({
      metric: "headcount",
      tag: "Payroll",
      tone: headcountIncrease >= 5 ? "warning" : "muted",
      title: "Payroll demand is likely to rise.",
      body: `${Math.abs(headcountIncrease)} additional employee${Math.abs(headcountIncrease) === 1 ? "" : "s"} are currently expected in the forecast window.`
    });
  }

  if (confidence.label !== "High") {
    notes.push({
      metric: "all",
      tag: "Confidence",
      tone: confidence.tone,
      title: "Forecast ranges widen later in the outlook window.",
      body: "Treat later dates as directional guidance and refresh the forecast after the next data sync."
    });
  }

  if (financeAnalytics.unusualExpenses.length) {
    notes.push({
      metric: "spend",
      tag: "Variability",
      tone: "warning",
      title: "Recent payments are less predictable than usual.",
      body: `${financeAnalytics.unusualExpenses.length} unusual transaction${financeAnalytics.unusualExpenses.length === 1 ? "" : "s"} stand out in recent spend activity.`
    });
  } else if (largestCategory) {
    notes.push({
      metric: "spend",
      tag: "Concentration",
      tone: "muted",
      title: `${largestCategory.label} is your largest current spend concentration.`,
      body: "A change in this cost area would move the month-end outcome faster than smaller categories."
    });
  }

  if (!notes.length) {
    notes.push({
      metric: "all",
      tag: "Risk",
      tone: risk.tone,
      title: "No immediate planning risk stands out.",
      body: risk.summary
    });
  }

  return notes;
}

function buildForecastActions({
  headcountIncrease,
  confidence,
  financeAnalytics,
  dashboardPayload
}) {
  const largestCategory = financeAnalytics.categoryBreakdown[0] || null;
  const largestDepartment = getLargestDepartment(dashboardPayload?.charts?.department_distribution || []);
  const notes = [];

  if (largestCategory) {
    notes.push({
      metric: "spend",
      tag: "Budget action",
      tone: "warning",
      title: "Review the highest recurring spend categories this week.",
      body: `${largestCategory.label} is the first place to look if spend continues to run above plan.`
    });
  }

  if (Number.isFinite(headcountIncrease) && headcountIncrease > 0) {
    notes.push({
      metric: "headcount",
      tag: "People planning",
      tone: "positive",
      title: "Prepare for moderate payroll growth over the next month.",
      body: `The current outlook points to ${Math.abs(headcountIncrease)} more employee${Math.abs(headcountIncrease) === 1 ? "" : "s"} than today.`
    });
  }

  if (largestDepartment) {
    notes.push({
      metric: "headcount",
      tag: "Department watch",
      tone: "muted",
      title: `Monitor ${largestDepartment.label} as your largest team.`,
      body: "Capacity or hiring changes in the largest department will have the biggest effect on workforce planning."
    });
  }

  notes.push({
    metric: "all",
    tag: "Refresh cadence",
    tone: confidence.tone,
    title: "Recheck the outlook after the next data refresh.",
    body: confidence.label === "High"
      ? "Use this forecast to plan with confidence, but still confirm after each major spend or hiring update."
      : "A fresh data sync should improve the forecast before you lock in decisions."
  });

  return notes;
}

function prioritizeForecastNotes(items, focus, limit = 4) {
  const notes = Array.isArray(items) ? items : [];
  if (focus === "all") {
    return notes.slice(0, limit);
  }

  return [
    ...notes.filter((item) => item.metric === focus),
    ...notes.filter((item) => item.metric === "all"),
    ...notes.filter((item) => item.metric !== focus && item.metric !== "all")
  ].slice(0, limit);
}

function renderForecastSummaryCards(cards) {
  const container = document.getElementById("forecast-summary-cards");
  if (!container) {
    return;
  }

  container.innerHTML = (Array.isArray(cards) ? cards : [])
    .map((card) => `
      <article class="panel metric-card-business forecast-kpi-card">
        <div class="metric-card-top">
          <h3>${escapeHtml(card.title)}</h3>
          <span class="metric-trend" data-tone="${escapeHtml(card.tone || "muted")}">${escapeHtml(card.trend || "--")}</span>
        </div>
        <strong>${escapeHtml(card.value || "--")}</strong>
        <p>${escapeHtml(card.subtitle || "")}</p>
      </article>
    `)
    .join("");
}

function renderForecastNotes(containerId, items, emptyTitle, emptyBody) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  const notes = Array.isArray(items) ? items : [];
  if (!notes.length) {
    container.innerHTML = `
      <article class="forecast-note-item" data-tone="muted">
        <span class="forecast-note-tag">Update pending</span>
        <h4>${escapeHtml(emptyTitle)}</h4>
        <p>${escapeHtml(emptyBody)}</p>
      </article>
    `;
    return;
  }

  container.innerHTML = notes
    .map((item) => `
      <article class="forecast-note-item" data-tone="${escapeHtml(item.tone || "muted")}">
        <span class="forecast-note-tag">${escapeHtml(item.tag || "Forecast")}</span>
        <h4>${escapeHtml(item.title || "")}</h4>
        <p>${escapeHtml(item.body || "")}</p>
      </article>
    `)
    .join("");
}

function renderForecastTrustRows(rows) {
  const container = document.getElementById("forecast-trust-list");
  if (!container) {
    return;
  }

  container.innerHTML = (Array.isArray(rows) ? rows : [])
    .map((row) => `
      <article class="forecast-trust-row">
        <span>${escapeHtml(row.label || "")}</span>
        <strong>${escapeHtml(row.value || "--")}</strong>
        <p>${escapeHtml(row.body || "")}</p>
      </article>
    `)
    .join("");
}

function renderHeadcountStatCards(items) {
  const container = document.getElementById("forecast-headcount-summary");
  if (!container) {
    return;
  }

  container.innerHTML = (Array.isArray(items) ? items : [])
    .map((item) => `
      <article class="forecast-stat-card">
        <span>${escapeHtml(item.label || "")}</span>
        <strong>${escapeHtml(item.value || "--")}</strong>
        <p>${escapeHtml(item.subtitle || "")}</p>
      </article>
    `)
    .join("");
}

function renderForecastDepartmentSummary(items) {
  const container = document.getElementById("forecast-department-summary");
  if (!container) {
    return;
  }

  const departments = Array.isArray(items) ? items : [];
  if (!departments.length) {
    container.innerHTML = "";
    return;
  }

  const total = departments.reduce((sum, item) => sum + (Number(item.value) || 0), 0) || 1;
  container.innerHTML = `
    <div class="forecast-department-copy">
      <span>Current team mix</span>
      <p>Largest departments today, shown to add context to the workforce forecast.</p>
    </div>
    <div class="forecast-department-chips">
      ${departments.slice(0, 4).map((item) => {
        const share = ((Number(item.value) || 0) / total) * 100;
        return `
          <span class="forecast-department-chip">
            <b>${escapeHtml(item.label || "Unknown")}</b>
            ${share.toFixed(0)}%
          </span>
        `;
      }).join("")}
    </div>
  `;
}

function buildLinearPath(points, closePath = false) {
  const coords = Array.isArray(points) ? points : [];
  if (!coords.length) {
    return "";
  }

  let path = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let index = 1; index < coords.length; index += 1) {
    path += ` L ${coords[index].x.toFixed(1)} ${coords[index].y.toFixed(1)}`;
  }

  return closePath ? `${path} Z` : path;
}

function pickForecastAxisLabels(series, slots = 6) {
  const points = Array.isArray(series) ? series : [];
  if (!points.length) {
    return Array.from({ length: slots }, () => "--");
  }

  if (points.length === 1) {
    return Array.from({ length: slots }, () => points[0].axisLabel || points[0].label || "--");
  }

  return Array.from({ length: slots }, (_, index) => {
    const ratio = index / (slots - 1);
    const pointIndex = Math.round(ratio * (points.length - 1));
    return points[pointIndex]?.axisLabel || points[pointIndex]?.label || "--";
  });
}

function bindForecastTooltip(containerId) {
  const container = document.getElementById(containerId);
  const shell = container?.querySelector(".forecast-chart-inner");
  const tooltip = container?.querySelector(".forecast-chart-tooltip");
  if (!container || !shell || !tooltip) {
    return;
  }

  const hideTooltip = () => {
    tooltip.hidden = true;
  };

  container.onmousemove = (event) => {
    const text = event.target?.dataset?.tooltip;
    if (!text) {
      hideTooltip();
      return;
    }

    tooltip.hidden = false;
    tooltip.textContent = text;

    const rect = shell.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    let left = event.clientX - rect.left + 12;
    let top = event.clientY - rect.top - tooltipRect.height - 12;

    if (left + tooltipRect.width > rect.width - 8) {
      left = rect.width - tooltipRect.width - 8;
    }
    if (left < 8) {
      left = 8;
    }
    if (top < 8) {
      top = event.clientY - rect.top + 14;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  container.onmouseleave = hideTooltip;
}

function renderForecastTrendChart({
  containerId,
  actualSeries,
  forecastSeries,
  formatter,
  emptyTitle,
  emptyBody,
  ariaLabel,
  type = "spend"
}) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  const actual = Array.isArray(actualSeries) ? actualSeries : [];
  const forecast = Array.isArray(forecastSeries) ? forecastSeries : [];
  if (!actual.length && !forecast.length) {
    container.innerHTML = `
      <div class="forecast-empty-state">
        <h4>${escapeHtml(emptyTitle)}</h4>
        <p>${escapeHtml(emptyBody)}</p>
      </div>
    `;
    container.classList.remove("skeleton-block");
    return;
  }

  const combined = [...actual, ...forecast];
  const width = 760;
  const height = 300;
  const paddingX = 26;
  const paddingY = 22;
  const chartHeight = height - paddingY * 2;
  const values = combined.flatMap((point) => [
    Number(point.value),
    Number.isFinite(point.lower_ci) ? Number(point.lower_ci) : Number(point.value),
    Number.isFinite(point.upper_ci) ? Number(point.upper_ci) : Number(point.value)
  ]).filter((value) => Number.isFinite(value));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spread = maxValue - minValue;
  const paddingValue = spread > 0 ? spread * 0.18 : Math.max(maxValue * 0.15, 1);
  const domainMin = Math.max(0, minValue - paddingValue);
  const domainMax = maxValue + paddingValue;
  const range = Math.max(1, domainMax - domainMin);
  const baselineY = height - paddingY;
  const toY = (value) => paddingY + ((domainMax - value) / range) * chartHeight;

  const coords = combined.map((point, index) => ({
    ...point,
    x: combined.length === 1
      ? width / 2
      : paddingX + (index / (combined.length - 1)) * (width - paddingX * 2),
    y: toY(Number(point.value) || 0)
  }));
  const actualCoords = coords.slice(0, actual.length);
  const forecastCoords = coords.slice(actual.length);
  const actualPath = actualCoords.length ? buildSmoothLinePath(actualCoords) : "";
  const actualArea = actualCoords.length ? buildAreaPath(actualCoords, baselineY, actualPath) : "";
  const forecastLineCoords = actualCoords.length && forecastCoords.length
    ? [actualCoords[actualCoords.length - 1], ...forecastCoords]
    : forecastCoords;
  const forecastPath = forecastLineCoords.length ? buildSmoothLinePath(forecastLineCoords) : "";
  const upperCoords = forecast.map((point, index) => ({
    x: forecastCoords[index]?.x || 0,
    y: toY(Number.isFinite(point.upper_ci) ? point.upper_ci : point.value)
  }));
  const lowerCoords = forecast.map((point, index) => ({
    x: forecastCoords[index]?.x || 0,
    y: toY(Number.isFinite(point.lower_ci) ? point.lower_ci : point.value)
  }));
  const confidenceBandPath = upperCoords.length && lowerCoords.length
    ? buildLinearPath([...upperCoords, ...lowerCoords.reverse()], true)
    : "";
  const dividerX = actualCoords.length && forecastCoords.length ? forecastCoords[0].x : null;
  const axisLabels = pickForecastAxisLabels(combined);
  const gridLines = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const y = paddingY + chartHeight * ratio;
    const value = domainMax - ratio * range;
    const axisValue = type === "spend" ? formatCompactCurrency(value) : formatCount(value);
    return `
      <line class="forecast-grid-line" x1="${paddingX}" y1="${y.toFixed(1)}" x2="${width - paddingX}" y2="${y.toFixed(1)}"></line>
      <text class="forecast-y-label" x="${paddingX}" y="${(y - 6).toFixed(1)}">${escapeHtml(axisValue)}</text>
    `;
  }).join("");

  const points = coords
    .map((point, index) => {
      const isForecast = index >= actual.length;
      const tooltipParts = [
        isForecast ? "Forecast" : "Actual",
        point.tooltipLabel || point.label || "--",
        formatter(point.value)
      ];
      if (isForecast && Number.isFinite(point.lower_ci) && Number.isFinite(point.upper_ci)) {
        tooltipParts.push(`Range ${formatter(point.lower_ci)} to ${formatter(point.upper_ci)}`);
      }
      const tooltipText = tooltipParts.join(" | ");
      return `
        <circle
          class="forecast-point ${isForecast ? "is-projected" : "is-actual"} ${type === "headcount" ? "is-headcount" : ""}"
          cx="${point.x.toFixed(1)}"
          cy="${point.y.toFixed(1)}"
          r="${type === "headcount" ? "4.8" : "4.6"}"
          data-tooltip="${escapeHtml(tooltipText)}"
        >
          <title>${escapeHtml(tooltipText)}</title>
        </circle>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="forecast-chart-shell ${type === "headcount" ? "is-headcount" : ""}">
      <div class="forecast-chart-inner">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="${escapeHtml(ariaLabel)}">
          ${gridLines}
          ${actualArea ? `<path class="forecast-actual-area ${type === "headcount" ? "is-headcount" : ""}" d="${actualArea}"></path>` : ""}
          ${confidenceBandPath ? `<path class="forecast-confidence-band ${type === "headcount" ? "is-headcount" : ""}" d="${confidenceBandPath}"></path>` : ""}
          ${dividerX ? `<line class="forecast-start-line" x1="${dividerX.toFixed(1)}" y1="${paddingY}" x2="${dividerX.toFixed(1)}" y2="${baselineY.toFixed(1)}"></line>` : ""}
          ${dividerX ? `<text class="forecast-start-label" x="${Math.min(width - 120, dividerX + 8).toFixed(1)}" y="${(paddingY + 12).toFixed(1)}">Forecast start</text>` : ""}
          ${actualPath ? `<path class="forecast-line is-actual ${type === "headcount" ? "is-headcount" : ""}" d="${actualPath}"></path>` : ""}
          ${forecastPath ? `<path class="forecast-line is-projected ${type === "headcount" ? "is-headcount" : ""}" d="${forecastPath}"></path>` : ""}
          ${points}
        </svg>
        <div class="forecast-chart-tooltip" hidden></div>
      </div>
      <div class="forecast-chart-axis">
        ${axisLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
      </div>
    </div>
  `;
  container.classList.remove("skeleton-block");
  bindForecastTooltip(containerId);
}

function buildForecastViewModel(payload) {
  const dashboardPayload = latestDashboardPayload || {};
  const financeAnalytics = buildFinanceAnalytics(latestFinanceRowsState.rows);
  const spendHistoryAll = buildDailySpendHistory(latestFinanceRowsState.rows);
  const spendActualSeries = buildSpendActualWindow(spendHistoryAll, forecastViewState.horizonDays);
  const spendForecastAll = normalizeSpendForecastSeries(payload?.expenditure_forecast || payload?.revenue_forecast || []);
  const spendForecast = spendForecastAll.slice(0, forecastViewState.horizonDays);
  const monthProjection = calculateMonthEndProjection(spendHistoryAll, spendForecastAll);
  const headcountForecastAll = normalizeHeadcountForecastSeries(payload?.employee_growth_forecast || []);
  const currentHeadcount = Number(dashboardPayload?.metrics?.total_employees?.value)
    || Number(getLastItem(headcountForecastAll)?.value)
    || 0;
  const headcountActualSeries = buildHeadcountActualSeries(dashboardPayload, currentHeadcount);
  const headcountForecast = headcountForecastAll.slice(0, forecastViewState.horizonDays);
  const projectedHeadcount = Number(getLastItem(headcountForecast)?.value ?? getLastItem(headcountForecastAll)?.value ?? currentHeadcount);
  const headcountIncrease = Number.isFinite(projectedHeadcount) ? projectedHeadcount - currentHeadcount : null;
  const peakProjectedHeadcount = Math.max(
    currentHeadcount || 0,
    ...headcountForecast.map((point) => Number(point.value) || 0)
  );
  const confidence = deriveForecastConfidence(dashboardPayload, spendForecastAll, headcountForecastAll);
  const risk = deriveForecastRisk({
    projectedVsLastMonth: monthProjection.projectedVsLastMonth,
    unusualExpenseCount: financeAnalytics.unusualExpenses.length,
    confidenceScore: confidence.score,
    headcountChange: headcountIncrease
  });
  const summaryCards = buildForecastSummaryCards({
    monthProjection,
    projectedHeadcount,
    headcountIncrease,
    risk,
    confidence,
    selectedHorizon: forecastViewState.horizonDays,
    spendWindowDays: spendActualSeries.length
  });
  const highlights = prioritizeForecastNotes(buildForecastHighlights({
    monthProjection,
    selectedHorizon: forecastViewState.horizonDays,
    headcountIncrease,
    projectedHeadcount,
    currentHeadcount,
    risk,
    confidence,
    financeAnalytics
  }), forecastViewState.focus, 4);
  const risks = prioritizeForecastNotes(buildForecastRisks({
    monthProjection,
    headcountIncrease,
    risk,
    confidence,
    financeAnalytics
  }), forecastViewState.focus, 4);
  const actions = prioritizeForecastNotes(buildForecastActions({
    headcountIncrease,
    confidence,
    financeAnalytics,
    dashboardPayload
  }), forecastViewState.focus, 4);
  const headcountStats = [
    {
      label: "Current Headcount",
      value: formatCount(currentHeadcount),
      subtitle: "Latest reported employee count."
    },
    {
      label: `Projected in ${forecastViewState.horizonDays} Days`,
      value: formatCount(projectedHeadcount),
      subtitle: "Expected by the end of the selected window."
    },
    {
      label: "Expected Increase",
      value: Number.isFinite(headcountIncrease) ? formatSignedCount(headcountIncrease) : "--",
      subtitle: "Change from the current reported headcount."
    },
    {
      label: "Peak Projected Headcount",
      value: formatCount(peakProjectedHeadcount),
      subtitle: "Highest expected point in the current outlook."
    }
  ];
  const generatedText = payload?.generated_at
    ? `Predictions generated ${formatBusinessDateTime(payload.generated_at)}`
    : "No prediction file available yet.";
  const trustRows = [
    {
      label: "Forecast confidence",
      value: Number.isFinite(confidence.score) ? `${confidence.score}% · ${confidence.label}` : confidence.label,
      body: confidence.summary
    },
    {
      label: "Prediction generated",
      value: payload?.generated_at ? formatBusinessDateTime(payload.generated_at) : "Waiting for latest prediction",
      body: "Latest forecast refresh available to the page."
    },
    {
      label: "Last updated",
      value: formatBusinessDateTime(dashboardPayload?.sources?.latest_prediction_last_modified || latestFinanceRowsState.refreshedAt),
      body: "Most recent business data refresh feeding this page."
    },
    {
      label: "How to read this",
      value: "Recent spending and workforce trends",
      body: "Predictions are based on recent spending and workforce trends, with confidence ranges shown around forecast points."
    }
  ];

  return {
    generatedText,
    confidence,
    summaryCards,
    highlights,
    risks,
    actions,
    trustRows,
    spendActualSeries,
    spendForecast,
    headcountActualSeries,
    headcountForecast,
    headcountStats,
    departmentSummary: dashboardPayload?.charts?.department_distribution || [],
    spendSummaryText: spendForecast.length
      ? `Projected company spend based on recent trends. Showing ${spendForecast.length} forecast day${spendForecast.length === 1 ? "" : "s"} against the last ${spendActualSeries.length} days of actual spend.`
      : "Projected company spend based on recent trends will appear here when enough forecast data is available.",
    headcountSummaryText: headcountForecast.length
      ? `Headcount is projected to move from ${formatCount(currentHeadcount)} to ${formatCount(projectedHeadcount)} over the selected ${forecastViewState.horizonDays}-day outlook.`
      : "Headcount projection will appear here when enough employee forecast data is available.",
    headcountChipText: headcountForecast.length
      ? `Forecast ${formatSignedCount(headcountIncrease)}`
      : "Awaiting outlook",
    headcountChipTone: Number.isFinite(headcountIncrease)
      ? headcountIncrease > 0
        ? "positive"
        : headcountIncrease < 0
          ? "warning"
          : "muted"
      : "muted",
    headcountSubtitle: headcountForecast.length
      ? `Projected employee growth over the next ${forecastViewState.horizonDays} days.`
      : "Projected employee growth based on recent workforce trends.",
    currentHeadcount
  };
}

function renderForecasts(payload) {
  syncForecastControls();
  const model = buildForecastViewModel(payload || {});
  const meta = document.getElementById("forecast-generated-at");
  const trustChip = document.getElementById("forecast-trust-chip");
  const spendSummary = document.getElementById("forecast-spend-summary");
  const highlightsTitle = document.getElementById("forecast-highlights-title");
  const headcountSubtitle = document.getElementById("forecast-headcount-subtitle");
  const headcountChip = document.getElementById("forecast-headcount-chip");
  const headcountSummary = document.getElementById("forecast-headcount-summary-text");

  if (meta) {
    meta.textContent = model.generatedText;
  }
  if (trustChip) {
    trustChip.textContent = `${model.confidence.label} confidence`;
    trustChip.dataset.tone = model.confidence.tone;
  }
  if (spendSummary) {
    spendSummary.textContent = model.spendSummaryText;
  }
  if (highlightsTitle) {
    highlightsTitle.textContent = forecastViewState.focus === "spend"
      ? "Spend Highlights"
      : forecastViewState.focus === "headcount"
        ? "Headcount Highlights"
        : "Forecast Highlights";
  }
  if (headcountSubtitle) {
    headcountSubtitle.textContent = model.headcountSubtitle;
  }
  if (headcountChip) {
    headcountChip.textContent = model.headcountChipText;
    headcountChip.dataset.tone = model.headcountChipTone;
  }
  if (headcountSummary) {
    headcountSummary.textContent = model.headcountSummaryText;
  }

  renderForecastSummaryCards(model.summaryCards);
  renderForecastNotes(
    "forecast-highlights-list",
    model.highlights,
    "Waiting for forecast highlights",
    "Plain-English highlights will appear here once enough spend and workforce data are available."
  );
  renderForecastTrustRows(model.trustRows);
  renderForecastTrendChart({
    containerId: "forecast-spend-chart",
    actualSeries: model.spendActualSeries,
    forecastSeries: model.spendForecast,
    formatter: (value) => formatCurrency(value),
    emptyTitle: "Spend forecast unavailable",
    emptyBody: "We need recent spend history and a fresh forecast run before the spend outlook can be shown.",
    ariaLabel: "Spend forecast chart",
    type: "spend"
  });
  renderHeadcountStatCards(model.headcountStats);
  renderForecastTrendChart({
    containerId: "forecast-headcount-chart",
    actualSeries: model.headcountActualSeries,
    forecastSeries: model.headcountForecast,
    formatter: (value) => formatCount(value),
    emptyTitle: "Headcount forecast unavailable",
    emptyBody: "We need recent employee history and a fresh forecast run before the workforce outlook can be shown.",
    ariaLabel: "Headcount forecast chart",
    type: "headcount"
  });
  renderForecastDepartmentSummary(model.departmentSummary);
  renderForecastNotes(
    "forecast-risks-list",
    model.risks,
    "No planning risks highlighted yet",
    "Potential risks will appear here once enough forecast data is available."
  );
  renderForecastNotes(
    "forecast-actions-list",
    model.actions,
    "No recommended actions yet",
    "Recommended actions will appear here once enough forecast data is available."
  );
}

function syncForecastControls() {
  document.querySelectorAll("[data-forecast-horizon]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.forecastHorizon) === forecastViewState.horizonDays);
  });

  document.querySelectorAll("[data-forecast-focus]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.forecastFocus === forecastViewState.focus);
  });
}

function initializeForecastControls() {
  const horizonControl = document.getElementById("forecast-horizon-control");
  const focusControl = document.getElementById("forecast-focus-control");

  if (horizonControl && horizonControl.dataset.bound !== "true") {
    horizonControl.dataset.bound = "true";
    horizonControl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-forecast-horizon]");
      if (!button) {
        return;
      }

      forecastViewState.horizonDays = Number(button.dataset.forecastHorizon) || DEFAULT_FORECAST_HORIZON_DAYS;
      syncForecastControls();
      if (latestForecastPayload) {
        renderForecasts(latestForecastPayload);
      }
    });
  }

  if (focusControl && focusControl.dataset.bound !== "true") {
    focusControl.dataset.bound = "true";
    focusControl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-forecast-focus]");
      if (!button) {
        return;
      }

      forecastViewState.focus = button.dataset.forecastFocus || "all";
      syncForecastControls();
      if (latestForecastPayload) {
        renderForecasts(latestForecastPayload);
      }
    });
  }

  syncForecastControls();
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
  if (latestForecastPayload) {
    renderForecasts(latestForecastPayload);
  }
}

async function refreshForecasts(getAuthToken) {
  const payload = await getJSON("/forecasts", undefined, getAuthToken);
  latestForecastPayload = payload || {};
  renderForecasts(latestForecastPayload);
}

export function initInsightsData({ getAuthToken = () => "" } = {}) {
  const queryButton = document.getElementById("query-run-btn");
  const handleFinanceRowsUpdated = (event) => {
    latestFinanceRowsState = event?.detail || latestFinanceRowsState;
    if (latestDashboardPayload) {
      renderDashboard(latestDashboardPayload);
    }
    if (latestForecastPayload) {
      renderForecasts(latestForecastPayload);
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
  initializeForecastControls();

  refreshAll();
  const timer = window.setInterval(refreshAll, 20000);

  void initializeQueryPage(getAuthToken);
  initializeCreateGraphPage();

  return () => {
    window.clearInterval(timer);
    window.removeEventListener("smartstream:finance-rows-updated", handleFinanceRowsUpdated);
  };
}
