import { createJsonClient } from "./client.js";
import {
  getMockAlarms,
  getMockLogSummary,
  getMockOverview,
  getMockPipelineDetails,
  getMockPipelines
} from "../mock/opsData.js";

export function createOpsApi() {
  const client = createJsonClient({
    baseUrl: import.meta.env.VITE_MONITOR_API_BASE_URL ?? ""
  });
  const useMockOnly = String(import.meta.env.VITE_MONITOR_USE_MOCK ?? "")
    .trim()
    .toLowerCase() === "true";

  return {
    getOverview: () => requestWithFallback("/ops/overview", getMockOverview),
    getPipelines: () => requestWithFallback("/ops/pipelines", getMockPipelines),
    getPipelineDetails: (pipelineId) =>
      requestWithFallback(`/ops/pipelines/${encodeURIComponent(pipelineId)}`, () =>
        getMockPipelineDetails(pipelineId)
      ),
    getAlarms: () => requestWithFallback("/ops/alarms", getMockAlarms),
    getLogSummary: () => requestWithFallback("/ops/log-summary", getMockLogSummary)
  };

  async function requestWithFallback(path, fallbackFactory) {
    if (useMockOnly) {
      return {
        data: fallbackFactory(),
        meta: {
          source: "mock",
          fallbackReason: "Mock mode forced by VITE_MONITOR_USE_MOCK."
        }
      };
    }

    if (!client.baseUrl) {
      return {
        data: fallbackFactory(),
        meta: {
          source: "mock",
          fallbackReason: "VITE_MONITOR_API_BASE_URL is not configured."
        }
      };
    }

    try {
      return {
        data: await client.get(path),
        meta: {
          source: "live",
          fallbackReason: ""
        }
      };
    } catch (error) {
      return {
        data: fallbackFactory(),
        meta: {
          source: "mock",
          fallbackReason: error instanceof Error ? error.message : "Live request failed."
        }
      };
    }
  }
}
