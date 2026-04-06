import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/opsApi.js", () => ({
  createOpsApi: () => ({
    getOverview: vi.fn().mockResolvedValue({
      data: {
        total_pipelines: 4,
        healthy: 2,
        degraded: 1,
        down: 1,
        active_alarms: 2,
        last_updated: "2026-03-01T10:00:00Z",
      },
      meta: {
        source: "live",
        partialData: false,
        warnings: [],
        generatedAt: "2026-03-01T10:00:00Z",
      },
    }),
    getPipelines: vi.fn().mockResolvedValue({
      data: [
        {
          id: "finance-pipeline",
          name: "Finance pipeline",
          overall_status: "degraded",
          source_status: "healthy",
          processing_status: "degraded",
          delivery_status: "healthy",
          freshness_status: "warning",
          last_success_at: "2026-03-01T09:43:00Z",
          alarm_count: 2,
          status_history: ["healthy", "degraded", "degraded", "warning"],
        },
        {
          id: "forecast-pipeline",
          name: "Forecast pipeline",
          overall_status: "healthy",
          source_status: "healthy",
          processing_status: "healthy",
          delivery_status: "healthy",
          freshness_status: "healthy",
          last_success_at: "2026-03-01T09:58:00Z",
          alarm_count: 0,
          status_history: ["healthy", "healthy", "healthy", "healthy"],
        },
      ],
      meta: {
        source: "live",
        partialData: false,
        warnings: [],
        generatedAt: "2026-03-01T10:00:00Z",
      },
    }),
    getAlarms: vi.fn().mockResolvedValue({
      data: [
        {
          id: "alarm-1",
          pipeline_id: "finance-pipeline",
          pipeline_name: "Finance pipeline",
          name: "FinanceFreshnessLag",
          severity: "high",
          summary: "Finance data is delayed.",
          resource: "s3://trusted/acme/finance/",
          triggered_at: "2026-03-01T09:55:00Z",
          state: "ALARM",
        },
      ],
      meta: {
        source: "live",
        partialData: false,
        warnings: [],
        generatedAt: "2026-03-01T10:00:00Z",
      },
    }),
    getLogSummary: vi.fn().mockResolvedValue({
      data: [
        {
          service: "forecast-ml-lambda",
          level: "ERROR",
          count_15m: 2,
          latest_message: "Inference duration spiked.",
          updated_at: "2026-03-01T09:57:00Z",
        },
      ],
      meta: {
        source: "live",
        partialData: false,
        warnings: [],
        generatedAt: "2026-03-01T10:00:00Z",
      },
    }),
    getPipelineDetails: vi.fn().mockResolvedValue({
      data: {
        id: "finance-pipeline",
        name: "Finance pipeline",
        overall_status: "degraded",
        summary: "Finance ingest is delayed but still recovering.",
        freshness: {
          status: "warning",
          lag_minutes: 16,
          target_minutes: 5,
          message: "Finance freshness is outside the target envelope.",
        },
        last_success_at: "2026-03-01T09:43:00Z",
        last_failure_at: "2026-03-01T09:55:00Z",
        components: [
          {
            name: "Transform Lambda",
            area: "Processing",
            status: "degraded",
            resource: "lambda:smartstream-transform",
            detail: "Retries increased after a schema drift.",
          },
        ],
        recent_errors: [
          {
            timestamp: "2026-03-01T09:55:00Z",
            service: "transform-lambda",
            summary: "Finance refresh retried after a schema drift.",
          },
        ],
        active_alarms: [
          {
            name: "FinanceFreshnessLag",
            severity: "high",
            triggered_at: "2026-03-01T09:55:00Z",
            resource: "s3://trusted/acme/finance/",
            summary: "Finance data is delayed.",
          },
        ],
        impacted_resources: ["lambda:smartstream-transform"],
      },
      meta: {
        source: "live",
        partialData: false,
        warnings: [],
        generatedAt: "2026-03-01T10:00:00Z",
      },
    }),
  }),
}));

async function flushPromises() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createMonitorApp", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `<div id="app"></div>`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders overview, pipeline rows, alarms, and details from the ops API", async () => {
    const { createMonitorApp } = await import("../app.js");
    const rootElement = document.getElementById("app");
    const app = createMonitorApp(rootElement);
    await flushPromises();

    expect(rootElement.textContent).toContain("Pipeline monitor");
    expect(rootElement.textContent).toContain("Finance pipeline");
    expect(rootElement.textContent).toContain("Recent alarms");
    expect(rootElement.textContent).toContain("Live ops data");

    rootElement.querySelector('[data-action="open-details"]').click();
    await flushPromises();

    expect(rootElement.textContent).toContain("Pipeline details");
    expect(rootElement.textContent).toContain("Finance ingest is delayed but still recovering.");
    expect(rootElement.textContent).toContain("Transform Lambda");

    app.destroy();
  });
});
