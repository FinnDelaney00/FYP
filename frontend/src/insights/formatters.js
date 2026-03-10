import { parseBusinessDate } from "./time.js";

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

export function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return currencyFormatter.format(value);
}

export function formatCompactCurrency(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return (value >= 100000 ? compactCurrencyFormatter1 : compactCurrencyFormatter0).format(value);
}

export function formatDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || "--");
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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

export function formatCount(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return Math.round(value).toLocaleString();
}

export function formatWholePercent(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

export function formatSignedCount(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  if (value === 0) {
    return "0";
  }
  return `${value > 0 ? "+" : "-"}${Math.abs(value)}`;
}

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
