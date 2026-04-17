import { buildAreaPath, buildSmoothLinePath, pickSeriesAxisLabels } from "./chartUtils.js";
import { createElementCache } from "./domCache.js";
import { escapeHtml, formatCompactCurrency, formatCount, formatCurrency, formatWholePercent } from "./formatters.js";

/**
 * Builds the chart preview on the custom chart page.
 */

const GRAPH_CANVAS = {
  width: 920,
  height: 360,
  paddingTop: 20,
  paddingRight: 24,
  paddingBottom: 26,
  paddingLeft: 64
};

const GRAPH_X_AXIS_MAX_LABELS = 6;
const GRAPH_Y_AXIS_TICKS = 5;

/**
 * Shortens axis labels so long dates and names stay readable.
 *
 * @param {unknown} value
 * @returns {string}
 */
function formatGraphAxisLabel(value) {
  const raw = String(value || "--").trim();
  if (!raw) {
    return "--";
  }

  const hasDateLikeShape = /^\d{4}-\d{2}(-\d{2})?$/.test(raw) || /^\d{4}\/\d{2}(\/\d{2})?$/.test(raw);
  if (hasDateLikeShape) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      const options = raw.length >= 10
        ? { month: "short", day: "numeric" }
        : { month: "short", year: "2-digit" };
      return date.toLocaleDateString(undefined, options);
    }
  }

  return raw.length > 14 ? `${raw.slice(0, 13)}...` : raw;
}

/**
 * Pulls the chart data for the selected metric from the dashboard data.
 *
 * @param {Record<string, any>} payload
 * @param {"revenue" | "expenses" | "employees"} metric
 * @returns {{ label: string, value: number }[]}
 */
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

/**
 * Applies the selected time window to the series.
 *
 * @param {Array<{ label: string, value: number }>} series
 * @param {string} windowValue
 * @returns {Array<{ label: string, value: number }>}
 */
function applyGraphWindow(series, windowValue) {
  if (!Array.isArray(series) || series.length === 0) {
    return [];
  }

  const normalizedWindow = String(windowValue || "").toLowerCase();

  if (normalizedWindow.includes("12")) {
    return series.slice(-12);
  }
  if (normalizedWindow.includes("year")) {
    return series.slice();
  }
  return series.slice(-6);
}

/**
 * Turns the chosen label into the graph type the code uses.
 *
 * @param {string} value
 * @returns {"line" | "area" | "bar"}
 */
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

/**
 * Turns the chosen label into the metric name the code uses.
 *
 * @param {string} value
 * @returns {"revenue" | "expenses" | "employees"}
 */
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

/**
 * Gets the main value formatter for the selected metric.
 *
 * @param {"revenue" | "expenses" | "employees"} metric
 * @returns {(value: number) => string}
 */
function graphFormatterFromMetric(metric) {
  if (metric === "employees") {
    return (value) => formatCount(Number(value) || 0);
  }
  return formatCurrency;
}

/**
 * Gets the shorter formatter used on the y-axis.
 *
 * @param {"revenue" | "expenses" | "employees"} metric
 * @returns {(value: number) => string}
 */
function graphAxisFormatterFromMetric(metric) {
  if (metric === "employees") {
    return (value) => formatCount(Number(value) || 0);
  }
  return formatCompactCurrency;
}

/**
 * Gets the display label for the selected metric.
 *
 * @param {"revenue" | "expenses" | "employees"} metric
 * @returns {string}
 */
function graphMetricLabel(metric) {
  if (metric === "employees") {
    return "Employee Count";
  }
  if (metric === "expenses") {
    return "Expenses";
  }
  return "Revenue";
}

/**
 * Formats point-to-point changes for the selected metric.
 *
 * @param {number} value
 * @param {"revenue" | "expenses" | "employees"} metric
 * @returns {string}
 */
function formatMetricDelta(value, metric) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  if (value === 0) {
    return metric === "employees" ? "0" : "$0.00";
  }

  if (metric === "employees") {
    return `${value > 0 ? "+" : "-"}${formatCount(Math.abs(value))}`;
  }
  return `${value > 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}

/**
 * Makes sure each graph point has a label and value.
 *
 * @param {Array<{ label: string, value: number }>} series
 * @returns {{ rawLabel: string, label: string, value: number }[]}
 */
function normalizeGraphSeries(series) {
  return (Array.isArray(series) ? series : []).map((point) => ({
    rawLabel: String(point?.label || "--"),
    label: formatGraphAxisLabel(point?.label),
    value: Number(point?.value) || 0
  }));
}

/**
 * Builds a padded y-axis range that still works for flat data.
 *
 * @param {number[]} values
 * @returns {{ minValue: number, maxValue: number, domainMin: number, domainMax: number, range: number }}
 */
function buildDomain(values) {
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spread = maxValue - minValue;
  const paddingValue = spread > 0 ? spread * 0.16 : Math.max(Math.abs(maxValue) * 0.22, 1);

  let domainMin = minValue - paddingValue;
  let domainMax = maxValue + paddingValue;

  if (minValue >= 0) {
    domainMin = Math.max(0, domainMin);
  }
  if (maxValue <= 0) {
    domainMax = Math.min(0, domainMax);
  }

  if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax) || domainMin === domainMax) {
    domainMin = 0;
    domainMax = Math.max(1, maxValue || 1);
  }

  return {
    minValue,
    maxValue,
    domainMin,
    domainMax,
    range: Math.max(1, domainMax - domainMin)
  };
}

/**
 * Builds the y-axis grid lines and labels.
 *
 * @param {{ axisFormatter: (value: number) => string, domainMax: number, paddingLeft: number, paddingTop: number, plotHeight: number, range: number, width: number, paddingRight: number }} config
 * @returns {string}
 */
function buildYAxis({ axisFormatter, domainMax, paddingLeft, paddingTop, plotHeight, range, width, paddingRight }) {
  return Array.from({ length: GRAPH_Y_AXIS_TICKS }, (_, index) => {
    const ratio = index / (GRAPH_Y_AXIS_TICKS - 1);
    const y = paddingTop + plotHeight * ratio;
    const value = domainMax - range * ratio;
    const label = axisFormatter(value);
    return `
      <line class="graph-grid-line" x1="${paddingLeft}" y1="${y.toFixed(1)}" x2="${(width - paddingRight).toFixed(1)}" y2="${y.toFixed(1)}"></line>
      <text class="graph-y-axis-label" x="${(paddingLeft - 10).toFixed(1)}" y="${(y + 4).toFixed(1)}">${escapeHtml(label)}</text>
    `;
  }).join("");
}

/**
 * Picks x-axis labels so the chart footer stays readable.
 *
 * @param {string[]} labels
 * @returns {{ slots: number, markup: string }}
 */
function buildXAxis(labels) {
  const slots = Math.max(1, Math.min(GRAPH_X_AXIS_MAX_LABELS, labels.length || 1));
  const axisLabels = pickSeriesAxisLabels(
    labels.map((label) => ({ axisLabel: label })),
    slots,
    ["axisLabel", "label"]
  );

  return {
    slots,
    markup: axisLabels.map((label) => `<span title="${escapeHtml(label)}">${escapeHtml(label)}</span>`).join("")
  };
}

/**
 * Builds the SVG markup for line and area chart previews.
 *
 * @param {{ series: Array<{ rawLabel: string, label: string, value: number }>, metric: string, withArea: boolean, formatter: (value: number) => string, axisFormatter: (value: number) => string }} config
 * @returns {string}
 */
function renderGraphLines({ series, metric, withArea, formatter, axisFormatter }) {
  if (!Array.isArray(series) || series.length === 0) {
    return "";
  }

  const {
    width,
    height,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft
  } = GRAPH_CANVAS;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;
  const baselineY = height - paddingBottom;
  const values = series.map((point) => Number(point.value) || 0);
  const { minValue, maxValue, domainMax, range } = buildDomain(values);

  const points = series.map((point, index) => {
    const x =
      series.length === 1
        ? paddingLeft + plotWidth / 2
        : paddingLeft + (index / (series.length - 1)) * plotWidth;
    const y = paddingTop + ((domainMax - (Number(point.value) || 0)) / range) * plotHeight;
    const tooltip = `${point.rawLabel || point.label}: ${formatter(Number(point.value) || 0)}`;
    return {
      x,
      y,
      value: Number(point.value) || 0,
      tooltip
    };
  });

  const linePath = buildSmoothLinePath(points);
  const areaPath = withArea ? buildAreaPath(points, baselineY, linePath) : "";
  const yAxis = buildYAxis({
    axisFormatter,
    domainMax,
    paddingLeft,
    paddingTop,
    plotHeight,
    range,
    width,
    paddingRight
  });
  const pointRadius = series.length > 18 ? 3.1 : 4.1;
  const dots = points
    .map((point) => `
      <circle class="graph-point-marker" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${pointRadius}" data-tooltip="${escapeHtml(point.tooltip)}">
        <title>${escapeHtml(point.tooltip)}</title>
      </circle>
    `)
    .join("");
  const xAxis = buildXAxis(series.map((point) => point.label));
  const metricLabel = graphMetricLabel(metric);
  const rangeText = `${axisFormatter(minValue)} to ${axisFormatter(maxValue)}`;

  return `
    <div class="graph-chart-shell ${withArea ? "is-area" : "is-line"}">
      <div class="graph-chart-meta">
        <span class="graph-legend-item"><i class="graph-legend-dot ${withArea ? "is-area" : "is-line"}"></i>${escapeHtml(metricLabel)}</span>
        <span class="graph-range-note">Range: ${escapeHtml(rangeText)}</span>
      </div>
      <div class="graph-chart-frame">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" aria-label="Generated graph preview">
          ${yAxis}
          ${withArea ? `<path class="graph-area-path" d="${areaPath}"></path>` : ""}
          <path class="graph-line-path" d="${linePath}"></path>
        ${dots}
        </svg>
        <div class="graph-tooltip" hidden></div>
      </div>
      <div class="graph-x-axis" style="--graph-axis-slots:${xAxis.slots}">
        ${xAxis.markup}
      </div>
    </div>
  `;
}

/**
 * Builds the SVG markup for bar chart previews.
 *
 * @param {{ series: Array<{ rawLabel: string, label: string, value: number }>, metric: string, formatter: (value: number) => string, axisFormatter: (value: number) => string }} config
 * @returns {string}
 */
function renderGraphBars({ series, metric, formatter, axisFormatter }) {
  if (!Array.isArray(series) || series.length === 0) {
    return "";
  }

  const {
    width,
    height,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft
  } = GRAPH_CANVAS;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;
  const values = series.map((point) => Number(point.value) || 0);
  const { minValue, maxValue, domainMax, range } = buildDomain(values);
  const toY = (value) => paddingTop + ((domainMax - value) / range) * plotHeight;
  const baselineY = toY(0);
  const yAxis = buildYAxis({
    axisFormatter,
    domainMax,
    paddingLeft,
    paddingTop,
    plotHeight,
    range,
    width,
    paddingRight
  });
  const step = plotWidth / Math.max(1, series.length);
  const barWidth = Math.max(8, Math.min(52, step * 0.7));
  const bars = series
    .map((point, index) => {
      const value = Number(point.value) || 0;
      const x = paddingLeft + index * step + (step - barWidth) / 2;
      const y = value >= 0 ? toY(value) : baselineY;
      const barHeight = Math.max(2, Math.abs(toY(value) - baselineY));
      const tooltip = `${point.rawLabel || point.label}: ${formatter(value)}`;
      return `
        <rect
          class="graph-bar-rect"
          x="${x.toFixed(1)}"
          y="${y.toFixed(1)}"
          width="${barWidth.toFixed(1)}"
          height="${barHeight.toFixed(1)}"
          rx="${Math.min(8, Math.max(3, barWidth * 0.18)).toFixed(1)}"
          data-tooltip="${escapeHtml(tooltip)}"
        >
          <title>${escapeHtml(tooltip)}</title>
        </rect>
      `;
    })
    .join("");
  const xAxis = buildXAxis(series.map((point) => point.label));
  const metricLabel = graphMetricLabel(metric);
  const rangeText = `${axisFormatter(minValue)} to ${axisFormatter(maxValue)}`;

  return `
    <div class="graph-chart-shell is-bar">
      <div class="graph-chart-meta">
        <span class="graph-legend-item"><i class="graph-legend-dot is-bar"></i>${escapeHtml(metricLabel)}</span>
        <span class="graph-range-note">Range: ${escapeHtml(rangeText)}</span>
      </div>
      <div class="graph-chart-frame">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" aria-label="Generated bar chart preview">
          ${yAxis}
          <line class="graph-baseline-line" x1="${paddingLeft}" y1="${baselineY.toFixed(1)}" x2="${(width - paddingRight).toFixed(1)}" y2="${baselineY.toFixed(1)}"></line>
          ${bars}
        </svg>
        <div class="graph-tooltip" hidden></div>
      </div>
      <div class="graph-x-axis" style="--graph-axis-slots:${xAxis.slots}">
        ${xAxis.markup}
      </div>
    </div>
  `;
}

/**
 * Creates the controller for the custom graph preview.
 *
 * @param {{ getLatestDashboardPayload: () => Record<string, any> | null }} dependencies
 * @returns {{ initializeCreateGraphPage: () => void }}
 */
export function createGraphModule({ getLatestDashboardPayload }) {
  const getElement = createElementCache();

  // These helpers update the text and status shown around the chart.
  function setGraphStatus(message, state = "neutral") {
    const status = getElement("graph-status");
    if (!status) {
      return;
    }
    status.textContent = message;
    status.dataset.state = state;
  }

  function setGraphSubtitle(message) {
    const subtitle = getElement("graph-preview-subtitle");
    if (subtitle) {
      subtitle.textContent = message;
    }
  }

  function setGraphFootnote(message) {
    const footnote = getElement("graph-footnote");
    if (footnote) {
      footnote.textContent = message;
    }
  }

  function renderGraphSelectionMeta({ graphTypeText, metricText, windowText }) {
    const meta = getElement("graph-selection-meta");
    if (!meta) {
      return;
    }

    meta.innerHTML = [graphTypeText, metricText, windowText]
      .map((value) => `<span class="graph-chip">${escapeHtml(value)}</span>`)
      .join("");
  }

  function renderGraphInsights(items, emptyMessage = "Generate a chart to see summary insights.") {
    const insights = getElement("graph-insights");
    if (!insights) {
      return;
    }

    if (!Array.isArray(items) || !items.length) {
      insights.innerHTML = `<p class="graph-insight-empty">${escapeHtml(emptyMessage)}</p>`;
      return;
    }

    insights.innerHTML = items
      .map((item) => `
        <article class="graph-insight-card">
          <span>${escapeHtml(item.label || "--")}</span>
          <strong>${escapeHtml(item.value || "--")}</strong>
          <p>${escapeHtml(item.note || "")}</p>
        </article>
      `)
      .join("");
  }

  function renderGraphState({ tone, title, body, loading = false }) {
    const preview = getElement("graph-preview");
    if (!preview) {
      return;
    }

    preview.innerHTML = `
      <div class="graph-state graph-state-${tone}">
        ${loading ? "<span class=\"graph-loader\" aria-hidden=\"true\"></span>" : ""}
        <div>
          <h4>${escapeHtml(title)}</h4>
          <p>${escapeHtml(body)}</p>
        </div>
      </div>
    `;
  }

  // These insight cards summarize the chart window on screen.
  function buildGraphInsights({ series, metric, formatter }) {
    if (!Array.isArray(series) || !series.length) {
      return [];
    }

    const latest = series[series.length - 1];
    const previous = series.length > 1 ? series[series.length - 2] : null;
    const values = series.map((point) => Number(point.value) || 0);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const maxPoint = series.reduce((highest, point) => (point.value > highest.value ? point : highest), series[0]);
    const minPoint = series.reduce((lowest, point) => (point.value < lowest.value ? point : lowest), series[0]);
    const delta = previous ? latest.value - previous.value : 0;
    const deltaPercent = previous && previous.value !== 0
      ? (delta / Math.abs(previous.value)) * 100
      : null;

    return [
      {
        label: "Latest Value",
        value: formatter(latest.value),
        note: `Most recent point: ${latest.rawLabel || latest.label}`
      },
      {
        label: "Average",
        value: formatter(average),
        note: `Average across ${series.length} displayed points`
      },
      {
        label: "Point-to-Point Change",
        value: Number.isFinite(deltaPercent) ? formatWholePercent(deltaPercent) : formatMetricDelta(delta, metric),
        note: previous
          ? `Compared with ${previous.rawLabel || previous.label}`
          : "Only one point is available in this view"
      },
      {
        label: "Range",
        value: `${formatter(minPoint.value)} - ${formatter(maxPoint.value)}`,
        note: `Low: ${minPoint.rawLabel || minPoint.label} | High: ${maxPoint.rawLabel || maxPoint.label}`
      }
    ];
  }

  /**
   * Adds hover tooltips to the chart preview.
   *
   * @param {HTMLElement} preview
   */
  function bindGraphTooltip(preview) {
    const frame = preview.querySelector(".graph-chart-frame");
    const tooltip = preview.querySelector(".graph-tooltip");
    if (!frame || !tooltip) {
      return;
    }

    const hideTooltip = () => {
      tooltip.hidden = true;
    };

    frame.addEventListener("mouseleave", hideTooltip);
    frame.addEventListener("mousemove", (event) => {
      const target = event.target.closest("[data-tooltip]");
      if (!target || !frame.contains(target)) {
        hideTooltip();
        return;
      }

      const text = target.getAttribute("data-tooltip");
      if (!text) {
        hideTooltip();
        return;
      }

      tooltip.hidden = false;
      tooltip.textContent = text;

      const frameRect = frame.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      let left = event.clientX - frameRect.left + 12;
      let top = event.clientY - frameRect.top - tooltipRect.height - 12;

      if (left + tooltipRect.width > frameRect.width - 8) {
        left = frameRect.width - tooltipRect.width - 8;
      }
      if (left < 8) {
        left = 8;
      }
      if (top < 8) {
        top = event.clientY - frameRect.top + 14;
      }

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    });
  }

  /**
   * Shows the current graph preview and its supporting summary text.
   *
   * @param {{
   *   metric: string,
   *   graphType: string,
   *   graphTypeText: string,
   *   metricText: string,
   *   windowText: string,
   *   series: Array<{ rawLabel: string, label: string, value: number }>
   * }} config
   */
  function renderGraphPreview({
    metric,
    graphType,
    graphTypeText,
    metricText,
    windowText,
    series
  }) {
    const preview = getElement("graph-preview");
    if (!preview) {
      return;
    }

    if (!Array.isArray(series) || !series.length) {
      renderGraphState({
        tone: "empty",
        title: "No chart data available",
        body: `No ${metricText.toLowerCase()} data is available for ${windowText.toLowerCase()}.`
      });
      renderGraphInsights([], `No summary insights are available for ${metricText.toLowerCase()} in this window.`);
      setGraphStatus(`No data found for ${metricText.toLowerCase()}.`, "empty");
      setGraphSubtitle(`${graphTypeText} preview for ${metricText.toLowerCase()} in ${windowText.toLowerCase()}.`);
      setGraphFootnote("Try a different metric or broader time window to generate a chart.");
      return;
    }

    const formatter = graphFormatterFromMetric(metric);
    const axisFormatter = graphAxisFormatterFromMetric(metric);
    const values = series.map((point) => ({
      rawLabel: point.rawLabel || point.label || "--",
      label: point.label || "--",
      value: Number(point.value) || 0
    }));

    const chart = graphType === "bar"
      ? renderGraphBars({
          series: values,
          metric,
          formatter,
          axisFormatter
        })
      : renderGraphLines({
          series: values,
          metric,
          withArea: graphType === "area",
          formatter,
          axisFormatter
        });

    const latestValue = formatter(values[values.length - 1]?.value || 0);
    preview.innerHTML = chart;
    bindGraphTooltip(preview);

    const insightCards = buildGraphInsights({
      series: values,
      metric,
      formatter
    });
    renderGraphInsights(insightCards);
    setGraphStatus(`Graph preview generated (${values.length} point${values.length === 1 ? "" : "s"}).`, "success");
    setGraphSubtitle(`${graphTypeText} preview of ${metricText.toLowerCase()} for ${windowText.toLowerCase()}.`);
    setGraphFootnote(`Showing ${values.length} point${values.length === 1 ? "" : "s"} with a latest value of ${latestValue}.`);
  }

  /**
   * Reads the user's current chart-builder choices from the form.
   *
   * @returns {{ graphType: string, graphTypeText: string, metric: string, metricText: string, windowText: string } | null}
   */
  function readGraphSelections() {
    const graphTypeSelect = getElement("graph-type");
    const graphMetricSelect = getElement("graph-metric");
    const graphWindowSelect = getElement("graph-window");
    if (!graphTypeSelect || !graphMetricSelect || !graphWindowSelect) {
      return null;
    }

    const graphTypeText = graphTypeSelect.value || "Line Chart";
    const metricText = graphMetricSelect.value || "Revenue";
    const windowText = graphWindowSelect.value || "Last 6 months";
    return {
      graphType: graphTypeFromSelection(graphTypeText),
      graphTypeText,
      metric: graphMetricFromSelection(metricText),
      metricText,
      windowText
    };
  }

  /**
   * Shows the empty state before a graph has been created.
   */
  function renderIdleGraphState() {
    const selections = readGraphSelections();
    if (selections) {
      renderGraphSelectionMeta(selections);
      setGraphSubtitle(`Live preview of your selected graph settings.`);
    }

    renderGraphState({
      tone: "empty",
      title: "Ready to generate",
      body: "Choose your settings above, then generate a chart preview."
    });
    renderGraphInsights([], "Generate a chart to see summary insights.");
    setGraphStatus("Ready to generate a chart preview.", "neutral");
    setGraphFootnote("Chart sizing is optimized for clear executive-style reporting.");
  }

  /**
   * Builds a chart preview from the latest dashboard data.
   *
   * @returns {Promise<void>}
   */
  async function runCreateGraph() {
    const selections = readGraphSelections();
    if (!selections) {
      return;
    }

    renderGraphSelectionMeta(selections);
    setGraphStatus("Generating graph preview...", "loading");
    renderGraphState({
      tone: "loading",
      title: "Generating preview",
      body: `Preparing ${selections.metricText.toLowerCase()} data for ${selections.windowText.toLowerCase()}.`,
      loading: true
    });
    renderGraphInsights([], "Calculating summary insights...");
    setGraphSubtitle(`${selections.graphTypeText} preview of ${selections.metricText.toLowerCase()} for ${selections.windowText.toLowerCase()}.`);
    setGraphFootnote("Formatting chart layout and axis labels...");

    await new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });

    try {
      const latestDashboardPayload = getLatestDashboardPayload();
      if (!latestDashboardPayload) {
        renderGraphState({
          tone: "empty",
          title: "Dashboard data is still loading",
          body: "Generate again once the dashboard refresh is complete."
        });
        renderGraphInsights([], "Summary insights will appear once dashboard data is available.");
        setGraphStatus("No dashboard data available yet.", "empty");
        setGraphFootnote("Wait for the latest dashboard refresh, then regenerate this preview.");
        return;
      }

      const rawSeries = buildQueryGraphSeries(latestDashboardPayload, selections.metric);
      const normalized = normalizeGraphSeries(applyGraphWindow(rawSeries, selections.windowText));
      renderGraphPreview({
        metric: selections.metric,
        metricText: selections.metricText,
        graphType: selections.graphType,
        graphTypeText: selections.graphTypeText,
        windowText: selections.windowText,
        series: normalized
      });
    } catch (error) {
      renderGraphState({
        tone: "error",
        title: "Graph generation failed",
        body: "An unexpected error occurred while rendering this chart preview."
      });
      renderGraphInsights([], "Summary insights are unavailable because the chart failed to render.");
      setGraphStatus(`Graph generation failed: ${error?.message || "Unknown error"}`, "error");
      setGraphFootnote("Try generating again or choose a different chart option.");
    }
  }

  /**
   * Sets up the create-graph form once and shows the initial empty state.
   */
  function initializeCreateGraphPage() {
    const graphButton = getElement("graph-generate-btn");
    const graphForm = getElement("create-graph-form");
    const graphTypeSelect = getElement("graph-type");
    const graphMetricSelect = getElement("graph-metric");
    const graphWindowSelect = getElement("graph-window");

    if (graphButton && graphButton.dataset.bound !== "true") {
      graphButton.dataset.bound = "true";
      graphButton.addEventListener("click", () => {
        void runCreateGraph();
      });
    }

    if (graphForm && graphForm.dataset.bound !== "true") {
      graphForm.dataset.bound = "true";
      graphForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void runCreateGraph();
      });
    }

    const syncMeta = () => {
      const selections = readGraphSelections();
      if (selections) {
        renderGraphSelectionMeta(selections);
      }
    };

    [graphTypeSelect, graphMetricSelect, graphWindowSelect].forEach((element) => {
      if (element && element.dataset.bound !== "true") {
        element.dataset.bound = "true";
        element.addEventListener("change", syncMeta);
      }
    });

    renderIdleGraphState();
  }

  return {
    initializeCreateGraphPage
  };
}
