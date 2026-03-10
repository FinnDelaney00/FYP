export function parseNumeric(value) {
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

export function parseDate(value) {
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

export function parseBusinessDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const [year, month, day] = value.split("-").map((part) => Number(part));
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  return parseDate(value);
}

export function toDayKey(value) {
  const date = parseBusinessDate(value);
  if (!date) {
    return "";
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(value, days) {
  const date = parseBusinessDate(value);
  if (!date) {
    return null;
  }

  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getMonthKey(value) {
  const date = parseBusinessDate(value);
  if (!date) {
    return "";
  }
  return `${date.getFullYear()}-${date.getMonth()}`;
}

export function getPreviousMonthKey(value) {
  const date = parseBusinessDate(value);
  if (!date) {
    return "";
  }
  return `${date.getMonth() === 0 ? date.getFullYear() - 1 : date.getFullYear()}-${date.getMonth() === 0 ? 11 : date.getMonth() - 1}`;
}

export function getDaysRemainingInMonth(value) {
  const date = parseBusinessDate(value);
  if (!date) {
    return 0;
  }

  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12, 0, 0, 0);
  return Math.max(0, Math.round((monthEnd - date) / 86400000));
}

export function averageValues(values) {
  const valid = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(value));
  if (!valid.length) {
    return null;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

export function getLastItem(items) {
  return Array.isArray(items) && items.length ? items[items.length - 1] : null;
}
