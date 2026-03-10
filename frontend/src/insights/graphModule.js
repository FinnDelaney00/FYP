import { buildAreaPath, buildSmoothLinePath } from "./chartUtils.js";
import { createElementCache } from "./domCache.js";
import { escapeHtml, formatCurrency } from "./formatters.js";

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

export function createGraphModule({ getLatestDashboardPayload }) {
  const getElement = createElementCache();

  function renderGraphPreview({
    metric,
    graphType,
    windowText,
    series
  }) {
    const preview = getElement("graph-preview");
    const status = getElement("graph-status");
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
    const graphTypeSelect = getElement("graph-type");
    const graphMetricSelect = getElement("graph-metric");
    const graphWindowSelect = getElement("graph-window");
    if (!graphTypeSelect || !graphMetricSelect || !graphWindowSelect) {
      return;
    }

    const latestDashboardPayload = getLatestDashboardPayload();
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

  function initializeCreateGraphPage() {
    const graphButton = getElement("graph-generate-btn");
    if (!graphButton) {
      return;
    }

    graphButton.addEventListener("click", () => {
      void runCreateGraph();
    });
  }

  return {
    initializeCreateGraphPage
  };
}
