import { beforeEach, describe, expect, it } from "vitest";

import { createDashboardModule } from "../insights/dashboardModule.js";

function setupDashboardDom() {
  const metricIds = [
    "metric-total-spend",
    "metric-spend-change",
    "metric-total-employees",
    "metric-employee-growth",
    "metric-unusual-expenses",
    "metric-largest-category",
  ];

  document.body.innerHTML = `
    <div id="dashboard-summary"></div>
    <div id="dashboard-last-updated"></div>
    <div id="dashboard-last-updated-subtitle"></div>
    <div id="dashboard-confidence-value"></div>
    <div id="dashboard-confidence-subtitle"></div>
    ${metricIds
      .map(
        (id) => `
          <div id="${id}-value"></div>
          <div id="${id}-subtitle"></div>
          <div id="${id}-trend"></div>
        `
      )
      .join("")}
    <div id="employee-growth-summary"></div>
    <div id="department-summary"></div>
    <div id="employee-growth-chart"></div>
    <div id="department-donut"></div>
    <ul id="department-list"></ul>
    <div id="category-breakdown"></div>
    <div id="vendor-breakdown"></div>
    <div id="recurring-breakdown"></div>
    <div id="department-spend-breakdown"></div>
    <div id="key-insights-list"></div>
    <div id="alerts-list"></div>
  `;
}

describe("createDashboardModule", () => {
  beforeEach(() => {
    setupDashboardDom();
  });

  it("renders dashboard metrics, insights, and alert content from payload data", () => {
    const module = createDashboardModule({
      getLatestFinanceRowsState: () => ({
        refreshedAt: "2026-03-03T10:00:00Z",
        rows: [
          {
            transaction_date: "2026-03-01",
            amount: 1400,
            type: "expense",
            category: "Payroll",
            vendor: "Acme Payroll",
            department: "Finance",
          },
          {
            transaction_date: "2026-03-02",
            amount: 240,
            type: "expense",
            category: "Software",
            vendor: "CloudCo",
            department: "Operations",
          },
          {
            transaction_date: "2026-03-03",
            amount: 5200,
            type: "expense",
            category: "Payroll",
            vendor: "Acme Payroll",
            department: "Finance",
          },
        ],
      }),
    });

    module.renderDashboard({
      generated_at: "2026-03-03T10:00:00Z",
      sources: {
        latest_prediction_last_modified: "2026-03-03T09:55:00Z",
      },
      metrics: {
        total_employees: { value: 12, delta_percent: 20 },
        growth_rate: { value_percent: 8 },
        data_health: { value_percent: 88, subtitle: "prediction status ok, 20 rows processed" },
      },
      charts: {
        revenue_expenses: [
          { label: "Jan", revenue: 5000, expenditure: 2000 },
          { label: "Feb", revenue: 5600, expenditure: 2600 },
        ],
        employee_growth: [
          { label: "Feb 01", value: 10, is_forecast: false },
          { label: "Mar 01", value: 12, is_forecast: false },
          { label: "Mar 15", value: 13, is_forecast: true },
        ],
        department_distribution: [
          { label: "Finance", value: 5 },
          { label: "Operations", value: 4 },
          { label: "Sales", value: 3 },
        ],
      },
    });

    expect(document.getElementById("metric-total-spend-value").textContent).toBe("$2,600.00");
    expect(document.getElementById("metric-total-employees-value").textContent).toBe("12");
    expect(document.getElementById("dashboard-summary").textContent).toContain("headcount sits at 12");
    expect(document.getElementById("department-list").textContent).toContain("Finance");
    expect(document.getElementById("key-insights-list").textContent).toContain("Spend movement");
    expect(document.getElementById("alerts-list").textContent).toContain(
      "No unusual payments stand out right now"
    );
  });

  it("renders stable empty states when the payload has no chart or finance data", () => {
    const module = createDashboardModule({
      getLatestFinanceRowsState: () => ({
        refreshedAt: null,
        rows: [],
      }),
    });

    module.renderDashboard({
      metrics: {
        total_employees: { value: 0 },
        growth_rate: { value_percent: 0 },
        data_health: { value_percent: 0, subtitle: "No data yet." },
      },
      charts: {
        revenue_expenses: [],
        employee_growth: [],
        department_distribution: [],
      },
    });

    expect(document.getElementById("department-list").textContent).toContain("No department data found");
    expect(document.getElementById("alerts-list").textContent).toContain(
      "No unusual payments stand out right now"
    );
    expect(document.getElementById("key-insights-list").textContent).toContain("Workforce outlook");
  });
});
