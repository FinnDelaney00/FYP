import { parseBusinessDate } from "./time.js";

/**
 * Presentation helpers for dashboard copy, labels, and safe HTML output.
 *
 * These helpers keep formatting rules consistent across dashboard, forecasts,
 * settings, and anomaly views.
 */
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const compactCurrencyFormatter0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 0
});

const compactCurrencyFormatter1 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1
});

/**
 * Formats a number as full USD currency.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return currencyFormatter.format(value);
}

/**
 * Formats large numbers as compact USD currency while keeping small values legible.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatCompactCurrency(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return (value >= 100000 ? compactCurrencyFormatter1 : compactCurrencyFormatter0).format(value);
}

/**
 * Formats a value into a short chart-friendly date label.
 *
 * @param {string | number | Date} value
 * @returns {string}
 */
export function formatDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || "--");
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Formats a timestamp for "last updated" style UI copy.
 *
 * @param {string | number | Date} value
 * @returns {string}
 */
export function formatBusinessDateTime(value) {
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

/**
 * Formats a business date into a longer month-day-year label.
 *
 * @param {string | number | Date} value
 * @returns {string}
 */
export function formatLongDate(value) {
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

/**
 * Formats a numeric count without decimal places.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatCount(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return Math.round(value).toLocaleString();
}

/**
 * Formats a signed percentage with one decimal place.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatWholePercent(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

/**
 * Formats an integer delta while keeping the sign visible.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatSignedCount(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  if (value === 0) {
    return "0";
  }
  return `${value > 0 ? "+" : "-"}${Math.abs(value)}`;
}

/**
 * Escapes user-visible text before inserting it into HTML strings.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
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
