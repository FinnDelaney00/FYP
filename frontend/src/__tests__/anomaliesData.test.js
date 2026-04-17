import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Builds a mocked JSON fetch response for anomaly page tests.
 *
 * @param {unknown} payload
 * @param {{ ok?: boolean, status?: number }} [options={}]
 * @returns {{ ok: boolean, status: number, json: ReturnType<typeof vi.fn> }}
 */
function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(payload),
  };
}

/**
 * Waits for pending promise work and DOM updates to finish.
 */
async function flushPromises() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Builds the smallest anomaly page DOM this test needs.
 */
function setupAnomaliesDom() {
  document.body.innerHTML = `
    <div id="anomaly-high-count"></div>
    <div id="anomaly-medium-count"></div>
    <div id="anomaly-low-count"></div>
    <div id="anomaly-reviewed-count"></div>
    <div id="anomaly-confirmed-count"></div>
    <form id="anomaly-filters-form"></form>
    <select id="anomaly-filter-type"></select>
    <select id="anomaly-filter-severity"></select>
    <select id="anomaly-filter-status"></select>
    <select id="anomaly-filter-entity"></select>
    <input id="anomaly-filter-date-from" />
    <input id="anomaly-filter-date-to" />
    <button id="anomaly-filter-reset" type="button">Reset</button>
    <div id="anomaly-filters-status"></div>
    <div id="anomaly-list"></div>
    <div id="anomaly-list-meta"></div>
    <section id="anomaly-detail-panel" class="is-hidden" data-selected-anomaly-id="">
      <button id="anomaly-detail-close" type="button">Close</button>
      <h2 id="anomaly-detail-title"></h2>
      <div id="anomaly-detail-subtitle"></div>
      <div id="anomaly-detail-meta"></div>
      <div id="anomaly-detail-description"></div>
      <div id="anomaly-detail-metrics"></div>
      <ul id="anomaly-detail-reasons"></ul>
      <pre id="anomaly-detail-record"></pre>
      <pre id="anomaly-detail-duplicates"></pre>
      <div id="anomaly-detail-suggested-action"></div>
      <textarea id="anomaly-action-note"></textarea>
      <button type="button" data-anomaly-action="mark_reviewed">Review</button>
      <button type="button" data-anomaly-action="mark_confirmed">Confirm</button>
      <div id="anomaly-detail-audit"></div>
    </section>
  `;
}

// Main anomaly test data reused across detail and action tests.
const baseAnomaly = {
  anomaly_id: "a-1",
  title: "Large spend detected",
  description: "Expense outlier",
  severity: "high",
  status: "new",
  entity_type: "transaction",
  anomaly_type: "transaction_amount_outlier",
  detected_at: "2026-03-01T09:55:00Z",
  reasons: ["Outlier amount"],
  metrics: {
    actual_value: 5200,
    expected_value: 900,
    percent_deviation: 477.8,
  },
  details: {
    transaction: {
      transaction_id: "txn-1",
    },
  },
  audit_trail: [],
};

describe("initAnomaliesData", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    setupAnomaliesDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders anomaly detail and processes action updates", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [baseAnomaly],
          summary: {
            high_priority_count: 1,
            medium_priority_count: 0,
            low_priority_count: 0,
            reviewed_count: 0,
            confirmed_count: 0,
          },
          last_modified: "2026-03-01T10:00:00Z",
        })
      )
      .mockResolvedValueOnce(jsonResponse({ item: baseAnomaly }))
      .mockResolvedValueOnce(
        jsonResponse({
          item: {
            ...baseAnomaly,
            status: "confirmed",
            audit_trail: [
              {
                action: "mark_confirmed",
                actor: "Integration User",
                at: "2026-03-01T10:05:00Z",
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ ...baseAnomaly, status: "confirmed" }],
          summary: {
            high_priority_count: 1,
            medium_priority_count: 0,
            low_priority_count: 0,
            reviewed_count: 1,
            confirmed_count: 1,
          },
          last_modified: "2026-03-01T10:05:00Z",
        })
      );

    const { initAnomaliesData } = await import("../anomaliesData.js");
    const stop = initAnomaliesData({ getAuthToken: () => "token-123" });
    await flushPromises();

    expect(document.getElementById("anomaly-list-meta").textContent).toBe("1 anomalies shown.");

    document.querySelector('[data-anomaly-open="a-1"]').click();
    await flushPromises();
    expect(document.getElementById("anomaly-detail-title").textContent).toBe("Large spend detected");

    document.querySelector('[data-anomaly-quick-action="mark_confirmed"]').click();
    await flushPromises();
    await flushPromises();

    expect(document.getElementById("anomaly-list-meta").textContent).toBe("1 anomalies shown.");
    expect(document.getElementById("anomaly-detail-audit").textContent.toLowerCase()).toContain(
      "mark confirmed"
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.example.com/anomalies/a-1/actions",
      expect.objectContaining({ method: "POST" })
    );

    stop();
  });

  it("renders the empty state when the API returns no anomalies", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        items: [],
        summary: {},
        last_modified: null,
      })
    );

    const { initAnomaliesData } = await import("../anomaliesData.js");
    const stop = initAnomaliesData({ getAuthToken: () => "token-123" });
    await flushPromises();

    expect(document.getElementById("anomaly-list").textContent).toContain(
      "No anomalies match your current filter selection."
    );
    expect(document.getElementById("anomaly-list-meta").textContent).toBe("0 anomalies shown.");

    stop();
  });
});
