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

function extractDateLabel(item, index) {
  if (item && typeof item === "object") {
    for (const field of DATE_FIELDS) {
      const parsed = parseDate(item[field]);
      if (parsed) {
        return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      }
    }
  }

  return `#${index + 1}`;
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
    .map((item, index) => ({
      label: extractDateLabel(item, index),
      value: extractAmount(item)
    }))
    .filter((point) => Number.isFinite(point.value));

  return points.slice(-MAX_CHART_POINTS);
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

  const width = 680;
  const height = 220;
  const padX = 26;
  const padY = 16;
  const plotWidth = width - padX * 2;
  const plotHeight = height - padY * 2;

  const values = series.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const paddedMin = minValue > 0 ? minValue * 0.92 : minValue * 1.08;
  const paddedMax = maxValue < 0 ? maxValue * 0.92 : maxValue * 1.08;
  const range = Math.max(Math.abs(paddedMax - paddedMin), 1);
  const baselineY = padY + ((paddedMax - 0) / range) * plotHeight;

  const points = series.map((point, index) => {
    const x =
      series.length === 1
        ? padX + plotWidth / 2
        : padX + (index / (series.length - 1)) * plotWidth;
    const y = padY + ((paddedMax - point.value) / range) * plotHeight;
    return { ...point, x, y };
  });

  const linePoints = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const baselineClamped = Math.max(padY, Math.min(height - padY, baselineY));
  const areaPoints = `${points[0].x.toFixed(1)},${baselineClamped.toFixed(1)} ${linePoints} ${points[
    points.length - 1
  ].x.toFixed(1)},${baselineClamped.toFixed(1)}`;

  const gridLines = [0.2, 0.4, 0.6, 0.8]
    .map((position) => {
      const y = (padY + plotHeight * position).toFixed(1);
      return `<line class="live-chart-grid-line" x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}"></line>`;
    })
    .join("");

  const pointDots = points
    .map(
      (point) =>
        `<circle class="live-chart-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4"></circle>`
    )
    .join("");

  const latest = values[values.length - 1];
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const delta = values.length > 1 ? values[values.length - 1] - values[0] : 0;

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
    <svg class="live-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="live-area-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(37, 99, 235, 0.34)"></stop>
          <stop offset="100%" stop-color="rgba(14, 165, 233, 0.03)"></stop>
        </linearGradient>
      </defs>
      ${gridLines}
      <polygon class="live-chart-area" points="${areaPoints}"></polygon>
      <polyline class="live-chart-line" points="${linePoints}"></polyline>
      ${pointDots}
    </svg>
    <div class="live-chart-axis">
      <span class="live-axis-start"></span>
      <span class="live-axis-mid"></span>
      <span class="live-axis-end"></span>
    </div>
  `;

  wrapper.querySelector(".live-stat-latest").textContent = formatCurrency(latest);
  wrapper.querySelector(".live-stat-average").textContent = formatCurrency(average);

  const deltaElement = wrapper.querySelector(".live-stat-delta");
  const deltaWrap = wrapper.querySelector(".live-stat-delta-wrap");
  deltaElement.textContent = formatSignedCurrency(delta);
  deltaWrap.classList.toggle("is-up", delta >= 0);
  deltaWrap.classList.toggle("is-down", delta < 0);

  const midPoint = points[Math.floor((points.length - 1) / 2)];
  wrapper.querySelector(".live-axis-start").textContent = points[0].label;
  wrapper.querySelector(".live-axis-mid").textContent = midPoint.label;
  wrapper.querySelector(".live-axis-end").textContent = points[points.length - 1].label;

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
      const response = await fetch(`${DEFAULT_API_BASE_URL}/latest?limit=${limit}`, {
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
