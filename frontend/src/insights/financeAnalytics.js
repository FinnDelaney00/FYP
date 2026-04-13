import {
  FINANCE_AMOUNT_FIELDS,
  FINANCE_CATEGORY_FIELDS,
  FINANCE_DATE_FIELDS,
  FINANCE_DEPARTMENT_FIELDS,
  FINANCE_EXPENDITURE_HINTS,
  FINANCE_REVENUE_HINTS,
  FINANCE_VENDOR_FIELDS
} from "./constants.js";
import { parseDate, parseNumeric } from "./time.js";

/**
 * Finance-specific normalization and summary helpers shared by the dashboard
 * and forecast views.
 */

/**
 * Returns the first non-empty string field from a record.
 *
 * @param {Record<string, any>} record
 * @param {string[]} fields
 * @param {string} [fallback=""]
 * @returns {string}
 */
function extractFirstField(record, fields, fallback = "") {
  for (const field of fields) {
    const value = record?.[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

/**
 * Discovers the most business-relevant date field available on a finance row.
 *
 * @param {Record<string, any>} record
 * @returns {Date | null}
 */
function extractFinanceDate(record) {
  for (const field of FINANCE_DATE_FIELDS) {
    const parsed = parseDate(record?.[field]);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

/**
 * Discovers a signed numeric amount from a finance row.
 *
 * The helper prefers direct amount fields and falls back to credit/debit pairs
 * when the schema stores inflows and outflows separately.
 *
 * @param {Record<string, any>} record
 * @returns {number | null}
 */
function extractFinanceAmount(record) {
  for (const field of FINANCE_AMOUNT_FIELDS) {
    const parsed = parseNumeric(record?.[field]);
    if (parsed !== null) {
      return parsed;
    }
  }

  const credit = parseNumeric(record?.credit);
  const debit = parseNumeric(record?.debit);
  if (credit !== null || debit !== null) {
    return (credit || 0) - (debit || 0);
  }

  return null;
}

/**
 * Classifies a finance row as revenue or expenditure.
 *
 * @param {Record<string, any>} record
 * @param {number} amount
 * @returns {"revenue" | "expenditure"}
 */
function classifyFinanceFlow(record, amount) {
  const hintText = [
    record?.transaction_type,
    record?.type,
    record?.category,
    record?.entry_type,
    record?.direction
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(" ")
    .toLowerCase();

  if (FINANCE_REVENUE_HINTS.some((token) => hintText.includes(token))) {
    return "revenue";
  }
  if (FINANCE_EXPENDITURE_HINTS.some((token) => hintText.includes(token))) {
    return "expenditure";
  }
  return amount >= 0 ? "revenue" : "expenditure";
}

/**
 * Normalizes raw finance rows into a frontend-friendly analytics shape.
 *
 * @param {Array<Record<string, any>>} rows
 * @returns {Array<Record<string, any>>}
 */
export function normalizeFinanceRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((record) => {
      const signedAmount = extractFinanceAmount(record);
      if (!Number.isFinite(signedAmount)) {
        return null;
      }

      const date = extractFinanceDate(record);
      return {
        raw: record,
        date,
        dayKey: date ? date.toISOString().slice(0, 10) : "",
        signedAmount,
        amount: Math.abs(signedAmount),
        flow: classifyFinanceFlow(record, signedAmount),
        category: extractFirstField(record, FINANCE_CATEGORY_FIELDS, "Other"),
        vendor: extractFirstField(record, FINANCE_VENDOR_FIELDS, "Unlabelled vendor"),
        department: extractFirstField(record, FINANCE_DEPARTMENT_FIELDS, "")
      };
    })
    .filter(Boolean);
}

/**
 * Aggregates the largest totals for a chosen finance dimension.
 *
 * @param {Array<Record<string, any>>} rows
 * @param {string} key
 * @param {number} [limit=5]
 * @returns {{ label: string, value: number }[]}
 */
function aggregateTopItems(rows, key, limit = 5) {
  const totals = new Map();

  rows.forEach((row) => {
    const label = String(row?.[key] || "").trim();
    if (!label) {
      return;
    }
    totals.set(label, (totals.get(label) || 0) + (Number(row.amount) || 0));
  });

  return Array.from(totals.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, limit);
}

/**
 * Produces the dashboard-ready finance summary derived from recent rows.
 *
 * @param {Array<Record<string, any>>} rows
 * @returns {Record<string, any>}
 */
export function buildFinanceAnalytics(rows) {
  const normalized = normalizeFinanceRows(rows);
  const expenses = normalized.filter((row) => row.flow === "expenditure");
  const datedExpenses = expenses.filter((row) => row.date).sort((left, right) => left.date - right.date);
  const latestDate = datedExpenses[datedExpenses.length - 1]?.date || null;
  const categoryBreakdown = aggregateTopItems(expenses, "category");
  const vendorBreakdown = aggregateTopItems(expenses, "vendor");
  const departmentBreakdown = aggregateTopItems(expenses.filter((row) => row.department), "department");

  const vendorCounts = new Map();
  expenses.forEach((row) => {
    const key = row.vendor || row.category || "Other";
    vendorCounts.set(key, (vendorCounts.get(key) || 0) + 1);
  });

  let recurringSpend = 0;
  let oneOffSpend = 0;
  expenses.forEach((row) => {
    const key = row.vendor || row.category || "Other";
    if ((vendorCounts.get(key) || 0) > 1) {
      recurringSpend += row.amount;
    } else {
      oneOffSpend += row.amount;
    }
  });

  const amounts = expenses.map((row) => row.amount).filter((value) => Number.isFinite(value));
  const average = amounts.length ? amounts.reduce((sum, value) => sum + value, 0) / amounts.length : 0;
  const variance = amounts.length
    ? amounts.reduce((sum, value) => sum + (value - average) ** 2, 0) / amounts.length
    : 0;
  const deviation = Math.sqrt(variance);
  const anomalyThreshold = average + deviation * 1.8;
  const unusualExpenses = expenses
    .filter((row) => row.amount > anomalyThreshold && row.amount > average * 1.35)
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 3);

  return {
    normalized,
    expenses,
    latestDate,
    categoryBreakdown,
    vendorBreakdown,
    departmentBreakdown,
    recurringSpend,
    oneOffSpend,
    unusualExpenses
  };
}

/**
 * Reads current and prior spend totals from the monthly revenue/expense series.
 *
 * @param {Array<Record<string, any>>} monthlySeries
 * @returns {{ currentSpend: number, previousSpend: number, spendChangePercent: number | null }}
 */
export function getMonthlySpendMetrics(monthlySeries) {
  const rows = Array.isArray(monthlySeries) ? monthlySeries : [];
  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];
  const currentSpend = Number(latest?.expenditure) || 0;
  const previousSpend = Number(previous?.expenditure) || 0;
  const spendChangePercent = previousSpend > 0 ? ((currentSpend - previousSpend) / previousSpend) * 100 : null;

  return {
    currentSpend,
    previousSpend,
    spendChangePercent
  };
}

/**
 * Derives current headcount and near-term movement from dashboard payload data.
 *
 * @param {Record<string, any>} charts
 * @param {Record<string, any>} metrics
 * @returns {{
 *   totalEmployees: number,
 *   growthCount: number,
 *   totalEmployeeDelta: number,
 *   projectedGrowthPercent: number
 * }}
 */
export function getEmployeeMetrics(charts, metrics) {
  const points = Array.isArray(charts?.employee_growth) ? charts.employee_growth : [];
  const actualPoints = points.filter((point) => !point.is_forecast);
  const latestActual = actualPoints[actualPoints.length - 1];
  const previousActual = actualPoints[actualPoints.length - 2];
  const growthCount = latestActual && previousActual ? (Number(latestActual.value) || 0) - (Number(previousActual.value) || 0) : 0;
  const totalEmployees = Number(metrics?.total_employees?.value || latestActual?.value || 0);

  return {
    totalEmployees,
    growthCount,
    totalEmployeeDelta: Number(metrics?.total_employees?.delta_percent),
    projectedGrowthPercent: Number(metrics?.growth_rate?.value_percent)
  };
}

/**
 * Returns the largest department entry by value.
 *
 * @param {Array<{ label: string, value: number }>} items
 * @returns {{ label: string, value: number } | null}
 */
export function getLargestDepartment(items) {
  const departments = Array.isArray(items) ? items : [];
  return departments
    .map((item) => ({
      label: item.label || "Unknown",
      value: Number(item.value) || 0
    }))
    .sort((left, right) => right.value - left.value)[0] || null;
}
