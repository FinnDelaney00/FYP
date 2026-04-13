import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These page-level modules are mocked so this suite can focus on orchestration.
vi.mock("../insights/queryModule.js", () => ({
  createQueryModule: () => ({
    runQuery: vi.fn(),
    initializeQueryPage: vi.fn(),
  }),
}));

vi.mock("../insights/graphModule.js", () => ({
  createGraphModule: () => ({
    initializeCreateGraphPage: vi.fn(),
  }),
}));

vi.mock("../insights/dashboardModule.js", () => ({
  createDashboardModule: () => ({
    renderDashboard: vi.fn(),
  }),
}));

/**
 * Creates a successful mocked JSON response for data-orchestration tests.
 *
 * @param {unknown} payload
 * @returns {{ ok: boolean, json: ReturnType<typeof vi.fn> }}
 */
function jsonResponse(payload) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(payload),
  };
}

/**
 * Waits for pending promises and microtasks triggered by module initialization.
 */
async function flushPromises() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Builds the minimal forecast-page DOM required by `initInsightsData`.
 */
function setupForecastDom() {
  document.body.innerHTML = `
    <div id="forecast-generated-at"></div>
    <div id="forecast-trust-chip"></div>
    <div id="forecast-spend-summary"></div>
    <div id="forecast-highlights-title"></div>
    <div id="forecast-headcount-subtitle"></div>
    <div id="forecast-headcount-chip"></div>
    <div id="forecast-headcount-summary-text"></div>
    <div id="forecast-summary-cards"></div>
    <div id="forecast-highlights-list"></div>
    <div id="forecast-trust-list"></div>
    <div id="forecast-spend-chart" class="skeleton-block"></div>
    <div id="forecast-headcount-summary"></div>
    <div id="forecast-headcount-chart" class="skeleton-block"></div>
    <div id="forecast-department-summary"></div>
    <div id="forecast-risks-list"></div>
    <div id="forecast-actions-list"></div>
    <div id="forecast-horizon-control">
      <button data-forecast-horizon="7" type="button">7</button>
      <button data-forecast-horizon="30" type="button">30</button>
    </div>
    <div id="forecast-focus-control">
      <button data-forecast-focus="all" type="button">All</button>
      <button data-forecast-focus="headcount" type="button">Headcount</button>
    </div>
  `;
}

describe("initInsightsData", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    setupForecastDom();
    window.__smartstreamFinanceRowsState = {
      refreshedAt: "2026-03-03T10:00:00Z",
      rows: [
        { transaction_date: "2026-03-01", amount: 600, type: "expense", category: "Payroll" },
        { transaction_date: "2026-03-02", amount: 650, type: "expense", category: "Payroll" },
        { transaction_date: "2026-03-03", amount: 700, type: "expense", category: "Payroll" },
      ],
    };
  });

  afterEach(() => {
    delete window.__smartstreamFinanceRowsState;
    vi.restoreAllMocks();
  });

  it("renders forecast cards and charts from mocked dashboard and forecast responses", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");
    globalThis.fetch = vi.fn((url) => {
      if (String(url).endsWith("/dashboard")) {
        return Promise.resolve(
          jsonResponse({
            metrics: {
              total_employees: { value: 12 },
              data_health: { value_percent: 92, subtitle: "prediction status ok, 20 rows processed" },
            },
            charts: {
              employee_growth: [
                { label: "Mar 01", value: 10, is_forecast: false },
                { label: "Mar 02", value: 12, is_forecast: false },
              ],
              department_distribution: [
                { label: "Finance", value: 5 },
                { label: "Operations", value: 4 },
              ],
            },
            sources: {
              latest_prediction_last_modified: "2026-03-03T09:55:00Z",
            },
          })
        );
      }

      return Promise.resolve(
        jsonResponse({
          generated_at: "2026-03-03T10:00:00Z",
          employee_growth_forecast: [
            {
              date: "2026-03-04",
              predicted_headcount: 13,
              lower_ci: 12,
              upper_ci: 14,
            },
            {
              date: "2026-03-05",
              predicted_headcount: 14,
              lower_ci: 13,
              upper_ci: 15,
            },
          ],
          expenditure_forecast: [
            {
              date: "2026-03-04",
              predicted_expenditure: 720,
              lower_ci: 680,
              upper_ci: 760,
            },
            {
              date: "2026-03-05",
              predicted_expenditure: 760,
              lower_ci: 720,
              upper_ci: 800,
            },
          ],
        })
      );
    });

    const { initInsightsData } = await import("../insightsData.js");
    const stop = initInsightsData({ getAuthToken: () => "token-123" });
    await flushPromises();

    expect(document.getElementById("forecast-generated-at").textContent).toContain("Predictions generated");
    expect(document.getElementById("forecast-trust-chip").textContent).toContain("confidence");
    expect(document.getElementById("forecast-summary-cards").textContent).toContain(
      "Projected Month-End Spend"
    );
    expect(document.getElementById("forecast-summary-cards").textContent).toContain(
      "Forecast Confidence"
    );
    expect(document.getElementById("forecast-spend-chart").innerHTML).toContain("Forecast start");

    document.querySelector('[data-forecast-focus="headcount"]').click();
    await flushPromises();
    expect(document.getElementById("forecast-highlights-title").textContent).toBe("Headcount Highlights");

    stop();
  });
});
