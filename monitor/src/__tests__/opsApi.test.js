import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Creates a lightweight fetch response double that mirrors the part of the
 * Fetch API consumed by the JSON client.
 *
 * @param {object | string} payload
 * @param {{ ok?: boolean, status?: number }} [options]
 * @returns {{ ok: boolean, status: number, text: ReturnType<typeof vi.fn> }}
 */
function responseWithText(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue(typeof payload === "string" ? payload : JSON.stringify(payload)),
  };
}

describe("createOpsApi", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes live partial-data envelopes from the ops API", async () => {
    vi.stubEnv("VITE_MONITOR_API_BASE_URL", "https://monitor.example.com");
    global.fetch = vi.fn().mockResolvedValue(
      responseWithText({
        data: {
          total_pipelines: 4,
          healthy: 2,
          degraded: 1,
          down: 1,
          active_alarms: 2,
          last_updated: "2026-03-01T10:00:00Z",
        },
        meta: {
          partial_data: true,
          warnings: ["CloudWatch Logs unavailable for /aws/lambda/smartstream-dev-ml"],
          generated_at: "2026-03-01T10:00:00Z",
        },
      })
    );

    const { createOpsApi } = await import("../api/opsApi.js");
    const api = createOpsApi();
    const result = await api.getOverview();

    expect(result.data.total_pipelines).toBe(4);
    expect(result.meta.source).toBe("partial");
    expect(result.meta.partialData).toBe(true);
    expect(result.meta.fallbackReason).toContain("CloudWatch Logs unavailable");
  });

  it("falls back to mock data when the live API is unavailable", async () => {
    vi.stubEnv("VITE_MONITOR_API_BASE_URL", "https://monitor.example.com");
    global.fetch = vi.fn().mockResolvedValue(
      responseWithText({ message: "Service unavailable" }, { ok: false, status: 503 })
    );

    const { createOpsApi } = await import("../api/opsApi.js");
    const api = createOpsApi();
    const result = await api.getAlarms();

    expect(result.meta.source).toBe("mock");
    expect(result.meta.fallbackReason).toContain("Service unavailable");
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
  });
});
