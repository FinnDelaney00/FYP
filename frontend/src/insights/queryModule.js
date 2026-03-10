import {
  DEFAULT_QUERY_LIMIT,
  DEFAULT_QUERY_TABLE,
  QUERY_LIMIT_OPTIONS,
  QUERY_ROW_SQL_PREVIEW_PREFIX,
  QUERY_SINGLE_TABLE,
  QUERY_TABLE_OPTIONS,
  QUERY_TABLE_PATH_FILTERS
} from "./constants.js";
import { createElementCache } from "./domCache.js";
import { escapeHtml } from "./formatters.js";

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

export function createQueryModule({ getJSON }) {
  const queryRowsCache = new Map();
  const getElement = createElementCache();

  function getQueryFormElements() {
    return {
      databaseSelect: getElement("query-database"),
      rowSelect: getElement("query-row"),
      limitSelect: getElement("query-limit"),
      status: getElement("query-status"),
      statusPreview: getElement("query-sql-preview"),
      form: getElement("query-form")
    };
  }

  function setStatus(elements, message, state = "idle") {
    if (!elements.status) {
      return;
    }
    elements.status.textContent = message;
    elements.status.dataset.state = state;
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
      setStatus(elements, "Ready.");
      return Promise.resolve();
    }

    rowSelect.disabled = true;
    if (status) {
      setStatus(elements, "Loading available rows...", "loading");
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
        setStatus(elements, "Ready.");
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
        setStatus(elements, "Ready.");
        return fallbackOptions;
      });
  }

  function renderQueryResult(payload) {
    const head = getElement("query-results-head");
    const body = getElement("query-results-body");
    const meta = getElement("query-results-meta");

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
    const input = getElement("query-input");
    if (!elements.status) {
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
      setStatus(elements, "Select a database and row option first.", "error");
      return;
    }

    setStatus(elements, "Running query...", "loading");
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
      setStatus(elements, "Query completed.", "success");
    } catch (error) {
      setStatus(elements, `Query failed: ${error.message}`, "error");
    }
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
    setStatus(elements, "Ready.");
  }

  return {
    initializeQueryPage,
    runQuery
  };
}
