/**
 * File purpose:
 * Fetches dashboard, forecast, and query data from the backend API and renders
 * metrics, charts, forecast panels, and query result tables in the UI.
 */
import { createGetJSON } from "./insights/api.js";
import { buildAreaPath, buildSmoothLinePath, pickSeriesAxisLabels } from "./insights/chartUtils.js";
import {
  API_BASE_URL,
  DEFAULT_FORECAST_HORIZON_DAYS,
  FORECAST_ACTUAL_WINDOW_BY_HORIZON
} from "./insights/constants.js";
import { createDashboardModule } from "./insights/dashboardModule.js";
import { createElementCache } from "./insights/domCache.js";
import {
  buildFinanceAnalytics,
  getLargestDepartment,
  normalizeFinanceRows
} from "./insights/financeAnalytics.js";
import {
  escapeHtml,
  formatBusinessDateTime,
  formatCompactCurrency,
  formatCount,
  formatCurrency,
  formatDateLabel,
  formatLongDate,
  formatSignedCount,
  formatWholePercent
} from "./insights/formatters.js";
import { createGraphModule } from "./insights/graphModule.js";
import { createQueryModule } from "./insights/queryModule.js";
import {
  addDays,
  getDaysRemainingInMonth,
  getMonthKey,
  getPreviousMonthKey,
  parseBusinessDate,
  parseNumeric,
  toDayKey
} from "./insights/time.js";

let latestDashboardPayload = null;
let latestForecastPayload = null;
let latestFinanceRowsState = {
  rows: [],
  columns: [],
  refreshedAt: null
};

const forecastViewState = {
  horizonDays: DEFAULT_FORECAST_HORIZON_DAYS,
  focus: "all"
};

const getJSON = createGetJSON(API_BASE_URL);
const dashboardModule = createDashboardModule({
  getLatestFinanceRowsState: () => latestFinanceRowsState
});
const queryModule = createQueryModule({ getJSON });
const graphModule = createGraphModule({
  getLatestDashboardPayload: () => latestDashboardPayload
});
const getElement = createElementCache();

/**
 * Delegates dashboard rendering to the dedicated dashboard module.
 *
 * @param {Record<string, any>} payload
 */
function renderDashboard(payload) {
  dashboardModule.renderDashboard(payload || {});
}

/**
 * Runs the query page action through the query module.
 *
 * @param {() => string} getAuthToken
 * @returns {Promise<void>}
 */
async function runQuery(getAuthToken) {
  await queryModule.runQuery(getAuthToken);
}

/**
 * Hydrates the query page builder controls.
 *
 * @param {() => string} getAuthToken
 * @returns {Promise<void>}
 */
async function initializeQueryPage(getAuthToken) {
  await queryModule.initializeQueryPage(getAuthToken);
}

/**
 * Binds the custom graph preview page once.
 */
function initializeCreateGraphPage() {
  graphModule.initializeCreateGraphPage();
}

const FORECAST_TEXT = {
  headcountRise: (value, days) => `Headcount is expected to rise by ${Math.abs(value)} over the next ${days} days.`,
  headcountEase: (value, days) => `Headcount is expected to ease by ${Math.abs(value)} over the next ${days} days.`,
  headcountSteady: (days) => `Headcount is expected to remain steady over the next ${days} days.`,
  headcountProjection: (current, projected, days) => `Headcount is projected to move from ${formatCount(current)} to ${formatCount(projected)} over the selected ${days}-day outlook.`
};

// Generic helpers used across the forecast view-model pipeline.

/**
 * Safely returns the last item in a collection.
 *
 * @template T
 * @param {T[]} items
 * @returns {T | null}
 */
function getLastItem(items) {
  return Array.isArray(items) && items.length ? items[items.length - 1] : null;
}

/**
 * Computes the average of only finite numeric values.
 *
 * @param {unknown[]} values
 * @returns {number | null}
 */
function averageValues(values) {
  const valid = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(value));
  if (!valid.length) {
    return null;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

/**
 * Aggregates normalized finance rows into a chronological daily spend history.
 *
 * @param {Array<Record<string, any>>} rows
 * @returns {Array<Record<string, any>>}
 */
function buildDailySpendHistory(rows) {
  const totals = new Map();

  normalizeFinanceRows(rows)
    .filter((row) => row.flow === "expenditure" && row.dayKey)
    .forEach((row) => {
      totals.set(row.dayKey, (totals.get(row.dayKey) || 0) + (Number(row.amount) || 0));
    });

  return Array.from(totals.entries())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([dayKey, value]) => ({
      dayKey,
      date: parseBusinessDate(dayKey),
      value: Number(value) || 0,
      axisLabel: formatDateLabel(dayKey),
      tooltipLabel: formatLongDate(dayKey),
      isForecast: false
    }))
    .filter((point) => point.date);
}

/**
 * Selects the recent actual-spend window used alongside the forecast line.
 *
 * @param {Array<Record<string, any>>} dailySeries
 * @param {number} horizonDays
 * @returns {Array<Record<string, any>>}
 */
function buildSpendActualWindow(dailySeries, horizonDays) {
  const series = Array.isArray(dailySeries) ? dailySeries : [];
  if (!series.length) {
    return [];
  }

  const latest = getLastItem(series);
  const pointsByDay = new Map(series.map((point) => [point.dayKey, point]));
  const daysToShow = FORECAST_ACTUAL_WINDOW_BY_HORIZON[horizonDays] || DEFAULT_FORECAST_HORIZON_DAYS;
  const startDate = addDays(latest.date, -(daysToShow - 1));
  const window = [];

  for (let cursor = new Date(startDate); cursor <= latest.date; cursor = addDays(cursor, 1)) {
    const dayKey = toDayKey(cursor);
    const point = pointsByDay.get(dayKey);
    window.push({
      dayKey,
      date: parseBusinessDate(dayKey),
      value: point ? point.value : 0,
      axisLabel: formatDateLabel(dayKey),
      tooltipLabel: formatLongDate(dayKey),
      isForecast: false
    });
  }

  return window;
}

/**
 * Normalizes forecast rows into a shared chart-friendly series shape.
 *
 * @param {Array<Record<string, any>>} items
 * @param {(item: Record<string, any>) => number} valueAccessor
 * @param {(value: number) => number} [valueFormatter=(value) => value]
 * @returns {Array<Record<string, any>>}
 */
function normalizeForecastSeries(items, valueAccessor, valueFormatter = (value) => value) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const date = parseBusinessDate(item?.date);
      const value = Number(valueAccessor(item));
      if (!date || !Number.isFinite(value)) {
        return null;
      }

      const lower = parseNumeric(item?.lower_ci);
      const upper = parseNumeric(item?.upper_ci);
      return {
        date,
        value: valueFormatter(value),
        lower_ci: Number.isFinite(lower) ? valueFormatter(lower) : null,
        upper_ci: Number.isFinite(upper) ? valueFormatter(upper) : null,
        axisLabel: formatDateLabel(date),
        tooltipLabel: formatLongDate(date),
        isForecast: true
      };
    })
    .filter(Boolean);
}

/**
 * Normalizes spend forecast rows into non-negative values.
 *
 * @param {Array<Record<string, any>>} items
 * @returns {Array<Record<string, any>>}
 */
function normalizeSpendForecastSeries(items) {
  return normalizeForecastSeries(
    items,
    (item) => item?.predicted_expenditure ?? item?.predicted_revenue,
    (value) => Math.max(0, value)
  );
}

/**
 * Normalizes headcount forecast rows into rounded employee counts.
 *
 * @param {Array<Record<string, any>>} items
 * @returns {Array<Record<string, any>>}
 */
function normalizeHeadcountForecastSeries(items) {
  return normalizeForecastSeries(
    items,
    (item) => item?.predicted_headcount,
    (value) => Math.max(0, Math.round(value))
  );
}

/**
 * Builds the recent actual headcount series shown before the forecast starts.
 *
 * @param {Record<string, any>} dashboardPayload
 * @param {number} currentHeadcount
 * @returns {Array<Record<string, any>>}
 */
function buildHeadcountActualSeries(dashboardPayload, currentHeadcount) {
  const points = Array.isArray(dashboardPayload?.charts?.employee_growth)
    ? dashboardPayload.charts.employee_growth.filter((point) => !point.is_forecast)
    : [];
  const limit = forecastViewState.horizonDays >= 90 ? 8 : forecastViewState.horizonDays >= 30 ? 6 : 5;
  const series = points.slice(-limit).map((point, index) => ({
    label: point.label || `Point ${index + 1}`,
    axisLabel: point.label || `Point ${index + 1}`,
    tooltipLabel: point.label || `Point ${index + 1}`,
    value: Number(point.value) || 0,
    isForecast: false
  }));

  if (!series.length && Number.isFinite(currentHeadcount) && currentHeadcount > 0) {
    return [
      {
        label: "Current",
        axisLabel: "Current",
        tooltipLabel: "Current reported headcount",
        value: Math.round(currentHeadcount),
        isForecast: false
      }
    ];
  }

  return series;
}

/**
 * Estimates month-end spend by combining current-month actuals with forecast rows.
 *
 * @param {Array<Record<string, any>>} actualDailySeries
 * @param {Array<Record<string, any>>} spendForecastSeries
 * @returns {Record<string, any>}
 */
function calculateMonthEndProjection(actualDailySeries, spendForecastSeries) {
  const actualSeries = Array.isArray(actualDailySeries) ? actualDailySeries : [];
  if (!actualSeries.length) {
    return {
      currentMonthActual: null,
      projectedMonthEndSpend: null,
      previousMonthSpend: null,
      projectedVsLastMonth: null,
      coverageDays: 0,
      fallbackDays: 0,
      latestActualDate: null
    };
  }

  const latestActual = getLastItem(actualSeries);
  const currentMonthKey = getMonthKey(latestActual.date);
  const previousMonthKey = getPreviousMonthKey(latestActual.date);
  const currentMonthActual = actualSeries
    .filter((point) => getMonthKey(point.date) === currentMonthKey)
    .reduce((sum, point) => sum + point.value, 0);
  const previousMonthSpend = actualSeries
    .filter((point) => getMonthKey(point.date) === previousMonthKey)
    .reduce((sum, point) => sum + point.value, 0);
  const remainingDays = getDaysRemainingInMonth(latestActual.date);
  const monthEndForecast = (Array.isArray(spendForecastSeries) ? spendForecastSeries : [])
    .filter((point) => point.date > latestActual.date && getMonthKey(point.date) === currentMonthKey);
  const coverageDays = monthEndForecast.length;
  const missingDays = Math.max(0, remainingDays - coverageDays);
  const averageForecastValue = averageValues(monthEndForecast.map((point) => point.value))
    ?? averageValues((Array.isArray(spendForecastSeries) ? spendForecastSeries : []).map((point) => point.value))
    ?? 0;
  const forecastedSpend = monthEndForecast.reduce((sum, point) => sum + point.value, 0);
  const projectedMonthEndSpend = currentMonthActual + forecastedSpend + (missingDays ? averageForecastValue * missingDays : 0);
  const projectedVsLastMonth = previousMonthSpend > 0
    ? ((projectedMonthEndSpend - previousMonthSpend) / previousMonthSpend) * 100
    : null;

  return {
    currentMonthActual,
    projectedMonthEndSpend,
    previousMonthSpend,
    projectedVsLastMonth,
    coverageDays,
    fallbackDays: missingDays,
    latestActualDate: latestActual.date
  };
}

/**
 * Measures how wide forecast confidence intervals are relative to point values.
 *
 * @param {Array<Record<string, any>>} series
 * @returns {number | null}
 */
function getAverageIntervalRatio(series) {
  const points = (Array.isArray(series) ? series : []).filter((point) =>
    Number.isFinite(point.value) && Number.isFinite(point.lower_ci) && Number.isFinite(point.upper_ci)
  );

  if (!points.length) {
    return null;
  }

  return points.reduce((sum, point) => {
    const spread = Math.max(0, (point.upper_ci || 0) - (point.lower_ci || 0));
    return sum + spread / Math.max(1, point.value);
  }, 0) / points.length;
}

/**
 * Derives a user-facing confidence score from data health and interval width.
 *
 * @param {Record<string, any>} dashboardPayload
 * @param {Array<Record<string, any>>} spendForecastSeries
 * @param {Array<Record<string, any>>} headcountForecastSeries
 * @returns {{ score: number, label: string, tone: string, summary: string }}
 */
function deriveForecastConfidence(dashboardPayload, spendForecastSeries, headcountForecastSeries) {
  const healthScore = Number(dashboardPayload?.metrics?.data_health?.value_percent);
  const intervalRatio = averageValues([
    getAverageIntervalRatio(spendForecastSeries),
    getAverageIntervalRatio(headcountForecastSeries)
  ]);

  let intervalScore = 68;
  if (Number.isFinite(intervalRatio)) {
    if (intervalRatio <= 0.15) {
      intervalScore = 90;
    } else if (intervalRatio <= 0.3) {
      intervalScore = 76;
    } else if (intervalRatio <= 0.45) {
      intervalScore = 61;
    } else {
      intervalScore = 46;
    }
  }

  const score = Math.round(
    (Number.isFinite(healthScore) ? healthScore : intervalScore) * 0.65 +
    intervalScore * 0.35
  );

  if (score >= 78) {
    return {
      score,
      label: "High",
      tone: "positive",
      summary: "Recent spend and workforce patterns are consistent, and the prediction ranges remain relatively tight."
    };
  }

  if (score >= 58) {
    return {
      score,
      label: "Medium",
      tone: "muted",
      summary: "The outlook is directionally useful, but later forecast points carry a wider range of likely outcomes."
    };
  }

  return {
    score,
    label: "Low",
    tone: "warning",
    summary: "Use this as a planning guide only for now. The recent data pattern is less stable and the prediction range is wider."
  };
}

/**
 * Builds a simple risk label from projected spend, anomalies, confidence, and hiring.
 *
 * @param {{ projectedVsLastMonth: number | null, unusualExpenseCount: number, confidenceScore: number, headcountChange: number | null }} payload
 * @returns {{ label: string, tone: string, summary: string }}
 */
function deriveForecastRisk({
  projectedVsLastMonth,
  unusualExpenseCount,
  confidenceScore,
  headcountChange
}) {
  let score = 0;
  const reasons = [];

  if (Number.isFinite(projectedVsLastMonth) && projectedVsLastMonth >= 10) {
    score += 2;
    reasons.push("spend is tracking materially above last month");
  } else if (Number.isFinite(projectedVsLastMonth) && projectedVsLastMonth >= 4) {
    score += 1;
    reasons.push("spend is trending above last month");
  }

  if ((Number(unusualExpenseCount) || 0) > 0) {
    score += 1;
    reasons.push("recent transactions are less predictable");
  }

  if (Number.isFinite(confidenceScore) && confidenceScore < 58) {
    score += 1;
    reasons.push("forecast confidence is limited");
  }

  if (Number.isFinite(headcountChange) && headcountChange >= 5) {
    score += 1;
    reasons.push("payroll demand is increasing");
  }

  if (score >= 3) {
    return {
      label: "High",
      tone: "warning",
      summary: reasons[0]
        ? `High risk of plan drift because ${reasons.slice(0, 2).join(" and ")}.`
        : "High risk of plan drift."
    };
  }

  if (score >= 1) {
    return {
      label: "Medium",
      tone: "muted",
      summary: reasons[0]
        ? `Some variance is worth watching because ${reasons.slice(0, 2).join(" and ")}.`
        : "Some variance is worth watching."
    };
  }

  return {
    label: "Low",
    tone: "positive",
    summary: "No major overspend or hiring spike stands out in the current forecast window."
  };
}

/**
 * Builds the KPI cards shown at the top of the forecasts page.
 *
 * @param {Record<string, any>} payload
 * @returns {Array<Record<string, any>>}
 */
function buildForecastSummaryCards({
  monthProjection,
  projectedHeadcount,
  headcountIncrease,
  risk,
  confidence,
  selectedHorizon,
  spendWindowDays
}) {
  const spendTone = Number.isFinite(monthProjection.projectedVsLastMonth)
    ? monthProjection.projectedVsLastMonth > 0
      ? "warning"
      : "positive"
    : "muted";
  const spendComparison = Number.isFinite(monthProjection.projectedVsLastMonth)
    ? `${Math.abs(monthProjection.projectedVsLastMonth).toFixed(1)}% ${monthProjection.projectedVsLastMonth >= 0 ? "higher" : "lower"}`
    : "Awaiting prior-month baseline";

  return [
    {
      title: "Projected Month-End Spend",
      value: formatCurrency(monthProjection.projectedMonthEndSpend),
      subtitle: monthProjection.projectedMonthEndSpend
        ? "Expected by month end based on current spend pace."
        : "Waiting for enough spend history to estimate month end.",
      trend: `${spendWindowDays} days of actual spend in view`,
      tone: "muted"
    },
    {
      title: "Spend Forecast vs Last Month",
      value: Number.isFinite(monthProjection.projectedVsLastMonth) ? formatWholePercent(monthProjection.projectedVsLastMonth) : "--",
      subtitle: Number.isFinite(monthProjection.projectedVsLastMonth)
        ? `${spendComparison} than last month.`
        : "Comparison appears after a full prior month is available.",
      trend: spendComparison,
      tone: spendTone
    },
    {
      title: "Projected Headcount",
      value: formatCount(projectedHeadcount),
      subtitle: projectedHeadcount
        ? `Expected by the end of the next ${selectedHorizon} days.`
        : "Waiting for enough employee history to project headcount.",
      trend: Number.isFinite(headcountIncrease)
        ? `${formatSignedCount(headcountIncrease)} from today`
        : "No current baseline",
      tone: Number.isFinite(headcountIncrease) && headcountIncrease > 0 ? "positive" : "muted"
    },
    {
      title: "Forecast Risk Level",
      value: risk.label,
      subtitle: risk.summary,
      trend: risk.label === "High" ? "Requires attention" : risk.label === "Medium" ? "Monitor closely" : "Stable outlook",
      tone: risk.tone
    },
    {
      title: "Forecast Confidence",
      value: Number.isFinite(confidence.score) ? `${confidence.score}%` : confidence.label,
      subtitle: "Based on recent data consistency and forecast range width.",
      trend: `${confidence.label} confidence`,
      tone: confidence.tone
    }
  ];
}

/**
 * Produces the primary plain-English highlights for the current forecast window.
 *
 * @param {Record<string, any>} payload
 * @returns {Array<Record<string, any>>}
 */
function buildForecastHighlights({
  monthProjection,
  selectedHorizon,
  headcountIncrease,
  projectedHeadcount,
  currentHeadcount,
  risk,
  confidence,
  financeAnalytics
}) {
  const largestCategory = financeAnalytics.categoryBreakdown[0] || null;
  const unusualExpenseCount = financeAnalytics.unusualExpenses.length;
  const notes = [];

  if (Number.isFinite(monthProjection.projectedVsLastMonth)) {
    notes.push({
      metric: "spend",
      tag: "Spend",
      tone: monthProjection.projectedVsLastMonth > 0 ? "warning" : "positive",
      title: `Monthly spend is projected to finish ${Math.abs(monthProjection.projectedVsLastMonth).toFixed(1)}% ${monthProjection.projectedVsLastMonth >= 0 ? "above" : "below"} last month.`,
      body: "This compares projected month-end spend against the last completed month."
    });
  }

  if (Number.isFinite(headcountIncrease) && projectedHeadcount > 0) {
    notes.push({
      metric: "headcount",
      tag: "Headcount",
      tone: headcountIncrease > 0 ? "positive" : "muted",
      title: headcountIncrease > 0
        ? FORECAST_TEXT.headcountRise(headcountIncrease, selectedHorizon)
        : headcountIncrease < 0
          ? FORECAST_TEXT.headcountEase(headcountIncrease, selectedHorizon)
          : FORECAST_TEXT.headcountSteady(selectedHorizon),
      body: currentHeadcount
        ? `Current headcount is ${formatCount(currentHeadcount)} with a projected end point of ${formatCount(projectedHeadcount)}.`
        : "The forecast will sharpen as more workforce updates are processed."
    });
  }

  notes.push({
    metric: "all",
    tag: "Confidence",
    tone: confidence.tone,
    title: `Forecast confidence is ${confidence.label.toLowerCase()}.`,
    body: confidence.summary
  });

  if (largestCategory) {
    notes.push({
      metric: "spend",
      tag: "Cost driver",
      tone: "muted",
      title: `${largestCategory.label} remains the largest recent cost driver.`,
      body: `${formatCurrency(largestCategory.value)} of recent tracked spend sits in this category.`
    });
  }

  notes.push({
    metric: "all",
    tag: "Risk",
    tone: risk.tone,
    title: unusualExpenseCount
      ? `${unusualExpenseCount} unusual payment${unusualExpenseCount === 1 ? "" : "s"} could push spend above forecast.`
      : "No major spending spike is currently forecast.",
    body: unusualExpenseCount
      ? "Treat recent outlier transactions as early warning signals rather than one-off noise."
      : "The current forecast range does not show a sharp late-window spending jump."
  });

  return notes;
}

/**
 * Produces the "risks" note stack for the current forecast window.
 *
 * @param {Record<string, any>} payload
 * @returns {Array<Record<string, any>>}
 */
function buildForecastRisks({
  monthProjection,
  headcountIncrease,
  risk,
  confidence,
  financeAnalytics
}) {
  const largestCategory = financeAnalytics.categoryBreakdown[0] || null;
  const notes = [];

  if (Number.isFinite(monthProjection.projectedVsLastMonth) && monthProjection.projectedVsLastMonth > 4) {
    notes.push({
      metric: "spend",
      tag: "Spend pressure",
      tone: "warning",
      title: "Spend is trending above last month.",
      body: `Projected month-end spend is ${formatWholePercent(monthProjection.projectedVsLastMonth)} versus last month.`
    });
  }

  if (Number.isFinite(headcountIncrease) && headcountIncrease > 0) {
    notes.push({
      metric: "headcount",
      tag: "Payroll",
      tone: headcountIncrease >= 5 ? "warning" : "muted",
      title: "Payroll demand is likely to rise.",
      body: `${Math.abs(headcountIncrease)} additional employee${Math.abs(headcountIncrease) === 1 ? "" : "s"} are currently expected in the forecast window.`
    });
  }

  if (confidence.label !== "High") {
    notes.push({
      metric: "all",
      tag: "Confidence",
      tone: confidence.tone,
      title: "Forecast ranges widen later in the outlook window.",
      body: "Treat later dates as directional guidance and refresh the forecast after the next data sync."
    });
  }

  if (financeAnalytics.unusualExpenses.length) {
    notes.push({
      metric: "spend",
      tag: "Variability",
      tone: "warning",
      title: "Recent payments are less predictable than usual.",
      body: `${financeAnalytics.unusualExpenses.length} unusual transaction${financeAnalytics.unusualExpenses.length === 1 ? "" : "s"} stand out in recent spend activity.`
    });
  } else if (largestCategory) {
    notes.push({
      metric: "spend",
      tag: "Concentration",
      tone: "muted",
      title: `${largestCategory.label} is your largest current spend concentration.`,
      body: "A change in this cost area would move the month-end outcome faster than smaller categories."
    });
  }

  if (!notes.length) {
    notes.push({
      metric: "all",
      tag: "Risk",
      tone: risk.tone,
      title: "No immediate planning risk stands out.",
      body: risk.summary
    });
  }

  return notes;
}

/**
 * Produces the recommended actions note stack for the current forecast window.
 *
 * @param {Record<string, any>} payload
 * @returns {Array<Record<string, any>>}
 */
function buildForecastActions({
  headcountIncrease,
  confidence,
  financeAnalytics,
  dashboardPayload
}) {
  const largestCategory = financeAnalytics.categoryBreakdown[0] || null;
  const largestDepartment = getLargestDepartment(dashboardPayload?.charts?.department_distribution || []);
  const notes = [];

  if (largestCategory) {
    notes.push({
      metric: "spend",
      tag: "Budget action",
      tone: "warning",
      title: "Review the highest recurring spend categories this week.",
      body: `${largestCategory.label} is the first place to look if spend continues to run above plan.`
    });
  }

  if (Number.isFinite(headcountIncrease) && headcountIncrease > 0) {
    notes.push({
      metric: "headcount",
      tag: "People planning",
      tone: "positive",
      title: "Prepare for moderate payroll growth over the next month.",
      body: `The current outlook points to ${Math.abs(headcountIncrease)} more employee${Math.abs(headcountIncrease) === 1 ? "" : "s"} than today.`
    });
  }

  if (largestDepartment) {
    notes.push({
      metric: "headcount",
      tag: "Department watch",
      tone: "muted",
      title: `Monitor ${largestDepartment.label} as your largest team.`,
      body: "Capacity or hiring changes in the largest department will have the biggest effect on workforce planning."
    });
  }

  notes.push({
    metric: "all",
    tag: "Refresh cadence",
    tone: confidence.tone,
    title: "Recheck the outlook after the next data refresh.",
    body: confidence.label === "High"
      ? "Use this forecast to plan with confidence, but still confirm after each major spend or hiring update."
      : "A fresh data sync should improve the forecast before you lock in decisions."
  });

  return notes;
}

/**
 * Reorders note cards to favor the selected focus area while preserving variety.
 *
 * @param {Array<Record<string, any>>} items
 * @param {"all" | "spend" | "headcount"} focus
 * @param {number} [limit=4]
 * @returns {Array<Record<string, any>>}
 */
function prioritizeForecastNotes(items, focus, limit = 4) {
  const notes = Array.isArray(items) ? items : [];
  if (focus === "all") {
    return notes.slice(0, limit);
  }

  return [
    ...notes.filter((item) => item.metric === focus),
    ...notes.filter((item) => item.metric === "all"),
    ...notes.filter((item) => item.metric !== focus && item.metric !== "all")
  ].slice(0, limit);
}

/**
 * Renders a collection of HTML fragments into a container.
 *
 * @param {HTMLElement} container
 * @param {Array<Record<string, any>>} items
 * @param {(item: Record<string, any>) => string} renderItem
 */
function renderHtmlCollection(container, items, renderItem) {
  container.innerHTML = (Array.isArray(items) ? items : [])
    .map(renderItem)
    .join("");
}

/**
 * Renders the forecast KPI card row.
 *
 * @param {Array<Record<string, any>>} cards
 */
function renderForecastSummaryCards(cards) {
  const container = getElement("forecast-summary-cards");
  if (!container) {
    return;
  }

  renderHtmlCollection(container, cards, (card) => `
      <article class="panel metric-card-business forecast-kpi-card">
        <div class="metric-card-top">
          <h3>${escapeHtml(card.title)}</h3>
          <span class="metric-trend" data-tone="${escapeHtml(card.tone || "muted")}">${escapeHtml(card.trend || "--")}</span>
        </div>
        <strong>${escapeHtml(card.value || "--")}</strong>
        <p>${escapeHtml(card.subtitle || "")}</p>
      </article>
    `);
}

/**
 * Renders one of the forecast note columns with a fallback empty state.
 *
 * @param {string} containerId
 * @param {Array<Record<string, any>>} items
 * @param {string} emptyTitle
 * @param {string} emptyBody
 */
function renderForecastNotes(containerId, items, emptyTitle, emptyBody) {
  const container = getElement(containerId);
  if (!container) {
    return;
  }

  const notes = Array.isArray(items) ? items : [];
  if (!notes.length) {
    container.innerHTML = `
      <article class="forecast-note-item" data-tone="muted">
        <span class="forecast-note-tag">Update pending</span>
        <h4>${escapeHtml(emptyTitle)}</h4>
        <p>${escapeHtml(emptyBody)}</p>
      </article>
    `;
    return;
  }

  renderHtmlCollection(container, notes, (item) => `
      <article class="forecast-note-item" data-tone="${escapeHtml(item.tone || "muted")}">
        <span class="forecast-note-tag">${escapeHtml(item.tag || "Forecast")}</span>
        <h4>${escapeHtml(item.title || "")}</h4>
        <p>${escapeHtml(item.body || "")}</p>
      </article>
    `);
}

/**
 * Renders the trust/explainer rows that describe forecast freshness and confidence.
 *
 * @param {Array<Record<string, any>>} rows
 */
function renderForecastTrustRows(rows) {
  const container = getElement("forecast-trust-list");
  if (!container) {
    return;
  }

  renderHtmlCollection(container, rows, (row) => `
      <article class="forecast-trust-row">
        <span>${escapeHtml(row.label || "")}</span>
        <strong>${escapeHtml(row.value || "--")}</strong>
        <p>${escapeHtml(row.body || "")}</p>
      </article>
    `);
}

/**
 * Renders the compact headcount summary cards.
 *
 * @param {Array<Record<string, any>>} items
 */
function renderHeadcountStatCards(items) {
  const container = getElement("forecast-headcount-summary");
  if (!container) {
    return;
  }

  renderHtmlCollection(container, items, (item) => `
      <article class="forecast-stat-card">
        <span>${escapeHtml(item.label || "")}</span>
        <strong>${escapeHtml(item.value || "--")}</strong>
        <p>${escapeHtml(item.subtitle || "")}</p>
      </article>
    `);
}

/**
 * Renders the department mix chips used to contextualize workforce projections.
 *
 * @param {Array<Record<string, any>>} items
 */
function renderForecastDepartmentSummary(items) {
  const container = getElement("forecast-department-summary");
  if (!container) {
    return;
  }

  const departments = Array.isArray(items) ? items : [];
  if (!departments.length) {
    container.innerHTML = "";
    return;
  }

  const total = departments.reduce((sum, item) => sum + (Number(item.value) || 0), 0) || 1;
  container.innerHTML = `
    <div class="forecast-department-copy">
      <span>Current team mix</span>
      <p>Largest departments today, shown to add context to the workforce forecast.</p>
    </div>
    <div class="forecast-department-chips">
      ${departments.slice(0, 4).map((item) => {
        const share = ((Number(item.value) || 0) / total) * 100;
        return `
          <span class="forecast-department-chip">
            <b>${escapeHtml(item.label || "Unknown")}</b>
            ${share.toFixed(0)}%
          </span>
        `;
      }).join("")}
    </div>
  `;
}

/**
 * Builds a straight SVG path, used here for confidence-band polygons.
 *
 * @param {{ x: number, y: number }[]} points
 * @param {boolean} [closePath=false]
 * @returns {string}
 */
function buildLinearPath(points, closePath = false) {
  const coords = Array.isArray(points) ? points : [];
  if (!coords.length) {
    return "";
  }

  let path = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let index = 1; index < coords.length; index += 1) {
    path += ` L ${coords[index].x.toFixed(1)} ${coords[index].y.toFixed(1)}`;
  }

  return closePath ? `${path} Z` : path;
}

/**
 * Attaches hover tooltips to a rendered forecast chart.
 *
 * @param {string} containerId
 */
function bindForecastTooltip(containerId) {
  const container = getElement(containerId);
  const shell = container?.querySelector(".forecast-chart-inner");
  const tooltip = container?.querySelector(".forecast-chart-tooltip");
  if (!container || !shell || !tooltip) {
    return;
  }

  const hideTooltip = () => {
    tooltip.hidden = true;
  };

  container.onmousemove = (event) => {
    const text = event.target?.dataset?.tooltip;
    if (!text) {
      hideTooltip();
      return;
    }

    tooltip.hidden = false;
    tooltip.textContent = text;

    const rect = shell.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    let left = event.clientX - rect.left + 12;
    let top = event.clientY - rect.top - tooltipRect.height - 12;

    if (left + tooltipRect.width > rect.width - 8) {
      left = rect.width - tooltipRect.width - 8;
    }
    if (left < 8) {
      left = 8;
    }
    if (top < 8) {
      top = event.clientY - rect.top + 14;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  container.onmouseleave = hideTooltip;
}

/**
 * Renders either the spend or headcount forecast chart.
 *
 * @param {Record<string, any>} config
 */
function renderForecastTrendChart({
  containerId,
  actualSeries,
  forecastSeries,
  formatter,
  emptyTitle,
  emptyBody,
  ariaLabel,
  type = "spend"
}) {
  const container = getElement(containerId);
  if (!container) {
    return;
  }

  const actual = Array.isArray(actualSeries) ? actualSeries : [];
  const forecast = Array.isArray(forecastSeries) ? forecastSeries : [];
  if (!actual.length && !forecast.length) {
    container.innerHTML = `
      <div class="forecast-empty-state">
        <h4>${escapeHtml(emptyTitle)}</h4>
        <p>${escapeHtml(emptyBody)}</p>
      </div>
    `;
    container.classList.remove("skeleton-block");
    return;
  }

  const combined = [...actual, ...forecast];
  const width = 760;
  const height = 300;
  const paddingX = 26;
  const paddingY = 22;
  const chartHeight = height - paddingY * 2;
  const values = combined.flatMap((point) => [
    Number(point.value),
    Number.isFinite(point.lower_ci) ? Number(point.lower_ci) : Number(point.value),
    Number.isFinite(point.upper_ci) ? Number(point.upper_ci) : Number(point.value)
  ]).filter((value) => Number.isFinite(value));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spread = maxValue - minValue;
  const paddingValue = spread > 0 ? spread * 0.18 : Math.max(maxValue * 0.15, 1);
  const domainMin = Math.max(0, minValue - paddingValue);
  const domainMax = maxValue + paddingValue;
  const range = Math.max(1, domainMax - domainMin);
  const baselineY = height - paddingY;
  const toY = (value) => paddingY + ((domainMax - value) / range) * chartHeight;

  const coords = combined.map((point, index) => ({
    ...point,
    x: combined.length === 1
      ? width / 2
      : paddingX + (index / (combined.length - 1)) * (width - paddingX * 2),
    y: toY(Number(point.value) || 0)
  }));
  const actualCoords = coords.slice(0, actual.length);
  const forecastCoords = coords.slice(actual.length);
  const actualPath = actualCoords.length ? buildSmoothLinePath(actualCoords) : "";
  const actualArea = actualCoords.length ? buildAreaPath(actualCoords, baselineY, actualPath) : "";
  const forecastLineCoords = actualCoords.length && forecastCoords.length
    ? [actualCoords[actualCoords.length - 1], ...forecastCoords]
    : forecastCoords;
  const forecastPath = forecastLineCoords.length ? buildSmoothLinePath(forecastLineCoords) : "";
  const upperCoords = forecast.map((point, index) => ({
    x: forecastCoords[index]?.x || 0,
    y: toY(Number.isFinite(point.upper_ci) ? point.upper_ci : point.value)
  }));
  const lowerCoords = forecast.map((point, index) => ({
    x: forecastCoords[index]?.x || 0,
    y: toY(Number.isFinite(point.lower_ci) ? point.lower_ci : point.value)
  }));
  const confidenceBandPath = upperCoords.length && lowerCoords.length
    ? buildLinearPath([...upperCoords, ...lowerCoords.reverse()], true)
    : "";
  const dividerX = actualCoords.length && forecastCoords.length ? forecastCoords[0].x : null;
  const axisLabels = pickSeriesAxisLabels(combined, 6, ["axisLabel", "label"]);
  const gridLines = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const y = paddingY + chartHeight * ratio;
    const value = domainMax - ratio * range;
    const axisValue = type === "spend" ? formatCompactCurrency(value) : formatCount(value);
    return `
      <line class="forecast-grid-line" x1="${paddingX}" y1="${y.toFixed(1)}" x2="${width - paddingX}" y2="${y.toFixed(1)}"></line>
      <text class="forecast-y-label" x="${paddingX}" y="${(y - 6).toFixed(1)}">${escapeHtml(axisValue)}</text>
    `;
  }).join("");

  const points = coords
    .map((point, index) => {
      const isForecast = index >= actual.length;
      const tooltipParts = [
        isForecast ? "Forecast" : "Actual",
        point.tooltipLabel || point.label || "--",
        formatter(point.value)
      ];
      if (isForecast && Number.isFinite(point.lower_ci) && Number.isFinite(point.upper_ci)) {
        tooltipParts.push(`Range ${formatter(point.lower_ci)} to ${formatter(point.upper_ci)}`);
      }
      const tooltipText = tooltipParts.join(" | ");
      return `
        <circle
          class="forecast-point ${isForecast ? "is-projected" : "is-actual"} ${type === "headcount" ? "is-headcount" : ""}"
          cx="${point.x.toFixed(1)}"
          cy="${point.y.toFixed(1)}"
          r="${type === "headcount" ? "4.8" : "4.6"}"
          data-tooltip="${escapeHtml(tooltipText)}"
        >
          <title>${escapeHtml(tooltipText)}</title>
        </circle>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="forecast-chart-shell ${type === "headcount" ? "is-headcount" : ""}">
      <div class="forecast-chart-inner">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="${escapeHtml(ariaLabel)}">
          ${gridLines}
          ${actualArea ? `<path class="forecast-actual-area ${type === "headcount" ? "is-headcount" : ""}" d="${actualArea}"></path>` : ""}
          ${confidenceBandPath ? `<path class="forecast-confidence-band ${type === "headcount" ? "is-headcount" : ""}" d="${confidenceBandPath}"></path>` : ""}
          ${dividerX ? `<line class="forecast-start-line" x1="${dividerX.toFixed(1)}" y1="${paddingY}" x2="${dividerX.toFixed(1)}" y2="${baselineY.toFixed(1)}"></line>` : ""}
          ${dividerX ? `<text class="forecast-start-label" x="${Math.min(width - 120, dividerX + 8).toFixed(1)}" y="${(paddingY + 12).toFixed(1)}">Forecast start</text>` : ""}
          ${actualPath ? `<path class="forecast-line is-actual ${type === "headcount" ? "is-headcount" : ""}" d="${actualPath}"></path>` : ""}
          ${forecastPath ? `<path class="forecast-line is-projected ${type === "headcount" ? "is-headcount" : ""}" d="${forecastPath}"></path>` : ""}
          ${points}
        </svg>
        <div class="forecast-chart-tooltip" hidden></div>
      </div>
      <div class="forecast-chart-axis">
        ${axisLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
      </div>
    </div>
  `;
  container.classList.remove("skeleton-block");
  bindForecastTooltip(containerId);
}

/**
 * Combines dashboard, finance-row, and forecast payloads into one render model.
 *
 * @param {Record<string, any>} payload
 * @returns {Record<string, any>}
 */
function buildForecastViewModel(payload) {
  const dashboardPayload = latestDashboardPayload || {};
  const financeAnalytics = buildFinanceAnalytics(latestFinanceRowsState.rows);
  const spendHistoryAll = buildDailySpendHistory(latestFinanceRowsState.rows);
  const spendActualSeries = buildSpendActualWindow(spendHistoryAll, forecastViewState.horizonDays);
  const spendForecastAll = normalizeSpendForecastSeries(payload?.expenditure_forecast || payload?.revenue_forecast || []);
  const spendForecast = spendForecastAll.slice(0, forecastViewState.horizonDays);
  const monthProjection = calculateMonthEndProjection(spendHistoryAll, spendForecastAll);
  const headcountForecastAll = normalizeHeadcountForecastSeries(payload?.employee_growth_forecast || []);
  const currentHeadcount = Number(dashboardPayload?.metrics?.total_employees?.value)
    || Number(getLastItem(headcountForecastAll)?.value)
    || 0;
  const headcountActualSeries = buildHeadcountActualSeries(dashboardPayload, currentHeadcount);
  const headcountForecast = headcountForecastAll.slice(0, forecastViewState.horizonDays);
  const projectedHeadcount = Number(getLastItem(headcountForecast)?.value ?? getLastItem(headcountForecastAll)?.value ?? currentHeadcount);
  const headcountIncrease = Number.isFinite(projectedHeadcount) ? projectedHeadcount - currentHeadcount : null;
  const peakProjectedHeadcount = Math.max(
    currentHeadcount || 0,
    ...headcountForecast.map((point) => Number(point.value) || 0)
  );
  const confidence = deriveForecastConfidence(dashboardPayload, spendForecastAll, headcountForecastAll);
  const risk = deriveForecastRisk({
    projectedVsLastMonth: monthProjection.projectedVsLastMonth,
    unusualExpenseCount: financeAnalytics.unusualExpenses.length,
    confidenceScore: confidence.score,
    headcountChange: headcountIncrease
  });
  const summaryCards = buildForecastSummaryCards({
    monthProjection,
    projectedHeadcount,
    headcountIncrease,
    risk,
    confidence,
    selectedHorizon: forecastViewState.horizonDays,
    spendWindowDays: spendActualSeries.length
  });
  const highlights = prioritizeForecastNotes(buildForecastHighlights({
    monthProjection,
    selectedHorizon: forecastViewState.horizonDays,
    headcountIncrease,
    projectedHeadcount,
    currentHeadcount,
    risk,
    confidence,
    financeAnalytics
  }), forecastViewState.focus, 4);
  const risks = prioritizeForecastNotes(buildForecastRisks({
    monthProjection,
    headcountIncrease,
    risk,
    confidence,
    financeAnalytics
  }), forecastViewState.focus, 4);
  const actions = prioritizeForecastNotes(buildForecastActions({
    headcountIncrease,
    confidence,
    financeAnalytics,
    dashboardPayload
  }), forecastViewState.focus, 4);
  const headcountStats = [
    {
      label: "Current Headcount",
      value: formatCount(currentHeadcount),
      subtitle: "Latest reported employee count."
    },
    {
      label: `Projected in ${forecastViewState.horizonDays} Days`,
      value: formatCount(projectedHeadcount),
      subtitle: "Expected by the end of the selected window."
    },
    {
      label: "Expected Increase",
      value: Number.isFinite(headcountIncrease) ? formatSignedCount(headcountIncrease) : "--",
      subtitle: "Change from the current reported headcount."
    },
    {
      label: "Peak Projected Headcount",
      value: formatCount(peakProjectedHeadcount),
      subtitle: "Highest expected point in the current outlook."
    }
  ];
  const generatedText = payload?.generated_at
    ? `Predictions generated ${formatBusinessDateTime(payload.generated_at)}`
    : "No prediction file available yet.";
  const trustRows = [
    {
      label: "Forecast confidence",
      value: Number.isFinite(confidence.score) ? `${confidence.score}% · ${confidence.label}` : confidence.label,
      body: confidence.summary
    },
    {
      label: "Prediction generated",
      value: payload?.generated_at ? formatBusinessDateTime(payload.generated_at) : "Waiting for latest prediction",
      body: "Latest forecast refresh available to the page."
    },
    {
      label: "Last updated",
      value: formatBusinessDateTime(dashboardPayload?.sources?.latest_prediction_last_modified || latestFinanceRowsState.refreshedAt),
      body: "Most recent business data refresh feeding this page."
    },
    {
      label: "How to read this",
      value: "Recent spending and workforce trends",
      body: "Predictions are based on recent spending and workforce trends, with confidence ranges shown around forecast points."
    }
  ];

  return {
    generatedText,
    confidence,
    summaryCards,
    highlights,
    risks,
    actions,
    trustRows,
    spendActualSeries,
    spendForecast,
    headcountActualSeries,
    headcountForecast,
    headcountStats,
    departmentSummary: dashboardPayload?.charts?.department_distribution || [],
    spendSummaryText: spendForecast.length
      ? `Projected company spend based on recent trends. Showing ${spendForecast.length} forecast day${spendForecast.length === 1 ? "" : "s"} against the last ${spendActualSeries.length} days of actual spend.`
      : "Projected company spend based on recent trends will appear here when enough forecast data is available.",
    headcountSummaryText: headcountForecast.length
      ? FORECAST_TEXT.headcountProjection(currentHeadcount, projectedHeadcount, forecastViewState.horizonDays)
      : "Headcount projection will appear here when enough employee forecast data is available.",
    headcountChipText: headcountForecast.length
      ? `Forecast ${formatSignedCount(headcountIncrease)}`
      : "Awaiting outlook",
    headcountChipTone: Number.isFinite(headcountIncrease)
      ? headcountIncrease > 0
        ? "positive"
        : headcountIncrease < 0
          ? "warning"
          : "muted"
      : "muted",
    headcountSubtitle: headcountForecast.length
      ? `Projected employee growth over the next ${forecastViewState.horizonDays} days.`
      : "Projected employee growth based on recent workforce trends.",
    currentHeadcount
  };
}

/**
 * Renders the complete forecasts page from the latest forecast payload.
 *
 * @param {Record<string, any>} payload
 */
function renderForecasts(payload) {
  syncForecastControls();
  const model = buildForecastViewModel(payload || {});
  const meta = getElement("forecast-generated-at");
  const trustChip = getElement("forecast-trust-chip");
  const spendSummary = getElement("forecast-spend-summary");
  const highlightsTitle = getElement("forecast-highlights-title");
  const headcountSubtitle = getElement("forecast-headcount-subtitle");
  const headcountChip = getElement("forecast-headcount-chip");
  const headcountSummary = getElement("forecast-headcount-summary-text");

  if (meta) {
    meta.textContent = model.generatedText;
  }
  if (trustChip) {
    trustChip.textContent = `${model.confidence.label} confidence`;
    trustChip.dataset.tone = model.confidence.tone;
  }
  if (spendSummary) {
    spendSummary.textContent = model.spendSummaryText;
  }
  if (highlightsTitle) {
    highlightsTitle.textContent = forecastViewState.focus === "spend"
      ? "Spend Highlights"
      : forecastViewState.focus === "headcount"
        ? "Headcount Highlights"
        : "Forecast Highlights";
  }
  if (headcountSubtitle) {
    headcountSubtitle.textContent = model.headcountSubtitle;
  }
  if (headcountChip) {
    headcountChip.textContent = model.headcountChipText;
    headcountChip.dataset.tone = model.headcountChipTone;
  }
  if (headcountSummary) {
    headcountSummary.textContent = model.headcountSummaryText;
  }

  renderForecastSummaryCards(model.summaryCards);
  renderForecastNotes(
    "forecast-highlights-list",
    model.highlights,
    "Waiting for forecast highlights",
    "Plain-English highlights will appear here once enough spend and workforce data are available."
  );
  renderForecastTrustRows(model.trustRows);
  renderForecastTrendChart({
    containerId: "forecast-spend-chart",
    actualSeries: model.spendActualSeries,
    forecastSeries: model.spendForecast,
    formatter: (value) => formatCurrency(value),
    emptyTitle: "Spend forecast unavailable",
    emptyBody: "We need recent spend history and a fresh forecast run before the spend outlook can be shown.",
    ariaLabel: "Spend forecast chart",
    type: "spend"
  });
  renderHeadcountStatCards(model.headcountStats);
  renderForecastTrendChart({
    containerId: "forecast-headcount-chart",
    actualSeries: model.headcountActualSeries,
    forecastSeries: model.headcountForecast,
    formatter: (value) => formatCount(value),
    emptyTitle: "Headcount forecast unavailable",
    emptyBody: "We need recent employee history and a fresh forecast run before the workforce outlook can be shown.",
    ariaLabel: "Headcount forecast chart",
    type: "headcount"
  });
  renderForecastDepartmentSummary(model.departmentSummary);
  renderForecastNotes(
    "forecast-risks-list",
    model.risks,
    "No planning risks highlighted yet",
    "Potential risks will appear here once enough forecast data is available."
  );
  renderForecastNotes(
    "forecast-actions-list",
    model.actions,
    "No recommended actions yet",
    "Recommended actions will appear here once enough forecast data is available."
  );
}

/**
 * Syncs horizon and focus toggle button state with the view model.
 */
function syncForecastControls() {
  document.querySelectorAll("[data-forecast-horizon]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.forecastHorizon) === forecastViewState.horizonDays);
  });

  document.querySelectorAll("[data-forecast-focus]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.forecastFocus === forecastViewState.focus);
  });
}

/**
 * Binds the forecast horizon and focus segmented controls once.
 */
function initializeForecastControls() {
  const horizonControl = getElement("forecast-horizon-control");
  const focusControl = getElement("forecast-focus-control");

  if (horizonControl && horizonControl.dataset.bound !== "true") {
    horizonControl.dataset.bound = "true";
    horizonControl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-forecast-horizon]");
      if (!button) {
        return;
      }

      forecastViewState.horizonDays = Number(button.dataset.forecastHorizon) || DEFAULT_FORECAST_HORIZON_DAYS;
      syncForecastControls();
      if (latestForecastPayload) {
        renderForecasts(latestForecastPayload);
      }
    });
  }

  if (focusControl && focusControl.dataset.bound !== "true") {
    focusControl.dataset.bound = "true";
    focusControl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-forecast-focus]");
      if (!button) {
        return;
      }

      forecastViewState.focus = button.dataset.forecastFocus || "all";
      syncForecastControls();
      if (latestForecastPayload) {
        renderForecasts(latestForecastPayload);
      }
    });
  }

  syncForecastControls();
}

/**
 * Fetches and renders the dashboard payload.
 *
 * @param {() => string} getAuthToken
 * @returns {Promise<void>}
 */
async function refreshDashboard(getAuthToken) {
  const payload = await getJSON("/dashboard", undefined, getAuthToken);
  latestDashboardPayload = payload || {};
  renderDashboard(payload);
  if (latestForecastPayload) {
    renderForecasts(latestForecastPayload);
  }
}

/**
 * Fetches and renders the forecast payload.
 *
 * @param {() => string} getAuthToken
 * @returns {Promise<void>}
 */
async function refreshForecasts(getAuthToken) {
  const payload = await getJSON("/forecasts", undefined, getAuthToken);
  latestForecastPayload = payload || {};
  renderForecasts(latestForecastPayload);
}

/**
 * Initializes dashboard, forecast, query, and graph rendering for the workspace.
 *
 * @param {{ getAuthToken?: () => string }} [options={}]
 * @returns {() => void}
 */
export function initInsightsData({ getAuthToken = () => "" } = {}) {
  const queryButton = getElement("query-run-btn");
  const handleFinanceRowsUpdated = (event) => {
    latestFinanceRowsState = event?.detail || latestFinanceRowsState;
    if (latestDashboardPayload) {
      renderDashboard(latestDashboardPayload);
    }
    if (latestForecastPayload) {
      renderForecasts(latestForecastPayload);
    }
  };
  const handlePreferencesUpdated = () => {
    if (latestDashboardPayload) {
      renderDashboard(latestDashboardPayload);
    }
    if (latestForecastPayload) {
      renderForecasts(latestForecastPayload);
    }
  };

  if (queryButton) {
    queryButton.addEventListener("click", () => {
      runQuery(getAuthToken);
    });
  }

  if (!API_BASE_URL) {
    const status = getElement("query-status");
    if (status) {
      status.textContent = "VITE_API_BASE_URL is missing.";
    }
    return () => {};
  }

  const refreshAll = async () => {
    await Promise.allSettled([refreshDashboard(getAuthToken), refreshForecasts(getAuthToken)]);
  };

  if (window.__smartstreamFinanceRowsState) {
    latestFinanceRowsState = window.__smartstreamFinanceRowsState;
  }
  window.addEventListener("smartstream:finance-rows-updated", handleFinanceRowsUpdated);
  window.addEventListener("smartstream:preferences-changed", handlePreferencesUpdated);
  initializeForecastControls();

  refreshAll();
  const timer = window.setInterval(refreshAll, 20000);

  void initializeQueryPage(getAuthToken);
  initializeCreateGraphPage();

  return () => {
    window.clearInterval(timer);
    window.removeEventListener("smartstream:finance-rows-updated", handleFinanceRowsUpdated);
    window.removeEventListener("smartstream:preferences-changed", handlePreferencesUpdated);
  };
}

