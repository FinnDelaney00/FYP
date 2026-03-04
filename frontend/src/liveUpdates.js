/**
 * File purpose:
 * Polls the backend latest-events endpoint, normalizes incoming finance records,
 * and renders the live feed chart plus related status/meta display elements.
 */
const DEFAULT_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const DEFAULT_POLL_INTERVAL_MS = Number(import.meta.env.VITE_POLL_INTERVAL_MS || 3000);
const MAX_CHART_POINTS = 24;
const AMOUNT_FIELDS = ["amount", "transaction_amount", "value", "total", "net_amount"];
const DATE_FIELDS = [
  "transaction_date",
  "event_time",
  "event_timestamp",
  "timestamp",
  "datetime",
  "date",
  "created_at",
  "updated_at"
];

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

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
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function extractAmount(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  for (const field of AMOUNT_FIELDS) {
    const parsed = parseNumeric(item[field]);
    if (parsed !== null) {
      return parsed;
    }
  }

  const credit = parseNumeric(item.credit);
  const debit = parseNumeric(item.debit);
  if (credit !== null || debit !== null) {
    return (credit || 0) - (debit || 0);
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

function extractTimestamp(item) {
  if (item && typeof item === "object") {
    for (const field of DATE_FIELDS) {
      const parsed = parseDate(item[field]);
      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
}

function formatDateLabel(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "--";
  }
  return value.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return currencyFormatter.format(value);
}

function formatSignedCurrency(value) {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${formatCurrency(Math.abs(value))}`;
}

function buildAuthHeaders(getAuthToken) {
  const token = typeof getAuthToken === "function" ? String(getAuthToken() || "").trim() : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function buildSeries(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const points = items
    .map((item, index) => {
      const value = extractAmount(item);
      if (!Number.isFinite(value)) {
        return null;
      }

      const timestamp = extractTimestamp(item);
      return {
        timestamp,
        timestampMs: timestamp ? timestamp.getTime() : Number.NaN,
        value,
        inputOrder: index
      };
    })
    .filter(Boolean);

  if (!points.length) {
    return [];
  }

  const timestampedPoints = points.filter((point) => Number.isFinite(point.timestampMs));
  const sortablePoints = timestampedPoints.length ? timestampedPoints : points;
  sortablePoints.sort((left, right) => {
    if (Number.isFinite(left.timestampMs) && Number.isFinite(right.timestampMs)) {
      return left.timestampMs - right.timestampMs;
    }
    return left.inputOrder - right.inputOrder;
  });

  return sortablePoints.slice(-MAX_CHART_POINTS).map((point, index) => ({
    timestamp: point.timestamp,
    value: point.value,
    label: point.timestamp ? formatDateLabel(point.timestamp) : `#${index + 1}`
  }));
}

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

function renderEmptyChart(chartElement, message) {
  chartElement.innerHTML = "";
  const empty = document.createElement("p");
  empty.className = "live-chart-empty";
  empty.textContent = message;
  chartElement.append(empty);
}

function renderChart(chartElement, items) {
  const series = buildSeries(items);
  if (!series.length) {
    renderEmptyChart(chartElement, "No numeric finance values found in latest object.");
    return;
  }

  const width = 520;
  const height = 220;
  const paddingX = 20;
  const paddingY = 15;

  const values = series.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spread = maxValue - minValue;
  const domainPadding = spread > 0 ? spread * 0.2 : Math.max(Math.abs(maxValue) * 0.15, 1);
  const domainMin = minValue - domainPadding;
  const domainMax = maxValue + domainPadding;
  const range = Math.max(1, domainMax - domainMin);
  const baselineValue = domainMin > 0 ? domainMin : domainMax < 0 ? domainMax : 0;
  const baselineY =
    paddingY + ((domainMax - baselineValue) / range) * (height - paddingY * 2);

  const points = series.map((point, index) => {
    const x =
      series.length === 1
        ? width / 2
        : paddingX + (index / (series.length - 1)) * (width - paddingX * 2);
    const y = paddingY + ((domainMax - point.value) / range) * (height - paddingY * 2);
    return { ...point, x, y };
  });

  const linePath = buildSmoothPath(points);
  const areaPath = buildAreaPath(points, baselineY, linePath);
  const labels = pickAxisLabels(series);
  const gridLines = [0.2, 0.4, 0.6, 0.8]
    .map((position) => {
      const y = (paddingY + (height - paddingY * 2) * position).toFixed(1);
      return `<line class="line-grid-line" x1="${paddingX}" y1="${y}" x2="${width - paddingX}" y2="${y}"></line>`;
    })
    .join("");

  const pointDots = points
    .map((point) => `<circle class="line-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.8"></circle>`)
    .join("");

  const latest = series[series.length - 1].value;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const delta = values.length > 1 ? series[series.length - 1].value - series[0].value : 0;

  const wrapper = document.createElement("div");
  wrapper.className = "live-chart-wrap";
  wrapper.innerHTML = `
    <div class="live-chart-stats">
      <div class="live-chart-stat">
        <span class="label">Latest</span>
        <strong class="value live-stat-latest"></strong>
      </div>
      <div class="live-chart-stat">
        <span class="label">Average</span>
        <strong class="value live-stat-average"></strong>
      </div>
      <div class="live-chart-stat live-stat-delta-wrap">
        <span class="label">Window Change</span>
        <strong class="value live-stat-delta"></strong>
      </div>
    </div>
    <div class="line-chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Latest trusted events line chart">
        ${gridLines}
        <path class="line-fill" d="${areaPath}"></path>
        <path class="line-stroke" d="${linePath}"></path>
        ${pointDots}
      </svg>
      <div class="x-axis">
        ${labels.map((label) => `<span>${label}</span>`).join("")}
      </div>
    </div>
  `;

  wrapper.querySelector(".live-stat-latest").textContent = formatCurrency(latest);
  wrapper.querySelector(".live-stat-average").textContent = formatCurrency(average);

  const deltaElement = wrapper.querySelector(".live-stat-delta");
  const deltaWrap = wrapper.querySelector(".live-stat-delta-wrap");
  deltaElement.textContent = formatSignedCurrency(delta);
  deltaWrap.classList.toggle("is-up", values.length > 1 && delta > 0);
  deltaWrap.classList.toggle("is-down", values.length > 1 && delta < 0);

  chartElement.innerHTML = "";
  chartElement.append(wrapper);
}

export function startLiveUpdates({
  chartElement,
  metaElement,
  statusElement,
  limit = 50,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  getAuthToken = () => ""
}) {
  if (!DEFAULT_API_BASE_URL) {
    metaElement.textContent = "Missing VITE_API_BASE_URL";
    statusElement.textContent = "Live Data: config required";
    statusElement.classList.add("is-error");
    renderEmptyChart(chartElement, "Set VITE_API_BASE_URL to load live data.");
    return () => {};
  }

  let timer = null;

  const refresh = async () => {
    try {
      const response = await fetch(`${DEFAULT_API_BASE_URL}/latest?limit=${limit}&_ts=${Date.now()}`, {
        cache: "no-store",
        headers: {
          ...buildAuthHeaders(getAuthToken)
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      renderChart(chartElement, payload.items || []);

      const lastModified = payload.last_modified ? new Date(payload.last_modified).toLocaleString() : "n/a";
      metaElement.textContent = `Object: ${payload.s3_key || "none"} | Last modified: ${lastModified}`;

      statusElement.textContent = `Live Data: updated ${new Date().toLocaleTimeString()}`;
      statusElement.classList.remove("is-error");
      statusElement.classList.add("is-live");
    } catch (error) {
      statusElement.textContent = `Live Data: error (${error.message})`;
      statusElement.classList.remove("is-live");
      statusElement.classList.add("is-error");
      renderEmptyChart(chartElement, "Live data is temporarily unavailable.");
    }
  };

  refresh();
  timer = window.setInterval(refresh, pollIntervalMs);

  return () => {
    if (timer) {
      window.clearInterval(timer);
    }
  };
}
