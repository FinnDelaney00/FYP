/**
 * Parses a number from user-facing strings and backend payload values.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
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

/**
 * Parses timestamps expressed as Date objects, epoch values, or date strings.
 *
 * Numeric inputs are treated as seconds unless they already look like
 * millisecond timestamps.
 *
 * @param {unknown} value
 * @returns {Date | null}
 */
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

/**
 * Parses a date while preserving day-based business semantics.
 *
 * Bare `YYYY-MM-DD` values are normalized to local midday so timezone offsets do
 * not accidentally shift them into the previous or next day.
 *
 * @param {unknown} value
 * @returns {Date | null}
 */
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

/**
 * Converts a date-like value into a stable `YYYY-MM-DD` key.
 *
 * @param {unknown} value
 * @returns {string}
 */
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

/**
 * Adds whole days to a parsed business date.
 *
 * @param {unknown} value
 * @param {number} days
 * @returns {Date | null}
 */
export function addDays(value, days) {
  const date = parseBusinessDate(value);
  if (!date) {
    return null;
  }

  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Returns a month bucket key in `YYYY-M` form for grouping comparisons.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function getMonthKey(value) {
  const date = parseBusinessDate(value);
  if (!date) {
    return "";
  }
  return `${date.getFullYear()}-${date.getMonth()}`;
}

/**
 * Returns the prior month bucket for a given business date.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function getPreviousMonthKey(value) {
  const date = parseBusinessDate(value);
  if (!date) {
    return "";
  }
  return `${date.getMonth() === 0 ? date.getFullYear() - 1 : date.getFullYear()}-${date.getMonth() === 0 ? 11 : date.getMonth() - 1}`;
}

/**
 * Calculates how many calendar days remain in the same month.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function getDaysRemainingInMonth(value) {
  const date = parseBusinessDate(value);
  if (!date) {
    return 0;
  }

  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12, 0, 0, 0);
  return Math.max(0, Math.round((monthEnd - date) / 86400000));
}

/**
 * Returns the average of finite numeric values only.
 *
 * @param {unknown[]} values
 * @returns {number | null}
 */
export function averageValues(values) {
  const valid = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(value));
  if (!valid.length) {
    return null;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

/**
 * Safely returns the final item in an array.
 *
 * @template T
 * @param {T[]} items
 * @returns {T | null}
 */
export function getLastItem(items) {
  return Array.isArray(items) && items.length ? items[items.length - 1] : null;
}
