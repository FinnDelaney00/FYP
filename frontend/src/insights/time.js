/**
 * Turns user input or backend values into a number when possible.
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
 * Turns dates into `Date` objects from objects, timestamps, or strings.
 *
 * Number values are treated as seconds unless they already look like
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
 * Parses a date while keeping the business day stable.
 *
 * Plain `YYYY-MM-DD` values are set to local midday so timezone offsets do not
 * shift them into the day before or after.
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
 * Turns a date-like value into a stable `YYYY-MM-DD` key.
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
 * Gets a month key in `YYYY-M` format for grouping.
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
 * Gets the previous month key for a business date.
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
 * Counts how many calendar days are left in the same month.
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
 * Gets the average of the valid numbers in a list.
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
 * Gets the last item in an array.
 *
 * @template T
 * @param {T[]} items
 * @returns {T | null}
 */
export function getLastItem(items) {
  return Array.isArray(items) && items.length ? items[items.length - 1] : null;
}
