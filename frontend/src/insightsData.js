const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return currencyFormatter.format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || "--");
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

function setMetric(id, value, subtitle) {
  const valueElement = document.getElementById(`${id}-value`);
  const subtitleElement = document.getElementById(`${id}-subtitle`);
  if (valueElement) {
    valueElement.textContent = value;
  }
  if (subtitleElement) {
    subtitleElement.textContent = subtitle;
  }
}

function renderRevenueExpenseBars(series) {
  const container = document.getElementById("revenue-expense-bars");
  if (!container) {
    return;
  }

  if (!Array.isArray(series) || series.length === 0) {
    container.innerHTML = '<div class="month-row"><span>--</span><div class="track"><i style="--v:0"></i></div><div class="track alt"><i style="--v:0"></i></div></div>';
    return;
  }

  const maxValue = Math.max(
    1,
    ...series.map((item) => Math.max(Number(item.revenue) || 0, Number(item.expenditure) || 0))
  );

  container.innerHTML = series
    .map((item) => {
      const revenue = Math.max(0, Number(item.revenue) || 0);
      const expenditure = Math.max(0, Number(item.expenditure) || 0);
      const revenuePct = Math.round((revenue / maxValue) * 100);
      const expenditurePct = Math.round((expenditure / maxValue) * 100);
      return `
        <div class="month-row">
          <span>${item.label || "--"}</span>
          <div class="track"><i style="--v:${revenuePct}"></i></div>
          <div class="track alt"><i style="--v:${expenditurePct}"></i></div>
        </div>
      `;
    })
    .join("");
}

function renderEmployeeGrowth(points) {
  const container = document.getElementById("employee-growth-chart");
  if (!container) {
    return;
  }

  if (!Array.isArray(points) || points.length === 0) {
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
  const values = points.map((point) => Number(point.value) || 0);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(1, maxValue - minValue);

  const coords = points.map((point, index) => {
    const x =
      points.length === 1
        ? width / 2
        : paddingX + (index / (points.length - 1)) * (width - paddingX * 2);
    const y = paddingY + ((maxValue - (Number(point.value) || 0)) / range) * (height - paddingY * 2);
    return { x, y };
  });

  const line = coords.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${coords[0].x.toFixed(1)},210 ${line} ${coords[coords.length - 1].x.toFixed(1)},210`;
  const labels = [
    points[0]?.label || "--",
    points[Math.floor((points.length - 1) / 5)]?.label || "--",
    points[Math.floor((points.length - 1) * 2 / 5)]?.label || "--",
    points[Math.floor((points.length - 1) * 3 / 5)]?.label || "--",
    points[Math.floor((points.length - 1) * 4 / 5)]?.label || "--",
    points[points.length - 1]?.label || "--"
  ];

  container.innerHTML = `
    <svg viewBox="0 0 520 220" preserveAspectRatio="none" aria-label="Employee growth line chart">
      <polyline class="line-fill" points="${area}"></polyline>
      <polyline class="line-stroke" points="${line}"></polyline>
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

function renderWeeklyActivity(items) {
  const container = document.getElementById("weekly-activity-bars");
  if (!container) {
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = '<div><i style="--h:0"></i><span>--</span></div>';
    return;
  }

  const max = Math.max(1, ...items.map((item) => Number(item.value) || 0));
  container.innerHTML = items
    .map((item) => {
      const value = Math.max(0, Number(item.value) || 0);
      const height = Math.max(10, Math.round((value / max) * 100));
      return `<div><i style="--h:${height}"></i><span>${item.label || "--"}</span></div>`;
    })
    .join("");
}

function renderDashboard(payload) {
  const metrics = payload.metrics || {};
  const charts = payload.charts || {};

  const totalEmployees = metrics.total_employees || {};
  const totalEmployeesDelta =
    Number.isFinite(totalEmployees.delta_percent) && totalEmployees.delta_percent !== null
      ? `${formatPercent(totalEmployees.delta_percent)} vs baseline`
      : totalEmployees.subtitle || "No trend available";
  setMetric(
    "metric-total-employees",
    Number(totalEmployees.value || 0).toLocaleString(),
    totalEmployeesDelta
  );

  const revenue = metrics.revenue || {};
  const revenueDelta =
    Number.isFinite(revenue.delta_percent) && revenue.delta_percent !== null
      ? `${formatPercent(revenue.delta_percent)} vs previous point`
      : revenue.subtitle || "No trend available";
  setMetric("metric-revenue", formatCurrency(Number(revenue.value || 0)), revenueDelta);

  const growth = metrics.growth_rate || {};
  setMetric(
    "metric-growth-rate",
    formatPercent(Number(growth.value_percent || 0)),
    growth.subtitle || "Headcount trend"
  );

  const dataHealth = metrics.data_health || {};
  setMetric(
    "metric-data-health",
    formatPercent(Number(dataHealth.value_percent || 0)),
    dataHealth.subtitle || "Pipeline diagnostics"
  );

  renderRevenueExpenseBars(charts.revenue_expenses || []);
  renderEmployeeGrowth(charts.employee_growth || []);
  renderDepartmentDistribution(charts.department_distribution || []);
  renderWeeklyActivity(charts.weekly_activity || []);
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
  const input = document.getElementById("query-input");
  const status = document.getElementById("query-status");
  if (!input || !status) {
    return;
  }

  const query = input.value.trim();
  if (!query) {
    status.textContent = "Enter a SQL query first.";
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
  renderDashboard(payload);
}

async function refreshForecasts(getAuthToken) {
  const payload = await getJSON("/forecasts", undefined, getAuthToken);
  renderForecasts(payload);
}

export function initInsightsData({ getAuthToken = () => "" } = {}) {
  const queryButton = document.getElementById("query-run-btn");
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

  refreshAll();
  const timer = window.setInterval(refreshAll, 20000);

  return () => {
    window.clearInterval(timer);
  };
}
