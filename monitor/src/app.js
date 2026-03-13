import { createOpsApi } from "./api/opsApi.js";
import { createOverviewPage } from "./pages/overviewPage.js";
import { compareStatusSeverity } from "./utils/status.js";

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const MIN_REFRESH_INTERVAL_MS = 15_000;

export function createMonitorApp(rootElement) {
  const api = createOpsApi();
  const state = {
    isLoading: true,
    errorMessage: "",
    overview: null,
    pipelines: [],
    alarms: [],
    logSummary: [],
    filters: {
      status: "all",
      query: "",
      sort: "severity"
    },
    autoRefreshEnabled: true,
    refreshIntervalMs: sanitizeRefreshInterval(import.meta.env.VITE_MONITOR_REFRESH_INTERVAL_MS),
    lastUpdated: null,
    dataSource: "mock",
    fallbackReason: "",
    selectedPipelineId: null,
    selectedPipelineDetail: null,
    detailLoading: false,
    detailError: "",
    detailCache: new Map()
  };

  let refreshTimerId = null;
  let detailRequestToken = 0;

  const page = createOverviewPage({
    rootElement,
    onRefresh: () => refreshSnapshot(),
    onToggleAutoRefresh: () => toggleAutoRefresh(),
    onSelectPipeline: (pipelineId) => openPipelineDetails(pipelineId),
    onCloseModal: () => closePipelineDetails(),
    onUpdateFilters: (nextFilters) => updateFilters(nextFilters)
  });

  function render() {
    const selectedPipeline = state.pipelines.find((pipeline) => pipeline.id === state.selectedPipelineId) ?? null;

    page.render({
      isLoading: state.isLoading,
      errorMessage: state.errorMessage,
      overview: state.overview ?? createEmptyOverview(),
      allPipelines: state.pipelines,
      totalPipelineCount: state.pipelines.length,
      pipelines: getVisiblePipelines(),
      alarms: state.alarms,
      logSummary: state.logSummary,
      filters: state.filters,
      autoRefreshEnabled: state.autoRefreshEnabled,
      refreshIntervalMs: state.refreshIntervalMs,
      lastUpdated: state.lastUpdated,
      dataSource: state.dataSource,
      fallbackReason: state.fallbackReason,
      selectedPipeline,
      pipelineDetail: state.selectedPipelineDetail,
      detailLoading: state.detailLoading,
      detailError: state.detailError
    });
  }

  async function refreshSnapshot({ silent = false } = {}) {
    if (!silent) {
      state.isLoading = !state.overview;
      state.errorMessage = "";
      render();
    }

    try {
      const [overviewResult, pipelinesResult, alarmsResult, logSummaryResult] = await Promise.all([
        api.getOverview(),
        api.getPipelines(),
        api.getAlarms(),
        api.getLogSummary()
      ]);

      state.overview = overviewResult.data;
      state.pipelines = Array.isArray(pipelinesResult.data) ? pipelinesResult.data : [];
      state.alarms = Array.isArray(alarmsResult.data) ? alarmsResult.data : [];
      state.logSummary = Array.isArray(logSummaryResult.data) ? logSummaryResult.data : [];
      state.dataSource = resolveDataSource([
        overviewResult.meta,
        pipelinesResult.meta,
        alarmsResult.meta,
        logSummaryResult.meta
      ]);
      state.fallbackReason = [
        overviewResult.meta,
        pipelinesResult.meta,
        alarmsResult.meta,
        logSummaryResult.meta
      ]
        .map((meta) => meta.fallbackReason)
        .find(Boolean) ?? "";
      state.lastUpdated = new Date();
      state.isLoading = false;
      state.errorMessage = "";

      if (state.selectedPipelineId) {
        void loadPipelineDetail(state.selectedPipelineId, { background: true });
      }
    } catch (error) {
      state.errorMessage = error instanceof Error ? error.message : "Unable to load the monitoring snapshot.";
      state.isLoading = false;
    }

    render();
  }

  function updateFilters(nextFilters) {
    state.filters = {
      ...state.filters,
      ...nextFilters
    };
    render();
  }

  function toggleAutoRefresh() {
    state.autoRefreshEnabled = !state.autoRefreshEnabled;
    configureAutoRefresh();
    render();
  }

  function configureAutoRefresh() {
    if (refreshTimerId) {
      window.clearInterval(refreshTimerId);
      refreshTimerId = null;
    }

    if (!state.autoRefreshEnabled) {
      return;
    }

    refreshTimerId = window.setInterval(() => {
      void refreshSnapshot({ silent: true });
    }, state.refreshIntervalMs);
  }

  async function openPipelineDetails(pipelineId) {
    state.selectedPipelineId = pipelineId;
    state.detailError = "";
    state.selectedPipelineDetail = state.detailCache.get(pipelineId) ?? null;
    state.detailLoading = !state.selectedPipelineDetail;
    render();
    await loadPipelineDetail(pipelineId, { background: Boolean(state.selectedPipelineDetail) });
  }

  async function loadPipelineDetail(pipelineId, { background = false } = {}) {
    const requestToken = ++detailRequestToken;

    if (!background) {
      state.detailLoading = true;
      state.detailError = "";
      render();
    }

    try {
      const result = await api.getPipelineDetails(pipelineId);

      if (requestToken !== detailRequestToken) {
        return;
      }

      state.detailCache.set(pipelineId, result.data);

      if (state.selectedPipelineId === pipelineId) {
        state.selectedPipelineDetail = result.data;
        state.detailLoading = false;
        state.detailError = "";
      }
    } catch (error) {
      if (requestToken !== detailRequestToken) {
        return;
      }

      state.detailLoading = false;
      state.detailError = error instanceof Error ? error.message : "Unable to load pipeline details.";
    }

    render();
  }

  function closePipelineDetails() {
    state.selectedPipelineId = null;
    state.selectedPipelineDetail = null;
    state.detailLoading = false;
    state.detailError = "";
    render();
  }

  function getVisiblePipelines() {
    const query = state.filters.query.trim().toLowerCase();

    return [...state.pipelines]
      .filter((pipeline) => {
        if (state.filters.status !== "all" && pipeline.overall_status !== state.filters.status) {
          return false;
        }

        if (query && !pipeline.name.toLowerCase().includes(query)) {
          return false;
        }

        return true;
      })
      .sort((left, right) => sortPipelines(left, right, state.filters.sort));
  }

  render();
  void refreshSnapshot();
  configureAutoRefresh();

  return {
    destroy() {
      if (refreshTimerId) {
        window.clearInterval(refreshTimerId);
      }
      page.destroy();
    }
  };
}

function sanitizeRefreshInterval(value) {
  const parsed = Number.parseInt(value ?? "", 10);

  if (Number.isFinite(parsed) && parsed >= MIN_REFRESH_INTERVAL_MS) {
    return parsed;
  }

  return DEFAULT_REFRESH_INTERVAL_MS;
}

function resolveDataSource(metaEntries) {
  const sources = new Set(metaEntries.map((meta) => meta.source));

  if (sources.size === 1) {
    return metaEntries[0]?.source ?? "mock";
  }

  return "mixed";
}

function sortPipelines(left, right, sortOrder) {
  if (sortOrder === "name-asc") {
    return left.name.localeCompare(right.name);
  }

  if (sortOrder === "name-desc") {
    return right.name.localeCompare(left.name);
  }

  const severityDiff = compareStatusSeverity(left.overall_status, right.overall_status);

  if (severityDiff !== 0) {
    return severityDiff;
  }

  return left.name.localeCompare(right.name);
}

function createEmptyOverview() {
  return {
    total_pipelines: 0,
    healthy: 0,
    degraded: 0,
    down: 0,
    active_alarms: 0,
    last_updated: null
  };
}
