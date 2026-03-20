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
      const fallbackData = fallbackFactory();
      return {
        data: fallbackData,
        meta: {
          source: "mock",
          fallbackReason: "Mock mode forced by VITE_MONITOR_USE_MOCK.",
          partialData: false,
          warnings: [],
          generatedAt: fallbackData?.last_updated ?? null
        }
      };
    }

    if (!client.baseUrl) {
      const fallbackData = fallbackFactory();
      return {
        data: fallbackData,
        meta: {
          source: "mock",
          fallbackReason: "VITE_MONITOR_API_BASE_URL is not configured.",
          partialData: false,
          warnings: [],
          generatedAt: fallbackData?.last_updated ?? null
        }
      };
    }

    try {
      const payload = await client.get(path);
      const normalized = normalizeEnvelope(payload);
      const warnings = Array.isArray(normalized.meta?.warnings) ? normalized.meta.warnings : [];

      return {
        data: normalized.data,
        meta: {
          source: normalized.meta?.partial_data ? "partial" : "live",
          fallbackReason: warnings[0] ?? "",
          partialData: Boolean(normalized.meta?.partial_data),
          warnings,
          generatedAt: normalized.meta?.generated_at ?? normalized.data?.last_updated ?? null
        }
      };
    } catch (error) {
      if (typeof error?.statusCode === "number" && error.statusCode < 500) {
        throw error;
      }

      const fallbackData = fallbackFactory();
      return {
        data: fallbackData,
        meta: {
          source: "mock",
          fallbackReason: error instanceof Error ? error.message : "Live request failed.",
          partialData: false,
          warnings: [],
          generatedAt: fallbackData?.last_updated ?? null
        }
      };
    }
  }
}

function normalizeEnvelope(payload) {
  if (payload && typeof payload === "object" && "data" in payload) {
    return {
      data: payload.data,
      meta: payload.meta ?? {}
    };
  }

  return {
    data: payload,
    meta: {}
  };
}
