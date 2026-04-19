import { renderAlarmsPanel } from "../components/alarmsPanel.js";
import { renderIncidentBanner } from "../components/incidentBanner.js";
import { renderLogSummaryPanel } from "../components/logSummaryPanel.js";
import { renderPipelineDetailsModal } from "../components/pipelineDetailsModal.js";
import { renderPipelineTable } from "../components/pipelineTable.js";
import { renderSummaryCards } from "../components/summaryCards.js";
import { renderEmptyState, renderErrorState, renderLoadingState } from "../components/states.js";
import { escapeHtml } from "../utils/dom.js";
import { formatRelativeTime, formatTimestamp } from "../utils/formatters.js";

/**
 * Creates the page-level renderer and delegates all user interactions through a
 * small set of action/control callbacks supplied by the application controller.
 *
 * @param {{
 *   rootElement: HTMLElement,
 *   onRefresh: () => void,
 *   onToggleAutoRefresh: () => void,
 *   onSelectPipeline: (pipelineId: string) => void,
 *   onCloseModal: () => void,
 *   onUpdateFilters: (filters: Record<string, string>) => void
 * }} options
 * @returns {{ render: (viewModel: object) => void, destroy: () => void }}
 */
export function createOverviewPage({
  rootElement,
  onRefresh,
  onToggleAutoRefresh,
  onSelectPipeline,
  onCloseModal,
  onUpdateFilters
}) {
  rootElement.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");

    if (!actionTarget) {
      return;
    }

    const { action, pipelineId } = actionTarget.dataset;

    if (action === "refresh") {
      onRefresh();
    }

    if (action === "toggle-refresh") {
      onToggleAutoRefresh();
    }

    if (action === "open-details" && pipelineId) {
      onSelectPipeline(pipelineId);
    }

    if (action === "close-modal") {
      onCloseModal();
    }

    if (action === "set-group" && actionTarget.dataset.group) {
      onUpdateFilters({ pipelineGroup: actionTarget.dataset.group });
    }
  });

  rootElement.addEventListener("change", (event) => {
    const controlTarget = event.target.closest("[data-control]");

    if (!controlTarget) {
      return;
    }

    if (controlTarget.dataset.control === "status-filter") {
      onUpdateFilters({ status: controlTarget.value });
    }

    if (controlTarget.dataset.control === "sort-order") {
      onUpdateFilters({ sort: controlTarget.value });
    }
  });

  rootElement.addEventListener("input", (event) => {
    const controlTarget = event.target.closest("[data-control]");

    if (!controlTarget) {
      return;
    }

    if (controlTarget.dataset.control === "name-filter") {
      onUpdateFilters({ query: controlTarget.value });
    }
  });

  const onKeydown = (event) => {
    if (event.key === "Escape") {
      onCloseModal();
    }
  };

  window.addEventListener("keydown", onKeydown);

  return {
    /**
     * Replaces the page markup from the latest view model while preserving focus
     * for filter controls so keyboard users can keep typing through refreshes.
     *
     * @param {object} viewModel
     */
    render(viewModel) {
      const focusedControl = captureFocusedControl(rootElement);
      rootElement.innerHTML = buildPageHtml(viewModel);
      restoreFocusedControl(rootElement, focusedControl);
    },
    /**
     * Removes the global Escape listener that is registered for the modal.
     */
    destroy() {
      window.removeEventListener("keydown", onKeydown);
    }
  };
}

/**
 * Builds the complete page shell as a string to keep rendering stateless and
 * easy to snapshot in tests.
 *
 * @param {object} viewModel
 * @returns {string}
 */
function buildPageHtml(viewModel) {
  const headerMessage = getSourceMessage(viewModel.dataSource);
  const filtersSummary = `Showing ${viewModel.pipelines.length} of ${viewModel.totalPipelineCount} pipelines`;

  return `
    <div class="monitor-app">
      <div class="monitor-backdrop"></div>
      <div class="monitor-shell">
        <header class="panel topbar">
          <div class="topbar__copy">
            <span class="eyebrow">SmartStream Ops</span>
            <h1>Pipeline monitor</h1>
            <p class="topbar__summary">
              Engineer-facing console for monitoring data ingestion, processing, storage delivery, freshness, and alarms.
            </p>
          </div>
          <div class="topbar__controls">
            <div class="topbar__status">
              <span class="source-pill source-pill--${escapeHtml(headerMessage.tone)}">${escapeHtml(headerMessage.label)}</span>
              <span class="meta-text">
                ${viewModel.lastUpdated ? `Last updated ${escapeHtml(formatTimestamp(viewModel.lastUpdated))}` : "Awaiting first refresh"}
              </span>
              <span class="meta-text">
                ${viewModel.lastUpdated ? escapeHtml(formatRelativeTime(viewModel.lastUpdated)) : "No data yet"}
              </span>
            </div>
            <div class="topbar__actions">
              <button class="button button--ghost" type="button" data-action="toggle-refresh">
                ${viewModel.autoRefreshEnabled ? "Pause auto-refresh" : "Resume auto-refresh"}
              </button>
              <button class="button button--primary" type="button" data-action="refresh">Refresh now</button>
            </div>
            <div class="topbar__footnote">
              <span>Interval ${Math.round(viewModel.refreshIntervalMs / 1000)}s</span>
              ${
                viewModel.fallbackReason
                  ? `<span class="topbar__fallback">${escapeHtml(viewModel.fallbackReason)}</span>`
                  : ""
              }
            </div>
          </div>
        </header>

        <div class="dashboard-layout">
          <main class="dashboard-main">
            ${renderIncidentBanner(viewModel.allPipelines, viewModel.alarms)}

            <section class="summary-grid">
              ${renderSummaryCards(viewModel.overview)}
            </section>

            <section class="panel section-card section-card--table">
              <div class="section-card__header section-card__header--table">
                <div>
                  <span class="eyebrow">Pipeline fleet</span>
                  <h2>Health matrix</h2>
                  <p class="section-card__summary">${escapeHtml(filtersSummary)}</p>
                </div>
                <div class="filter-bar">
                  <label class="control">
                    <span>Status</span>
                    <select data-control="status-filter">
                      ${renderOptions(
                        [
                          ["all", "All statuses"],
                          ["healthy", "Healthy"],
                          ["degraded", "Degraded"],
                          ["down", "Down"]
                        ],
                        viewModel.filters.status
                      )}
                    </select>
                  </label>
                  <label class="control control--grow">
                    <span>Pipeline name</span>
                    <input
                      type="search"
                      data-control="name-filter"
                      value="${escapeHtml(viewModel.filters.query)}"
                      placeholder="Search pipelines"
                      autocomplete="off"
                    />
                  </label>
                  <label class="control">
                    <span>Sort</span>
                    <select data-control="sort-order">
                      ${renderOptions(
                        [
                          ["severity", "Status severity"],
                          ["name-asc", "Pipeline name A-Z"],
                          ["name-desc", "Pipeline name Z-A"]
                        ],
                        viewModel.filters.sort
                      )}
                    </select>
                  </label>
                </div>
              </div>
              <div class="pipeline-group-tabs">
                ${renderGroupTabs(viewModel.allPipelines, viewModel.filters.pipelineGroup)}
              </div>
              ${renderPipelineSection(viewModel)}
            </section>
          </main>

          <aside class="dashboard-rail" aria-label="Operational insights">
            <article class="panel section-card section-card--rail">
              <div class="section-card__header">
                <div>
                  <span class="eyebrow">Escalations</span>
                  <h2>Recent alarms</h2>
                </div>
                <span class="section-card__meta">${escapeHtml(String(viewModel.alarms.length))} active</span>
              </div>
              ${renderAlarmsPanel(viewModel.alarms)}
            </article>

            <article class="panel section-card section-card--rail">
              <div class="section-card__header">
                <div>
                  <span class="eyebrow">Logs</span>
                  <h2>Log pulse</h2>
                </div>
                <span class="section-card__meta">Last 15 minutes</span>
              </div>
              ${renderLogSummaryPanel(viewModel.logSummary)}
            </article>
          </aside>
        </div>
      </div>
      ${renderPipelineDetailsModal({
        pipeline: viewModel.selectedPipeline,
        detail: viewModel.pipelineDetail,
        isLoading: viewModel.detailLoading,
        errorMessage: viewModel.detailError
      })}
    </div>
  `;
}

/**
 * Chooses the correct table state based on both the global load/error status
 * and the current filter result set.
 *
 * @param {object} viewModel
 * @returns {string}
 */
function renderPipelineSection(viewModel) {
  if (viewModel.isLoading && viewModel.totalPipelineCount === 0) {
    return renderLoadingState("Loading monitor snapshot", "Fetching overview, pipeline health, alarms, and logs.");
  }

  if (viewModel.errorMessage && viewModel.totalPipelineCount === 0) {
    return renderErrorState("Unable to load monitor data", viewModel.errorMessage);
  }

  if (viewModel.totalPipelineCount === 0) {
    return renderEmptyState("No pipelines configured", "The ops API returned no pipelines for this environment.");
  }

  if (viewModel.pipelines.length === 0) {
    return renderEmptyState("No matching pipelines", "Adjust the status filter or search term to widen the result set.");
  }

  return renderPipelineTable(viewModel.pipelines);
}

/**
 * Returns the pipeline group for a pipeline, inferring it from the ID when the
 * API response does not include a pipeline_group field.
 *
 * @param {{ pipeline_group?: string, id: string }} pipeline
 * @returns {string}
 */
function resolvePipelineGroup(pipeline) {
  if (pipeline.pipeline_group) {
    return pipeline.pipeline_group;
  }

  return pipeline.id.startsWith("acme-") ? "acme" : "smartstream";
}

/**
 * Renders the pipeline-group tab strip above the health table. Each tab shows
 * the pipeline count for that group and an issue badge when unhealthy pipelines
 * are present, so engineers can see at a glance which deployment needs attention.
 *
 * @param {Array<object>} allPipelines
 * @param {string} activeGroup
 * @returns {string}
 */
function renderGroupTabs(allPipelines, activeGroup) {
  const groups = [
    { key: "all", label: "All pipelines" },
    { key: "smartstream", label: "SmartStream (Legacy)" },
    { key: "acme", label: "Acme" }
  ];

  return groups
    .map(({ key, label }) => {
      const groupPipelines = key === "all" ? allPipelines : allPipelines.filter((p) => resolvePipelineGroup(p) === key);
      const issueCount = groupPipelines.filter(
        (p) => p.overall_status === "degraded" || p.overall_status === "warning" || p.overall_status === "down"
      ).length;
      const isActive = activeGroup === key;

      return `
        <button
          class="group-tab${isActive ? " group-tab--active" : ""}"
          type="button"
          data-action="set-group"
          data-group="${escapeHtml(key)}"
        >
          ${escapeHtml(label)}
          <span class="group-tab__count">${escapeHtml(String(groupPipelines.length))}</span>
          ${issueCount > 0 ? `<span class="group-tab__issues">${escapeHtml(String(issueCount))} issue${issueCount > 1 ? "s" : ""}</span>` : ""}
        </button>
      `;
    })
    .join("");
}

/**
 * Renders a `<select>` option list while preserving the current selected value.
 *
 * @param {Array<[string, string]>} options
 * @param {string} selectedValue
 * @returns {string}
 */
function renderOptions(options, selectedValue) {
  return options
    .map(([value, label]) => {
      const selected = value === selectedValue ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

/**
 * Maps the aggregated data-source state to a small label/tone pair for the
 * header badge.
 *
 * @param {"live" | "mixed" | "partial" | "mock"} dataSource
 * @returns {{ label: string, tone: string }}
 */
function getSourceMessage(dataSource) {
  if (dataSource === "live") {
    return {
      label: "Live ops data",
      tone: "live"
    };
  }

  if (dataSource === "mixed") {
    return {
      label: "Mixed live + mock",
      tone: "mixed"
    };
  }

  if (dataSource === "partial") {
    return {
      label: "Live partial data",
      tone: "partial"
    };
  }

  return {
    label: "Mock fallback",
    tone: "mock"
  };
}

/**
 * Records the currently focused filter control before the page re-renders so it
 * can be restored afterwards.
 *
 * @param {HTMLElement} rootElement
 * @returns {{ controlName: string, selectionStart: number | null, selectionEnd: number | null } | null}
 */
function captureFocusedControl(rootElement) {
  const activeElement = document.activeElement;

  if (!activeElement || !rootElement.contains(activeElement)) {
    return null;
  }

  const controlName = activeElement.dataset?.control;

  if (!controlName) {
    return null;
  }

  return {
    controlName,
    selectionStart: typeof activeElement.selectionStart === "number" ? activeElement.selectionStart : null,
    selectionEnd: typeof activeElement.selectionEnd === "number" ? activeElement.selectionEnd : null
  };
}

/**
 * Restores focus and text selection to the previously active filter control.
 *
 * @param {HTMLElement} rootElement
 * @param {{ controlName: string, selectionStart: number | null, selectionEnd: number | null } | null} focusedControl
 */
function restoreFocusedControl(rootElement, focusedControl) {
  if (!focusedControl) {
    return;
  }

  const nextElement = rootElement.querySelector(`[data-control="${focusedControl.controlName}"]`);

  if (!nextElement) {
    return;
  }

  nextElement.focus({ preventScroll: true });

  if (
    typeof focusedControl.selectionStart === "number" &&
    typeof focusedControl.selectionEnd === "number" &&
    typeof nextElement.setSelectionRange === "function"
  ) {
    nextElement.setSelectionRange(focusedControl.selectionStart, focusedControl.selectionEnd);
  }
}
