import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Builds a successful mocked JSON response.
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
 * Waits for the async work started by the refresh cycle.
 */
async function flushPromises() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("startLiveUpdates", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    document.body.innerHTML = `
      <div id="dashboard-spend-filters"></div>
      <div id="chart"></div>
      <div id="meta"></div>
      <div id="status"></div>
    `;
  });

  afterEach(() => {
    delete window.__smartstreamFinanceRowsState;
    vi.restoreAllMocks();
  });

  it("requests both type and category columns so expense rows stay classifiable", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");

    const discoveryColumns = [
      "transaction_date",
      "amount",
      "category",
      "type",
      "vendor",
      "department",
    ];

    globalThis.fetch = vi.fn((url, options) => {
      const body = JSON.parse(String(options?.body || "{}"));

      if (body.limit === 1) {
        return Promise.resolve(
          jsonResponse({
            columns: discoveryColumns,
            rows: [],
            row_count: 0,
          })
        );
      }

      return Promise.resolve(
        jsonResponse({
          columns: discoveryColumns,
          rows: [
            {
              transaction_date: "2026-03-03",
              amount: 700,
              category: "Payroll",
              type: "expense",
              vendor: "Acme Payroll",
              department: "Finance",
            },
          ],
          row_count: 1,
        })
      );
    });

    const { startLiveUpdates } = await import("../liveUpdates.js");
    const stop = startLiveUpdates({
      chartElement: document.getElementById("chart"),
      metaElement: document.getElementById("meta"),
      statusElement: document.getElementById("status"),
      pollIntervalMs: 60000,
      getAuthToken: () => "token-123",
    });

    await flushPromises();

    const financeQuery = JSON.parse(String(globalThis.fetch.mock.calls[1][1].body));
    expect(financeQuery.query).toContain('"category"');
    expect(financeQuery.query).toContain('"type"');

    stop();
  });
});
