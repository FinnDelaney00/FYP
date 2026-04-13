import { createOpsApi } from "./api/opsApi.js";
import { createOverviewPage } from "./pages/overviewPage.js";
import { compareStatusSeverity } from "./utils/status.js";

// Keep the UI responsive by defaulting to a one-minute poll while still allowing
// deployments to opt into a faster cadence for demos or operational drills.
const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const MIN_REFRESH_INTERVAL_MS = 15_000;

/**
 * Creates the monitor application controller and wires together data loading,
 * filter state, auto-refresh, and the pipeline detail modal.
 *
 * @param {HTMLElement} rootElement Root DOM node that owns the monitor UI.
 * @returns {{ destroy: () => void }} Cleanup API for timers and listeners.
 */
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

  /**
   * Recomputes the derived view model and hands it to the page renderer.
   * Keeping the mapping in one place makes it easier to evolve the state shape
   * without spreading presentation logic across event handlers.
   */
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

  /**
   * Refreshes the top-level monitor snapshot. When the refresh is silent we keep
   * the existing data on screen so background polling does not flash the layout.
   *
   * @param {{ silent?: boolean }} [options]
   * @returns {Promise<void>}
   */
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
      state.lastUpdated =
        overviewResult.meta?.generatedAt ??
        overviewResult.data?.last_updated ??
        new Date().toISOString();
      state.isLoading = false;
      state.errorMessage = "";

      // Rehydrate the selected detail view in the background so the modal tracks
      // the latest pipeline state without blocking the overview refresh.
      if (state.selectedPipelineId) {
        void loadPipelineDetail(state.selectedPipelineId, { background: true });
      }
    } catch (error) {
      state.errorMessage = error instanceof Error ? error.message : "Unable to load the monitoring snapshot.";
      state.isLoading = false;
    }

    render();
  }

  /**
   * Merges new filter values into the current filter state and re-renders the
   * derived pipeline list immediately.
   *
   * @param {Partial<typeof state.filters>} nextFilters
   */
  function updateFilters(nextFilters) {
    state.filters = {
      ...state.filters,
      ...nextFilters
    };
    render();
  }

  /**
   * Toggles polling on or off from the top-bar control.
   */
  function toggleAutoRefresh() {
    state.autoRefreshEnabled = !state.autoRefreshEnabled;
    configureAutoRefresh();
    render();
  }

  /**
   * Rebuilds the polling timer to reflect the latest enablement flag and
   * sanitized refresh interval.
   */
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

  /**
   * Opens the detail modal and immediately shows cached detail data when it is
   * available, then refreshes the selected pipeline in the background.
   *
   * @param {string} pipelineId
   * @returns {Promise<void>}
   */
  async function openPipelineDetails(pipelineId) {
    state.selectedPipelineId = pipelineId;
    state.detailError = "";
    state.selectedPipelineDetail = state.detailCache.get(pipelineId) ?? null;
    state.detailLoading = !state.selectedPipelineDetail;
    render();
    await loadPipelineDetail(pipelineId, { background: Boolean(state.selectedPipelineDetail) });
  }

  /**
   * Loads pipeline detail data and guards against out-of-order responses by
   * tagging each request with a monotonically increasing token.
   *
   * @param {string} pipelineId
   * @param {{ background?: boolean }} [options]
   * @returns {Promise<void>}
   */
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

  /**
   * Clears the current modal selection without touching the cached detail data,
   * so reopening the same pipeline can show the last known snapshot instantly.
   */
  function closePipelineDetails() {
    state.selectedPipelineId = null;
    state.selectedPipelineDetail = null;
    state.detailLoading = false;
    state.detailError = "";
    render();
  }

  /**
   * Applies the current status/query filters and sort order to the pipeline list.
   *
   * @returns {Array<object>}
   */
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

/**
 * Normalizes the refresh interval environment variable and enforces a minimum
 * cadence so an accidental low value cannot hammer the API.
 *
 * @param {string | number | undefined | null} value
 * @returns {number}
 */
function sanitizeRefreshInterval(value) {
  const parsed = Number.parseInt(value ?? "", 10);

  if (Number.isFinite(parsed) && parsed >= MIN_REFRESH_INTERVAL_MS) {
    return parsed;
  }

  return DEFAULT_REFRESH_INTERVAL_MS;
}

/**
 * Collapses endpoint metadata into a single badge value for the page header.
 * Mixed means at least one resource came from live data while another fell back
 * to mock data in the same snapshot.
 *
 * @param {Array<{ source?: string } | undefined>} metaEntries
 * @returns {"live" | "mixed" | "mock" | "partial"}
 */
function resolveDataSource(metaEntries) {
  const sources = new Set(metaEntries.map((meta) => meta.source).filter(Boolean));

  if (sources.has("mock") && sources.size > 1) {
    return "mixed";
  }

  if (sources.has("mock")) {
    return "mock";
  }

  if (sources.has("partial")) {
    return "partial";
  }

  return metaEntries[0]?.source ?? "mock";
}

/**
 * Sorts pipelines by the requested order, using name as a stable tie-breaker
 * when severity alone cannot determine placement.
 *
 * @param {{ name: string, overall_status: string }} left
 * @param {{ name: string, overall_status: string }} right
 * @param {"severity" | "name-asc" | "name-desc"} sortOrder
 * @returns {number}
 */
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

/**
 * Provides a stable empty overview model so the renderer does not need to guard
 * against missing metric keys during the initial load.
 *
 * @returns {{
 *   total_pipelines: number,
 *   healthy: number,
 *   degraded: number,
 *   down: number,
 *   active_alarms: number,
 *   last_updated: string | null
 * }}
 */
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
