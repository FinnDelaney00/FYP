import { buildAreaPath, buildSmoothLinePath, pickSeriesAxisLabels } from "./chartUtils.js";
import { createElementCache } from "./domCache.js";
import {
  buildFinanceAnalytics,
  getEmployeeMetrics,
  getLargestDepartment,
  getMonthlySpendMetrics
} from "./financeAnalytics.js";
import {
  escapeHtml,
  formatCompactCurrency,
  formatCurrency,
  formatDateLabel,
  formatWholePercent,
  formatBusinessDateTime
} from "./formatters.js";

function clearLoadingClasses(element) {
  if (!element) {
    return;
  }
  element.classList.remove("skeleton", "skeleton-value", "skeleton-line");
}

export function createDashboardModule({ getLatestFinanceRowsState }) {
  const getElement = createElementCache();

  function setMetric(id, value, subtitle) {
    const valueElement = getElement(`${id}-value`);
    const subtitleElement = getElement(`${id}-subtitle`);
    if (valueElement) {
      clearLoadingClasses(valueElement);
      valueElement.textContent = value;
    }
    if (subtitleElement) {
      clearLoadingClasses(subtitleElement);
      subtitleElement.textContent = subtitle;
    }
  }

  function setMetricTrend(id, value, tone = "neutral") {
    const trendElement = getElement(`${id}-trend`);
    if (!trendElement) {
      return;
    }

    trendElement.textContent = value;
    trendElement.dataset.tone = tone;
  }

  function renderEmployeeGrowth(series) {
    const container = getElement("employee-growth-chart");
    if (!container) {
      return;
    }

    if (!Array.isArray(series) || series.length === 0) {
      container.innerHTML = `
        <svg viewBox="0 0 520 220" preserveAspectRatio="none" aria-label="Employee growth line chart">
          <polyline class="line-fill" points="20,210 500,210 500,210 20,210"></polyline>
          <polyline class="line-stroke" points="20,210 500,210"></polyline>
        </svg>
        <div class="x-axis"><span>--</span><span>--</span><span>--</span><span>--</span><span>--</span><span>--</span></div>
      `;
      return;
    }

    const width = 520;
    const height = 220;
    const paddingX = 20;
    const paddingY = 15;
    const values = series.map((point) => Number(point.value) || 0);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const spread = maxValue - minValue;
    const domainPadding = spread > 0 ? spread * 0.2 : Math.max(Math.abs(maxValue) * 0.15, 1);
    const domainMin = minValue - domainPadding;
    const domainMax = maxValue + domainPadding;
    const range = Math.max(1, domainMax - domainMin);
    const baselineY = height - paddingY;

    const coords = series.map((point, index) => {
      const x =
        series.length === 1
          ? width / 2
          : paddingX + (index / (series.length - 1)) * (width - paddingX * 2);
      const y = paddingY + ((domainMax - (Number(point.value) || 0)) / range) * (height - paddingY * 2);
      return { x, y };
    });

    const linePath = buildSmoothLinePath(coords);
    const areaPath = buildAreaPath(coords, baselineY, linePath);
    const labels = pickSeriesAxisLabels(series, 6, ["label"]);
    const gridLines = [0.2, 0.4, 0.6, 0.8]
      .map((position) => {
        const y = (paddingY + (height - paddingY * 2) * position).toFixed(1);
        return `<line class="line-grid-line" x1="${paddingX}" y1="${y}" x2="${width - paddingX}" y2="${y}"></line>`;
      })
      .join("");
    const dots = coords
      .map((point, index) => {
        const forecastClass = series[index]?.is_forecast ? " is-forecast" : "";
        return `<circle class="line-point${forecastClass}" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.8"></circle>`;
      })
      .join("");

    container.innerHTML = `
      <svg viewBox="0 0 520 220" preserveAspectRatio="none" aria-label="Employee growth line chart">
        ${gridLines}
        <path class="line-fill" d="${areaPath}"></path>
        <path class="line-stroke" d="${linePath}"></path>
        ${dots}
      </svg>
      <div class="x-axis">
        ${labels.map((label) => `<span>${label}</span>`).join("")}
      </div>
    `;
  }

  function renderDepartmentDistribution(items) {
    const donut = getElement("department-donut");
    const list = getElement("department-list");
    if (!donut || !list) {
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      donut.style.background = "conic-gradient(#94a3b8 0 100%)";
      list.innerHTML = "<li><span class=\"dot\" style=\"background:#94a3b8\"></span>No department data found</li>";
      return;
    }

    const colors = ["#2563eb", "#7c3aed", "#e11d48", "#0ea5e9", "#0f766e", "#f59e0b"];
    const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0) || 1;
    let offset = 0;

    const gradientStops = items
      .map((item, index) => {
        const value = Number(item.value) || 0;
        const pct = (value / total) * 100;
        const color = colors[index % colors.length];
        const start = offset;
        const end = offset + pct;
        offset = end;
        return `${color} ${start}% ${end}%`;
      })
      .join(", ");

    donut.style.background = `conic-gradient(${gradientStops})`;

    list.innerHTML = items
      .map((item, index) => {
        const value = Number(item.value) || 0;
        const pct = ((value / total) * 100).toFixed(1);
        const color = colors[index % colors.length];
        return `<li><span class="dot" style="background:${color}"></span>${item.label} (${pct}%)</li>`;
      })
      .join("");
  }

  function renderBreakdownList(containerId, items, emptyMessage) {
    const container = getElement(containerId);
    if (!container) {
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      container.innerHTML = `<div class="breakdown-empty">${emptyMessage}</div>`;
      return;
    }

    const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0) || 1;
    const max = Math.max(1, ...items.map((item) => Number(item.value) || 0));

    container.innerHTML = items
      .map((item) => {
        const value = Number(item.value) || 0;
        const width = Math.max(8, Math.round((value / max) * 100));
        const share = ((value / total) * 100).toFixed(1);
        return `
          <div class="breakdown-row" title="${escapeHtml(item.label)}: ${formatCurrency(value)}">
            <div class="breakdown-copy">
              <strong>${escapeHtml(item.label)}</strong>
              <span>${share}% of tracked spend</span>
            </div>
            <div class="breakdown-bar">
              <i style="--w:${width}"></i>
            </div>
            <div class="breakdown-value">${formatCompactCurrency(value)}</div>
          </div>
        `;
      })
      .join("");
  }

  function renderRecurringBreakdown(recurringSpend, oneOffSpend) {
    const container = getElement("recurring-breakdown");
    if (!container) {
      return;
    }

    const total = recurringSpend + oneOffSpend;
    if (!total) {
      container.innerHTML = "<div class=\"breakdown-empty\">Not enough merchant detail is available yet to separate repeat spend.</div>";
      return;
    }

    const recurringShare = (recurringSpend / total) * 100;
    const oneOffShare = 100 - recurringShare;
    container.innerHTML = `
      <div class="split-bar" aria-hidden="true">
        <i class="split-bar-recurring" style="--w:${recurringShare.toFixed(1)}"></i>
        <i class="split-bar-oneoff" style="--w:${oneOffShare.toFixed(1)}"></i>
      </div>
      <div class="split-summary-grid">
        <div class="split-summary-card">
          <span>Recurring spend</span>
          <strong>${formatCurrency(recurringSpend)}</strong>
          <p>${recurringShare.toFixed(1)}% of tracked spend</p>
        </div>
        <div class="split-summary-card">
          <span>One-off spend</span>
          <strong>${formatCurrency(oneOffSpend)}</strong>
          <p>${oneOffShare.toFixed(1)}% of tracked spend</p>
        </div>
      </div>
    `;
  }

  function renderAlerts(items) {
    const container = getElement("alerts-list");
    if (!container) {
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      container.innerHTML = `
        <article class="alert-item is-neutral">
          <div>
            <h4>No unusual payments stand out right now</h4>
            <p>Recent spend is moving within the normal range of your tracked transactions.</p>
          </div>
          <span>Stable</span>
        </article>
      `;
      return;
    }

    container.innerHTML = items
      .map((item) => {
        const vendor = item.vendor || item.category || "Unlabelled vendor";
        const when = item.date ? formatDateLabel(item.date) : "Recent";
        return `
          <article class="alert-item is-warning">
            <div>
              <h4>${escapeHtml(vendor)} needs review</h4>
              <p>${formatCurrency(item.amount)} posted on ${when}, which is above your recent spending pattern.</p>
            </div>
            <span>Review</span>
          </article>
        `;
      })
      .join("");
  }

  function renderKeyInsights(insights) {
    const container = getElement("key-insights-list");
    if (!container) {
      return;
    }

    if (!Array.isArray(insights) || insights.length === 0) {
      container.innerHTML = `
        <article class="insight-item">
          <h4>Waiting for enough data</h4>
          <p>The dashboard will surface plain-English highlights as soon as recent spend and headcount data are available.</p>
        </article>
      `;
      return;
    }

    container.innerHTML = insights
      .map((insight) => `
        <article class="insight-item">
          <h4>${escapeHtml(insight.title)}</h4>
          <p>${escapeHtml(insight.body)}</p>
        </article>
      `)
      .join("");
  }

  function buildKeyInsights({ spendMetrics, employeeMetrics, largestDepartment, financeAnalytics }) {
    const insights = [];

    if (Number.isFinite(spendMetrics.spendChangePercent)) {
      insights.push({
        title: "Spend movement",
        body: `Company spend is ${formatWholePercent(spendMetrics.spendChangePercent)} versus last month.`
      });
    } else if (spendMetrics.currentSpend > 0) {
      insights.push({
        title: "Spend this month",
        body: `Tracked company spend is currently ${formatCurrency(spendMetrics.currentSpend)} this month.`
      });
    }

    if (largestDepartment) {
      insights.push({
        title: "Largest team",
        body: `${largestDepartment.label} remains your largest department by headcount.`
      });
    }

    if (financeAnalytics.unusualExpenses.length) {
      insights.push({
        title: "Costs to review",
        body: `${financeAnalytics.unusualExpenses.length} payment${financeAnalytics.unusualExpenses.length === 1 ? "" : "s"} stand out from the recent spending pattern.`
      });
    } else if (employeeMetrics.growthCount > 0) {
      insights.push({
        title: "Hiring pace",
        body: `Headcount increased by ${employeeMetrics.growthCount} in the latest reported period.`
      });
    } else if (Number.isFinite(employeeMetrics.projectedGrowthPercent)) {
      insights.push({
        title: "Workforce outlook",
        body: `The forecast points to ${formatWholePercent(employeeMetrics.projectedGrowthPercent)} employee growth across the current outlook window.`
      });
    }

    return insights.slice(0, 3);
  }

  function renderDashboard(payload) {
    const latestFinanceRowsState = getLatestFinanceRowsState();
    const metrics = payload.metrics || {};
    const charts = payload.charts || {};
    const spendMetrics = getMonthlySpendMetrics(charts.revenue_expenses || []);
    const employeeMetrics = getEmployeeMetrics(charts, metrics);
    const largestDepartment = getLargestDepartment(charts.department_distribution || []);
    const financeAnalytics = buildFinanceAnalytics(latestFinanceRowsState.rows);
    const dataHealth = metrics.data_health || {};
    const confidenceValue = Number(dataHealth.value_percent);
    const insights = buildKeyInsights({
      spendMetrics,
      employeeMetrics,
      largestDepartment,
      financeAnalytics
    });

    const spendDifference = spendMetrics.currentSpend - spendMetrics.previousSpend;
    const largestCategory = financeAnalytics.categoryBreakdown[0] || null;
    const unusualExpenseCount = financeAnalytics.unusualExpenses.length;
    const dashboardSummary = getElement("dashboard-summary");
    const lastUpdatedValue = getElement("dashboard-last-updated");
    const lastUpdatedSubtitle = getElement("dashboard-last-updated-subtitle");
    const confidenceMetric = getElement("dashboard-confidence-value");
    const confidenceSubtitle = getElement("dashboard-confidence-subtitle");
    const employeeGrowthSummary = getElement("employee-growth-summary");
    const departmentSummary = getElement("department-summary");

    if (dashboardSummary) {
      dashboardSummary.textContent = spendMetrics.currentSpend > 0
        ? `${formatCurrency(spendMetrics.currentSpend)} has been tracked this month while headcount sits at ${employeeMetrics.totalEmployees.toLocaleString()}.`
        : `Headcount sits at ${employeeMetrics.totalEmployees.toLocaleString()} while the dashboard gathers the latest spend detail.`;
    }

    if (lastUpdatedValue) {
      lastUpdatedValue.textContent = formatBusinessDateTime(payload.generated_at || latestFinanceRowsState.refreshedAt);
    }
    if (lastUpdatedSubtitle) {
      const latestSyncDetail = payload?.sources?.latest_prediction_last_modified || latestFinanceRowsState.refreshedAt;
      lastUpdatedSubtitle.textContent = latestSyncDetail
        ? `Last full dashboard refresh: ${formatBusinessDateTime(latestSyncDetail)}`
        : "Waiting for the first full refresh.";
    }
    if (confidenceMetric) {
      confidenceMetric.textContent = Number.isFinite(confidenceValue) ? `${Math.abs(confidenceValue).toFixed(0)}%` : "--";
    }
    if (confidenceSubtitle) {
      confidenceSubtitle.textContent = dataHealth.subtitle || "Confidence improves as more finance and employee rows are processed.";
    }

    const metricCards = [
      {
        id: "metric-total-spend",
        value: formatCurrency(spendMetrics.currentSpend),
        subtitle: spendMetrics.currentSpend > 0
          ? "Tracked spend so far this month."
          : "Waiting for enough finance history to total this month.",
        trend: {
          value: "Current month",
          tone: spendMetrics.currentSpend > 0 ? "neutral" : "muted"
        }
      },
      {
        id: "metric-spend-change",
        value: Number.isFinite(spendMetrics.spendChangePercent) ? formatWholePercent(spendMetrics.spendChangePercent) : "--",
        subtitle: Number.isFinite(spendMetrics.spendChangePercent)
          ? `${formatCurrency(Math.abs(spendDifference))} ${spendDifference >= 0 ? "more" : "less"} than last month.`
          : "A prior month comparison is not available yet.",
        trend: {
          value: Number.isFinite(spendMetrics.spendChangePercent)
            ? spendDifference > 0 ? "Higher spend" : spendDifference < 0 ? "Lower spend" : "Flat month"
            : "Waiting for history",
          tone: !Number.isFinite(spendMetrics.spendChangePercent)
            ? "muted"
            : spendDifference > 0
              ? "warning"
              : spendDifference < 0
                ? "positive"
                : "neutral"
        }
      },
      {
        id: "metric-total-employees",
        value: employeeMetrics.totalEmployees.toLocaleString(),
        subtitle: largestDepartment
          ? `${largestDepartment.label} is currently the largest department.`
          : "Department data will appear once employee records load.",
        trend: {
          value: Number.isFinite(employeeMetrics.totalEmployeeDelta)
            ? `${formatWholePercent(employeeMetrics.totalEmployeeDelta)} vs baseline`
            : "Latest headcount",
          tone: Number.isFinite(employeeMetrics.totalEmployeeDelta) && employeeMetrics.totalEmployeeDelta > 0 ? "positive" : "neutral"
        }
      },
      {
        id: "metric-employee-growth",
        value: employeeMetrics.growthCount === 0 ? "0" : `${employeeMetrics.growthCount > 0 ? "+" : "-"}${Math.abs(employeeMetrics.growthCount)}`,
        subtitle: employeeMetrics.growthCount === 0
          ? "No net headcount change in the latest reported period."
          : `${Math.abs(employeeMetrics.growthCount)} ${employeeMetrics.growthCount > 0 ? "new hires" : "fewer employees"} in the latest reported period.`,
        trend: {
          value: Number.isFinite(employeeMetrics.projectedGrowthPercent)
            ? `Forecast ${formatWholePercent(employeeMetrics.projectedGrowthPercent)}`
            : "Recent movement",
          tone: employeeMetrics.growthCount > 0 ? "positive" : employeeMetrics.growthCount < 0 ? "warning" : "neutral"
        }
      },
      {
        id: "metric-unusual-expenses",
        value: unusualExpenseCount.toLocaleString(),
        subtitle: unusualExpenseCount
          ? `${unusualExpenseCount} transaction${unusualExpenseCount === 1 ? "" : "s"} need review.`
          : "No unusual transactions are standing out right now.",
        trend: {
          value: unusualExpenseCount ? "Needs review" : "Normal range",
          tone: unusualExpenseCount ? "warning" : "positive"
        }
      },
      {
        id: "metric-largest-category",
        value: largestCategory ? largestCategory.label : "--",
        subtitle: largestCategory
          ? `${formatCurrency(largestCategory.value)} in recent tracked spend.`
          : "Category labels will appear when transaction tags are available.",
        trend: {
          value: largestCategory
            ? `${((largestCategory.value / (financeAnalytics.expenses.reduce((sum, row) => sum + row.amount, 0) || 1)) * 100).toFixed(1)}% share`
            : "Waiting for tags",
          tone: largestCategory ? "neutral" : "muted"
        }
      }
    ];

    metricCards.forEach((card) => {
      setMetric(card.id, card.value, card.subtitle);
      setMetricTrend(card.id, card.trend.value, card.trend.tone);
    });

    if (employeeGrowthSummary) {
      employeeGrowthSummary.textContent = employeeMetrics.growthCount > 0
        ? `${employeeMetrics.growthCount} more employees than the prior reported point.`
        : employeeMetrics.growthCount < 0
          ? `${Math.abs(employeeMetrics.growthCount)} fewer employees than the prior reported point.`
          : "Headcount has remained steady across the latest reported points.";
    }

    if (departmentSummary) {
      departmentSummary.textContent = largestDepartment
        ? `${largestDepartment.label} accounts for the largest share of current headcount.`
        : "Department mix will appear once employee records are available.";
    }

    renderEmployeeGrowth(charts.employee_growth || []);
    renderDepartmentDistribution(charts.department_distribution || []);
    renderBreakdownList("category-breakdown", financeAnalytics.categoryBreakdown, "Category tags are not available yet in the recent finance rows.");
    renderBreakdownList("vendor-breakdown", financeAnalytics.vendorBreakdown, "Vendor names are not available yet in the recent finance rows.");
    renderRecurringBreakdown(financeAnalytics.recurringSpend, financeAnalytics.oneOffSpend);
    renderBreakdownList("department-spend-breakdown", financeAnalytics.departmentBreakdown, "No department tags were found in the tracked spend yet.");
    renderKeyInsights(insights);
    renderAlerts(financeAnalytics.unusualExpenses);
  }

  return {
    renderDashboard
  };
}
