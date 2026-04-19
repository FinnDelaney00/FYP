/**
 * Loads alert data, shows the alert inbox, and handles review actions.
 */
import { getActiveApiUrl } from "./services/apiClient.js";

const ACTION_LABELS = {
  mark_reviewed: "Reviewed",
  mark_false_positive: "False Positive",
  mark_confirmed: "Confirmed",
  propose_edit: "Edit Proposed",
  quarantine_record: "Quarantine Proposed",
  exclude_from_analytics: "Excluded",
  soft_drop_record: "Soft-Drop Proposed"
};

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

/**
 * Builds the auth header when a signed-in user opens the alert feed.
 *
 * @param {(() => string) | undefined} getAuthToken
 * @returns {Record<string, string>}
 */
function buildAuthHeaders(getAuthToken) {
  const token = typeof getAuthToken === "function" ? String(getAuthToken() || "").trim() : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Sends an authenticated GET request and reads the JSON response.
 *
 * @param {string} path
 * @param {(() => string) | undefined} getAuthToken
 * @returns {Promise<any>}
 */
function getJSON(path, getAuthToken) {
  return fetch(`${getActiveApiUrl()}${path}`, {
    headers: {
      ...buildAuthHeaders(getAuthToken)
    }
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || `HTTP ${response.status}`);
    }
    return payload;
  });
}

/**
 * Sends an authenticated POST request and reads the JSON response.
 *
 * @param {string} path
 * @param {unknown} body
 * @param {(() => string) | undefined} getAuthToken
 * @returns {Promise<any>}
 */
function postJSON(path, body, getAuthToken) {
  return fetch(`${getActiveApiUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(getAuthToken)
    },
    body: JSON.stringify(body || {})
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || `HTTP ${response.status}`);
    }
    return payload;
  });
}

/**
 * Escapes text before it is added to HTML.
 *
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

/**
 * Formats alert times for the list and detail views.
 *
 * @param {string | number | Date} value
 * @returns {string}
 */
function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return DATE_FORMATTER.format(date);
}

/**
 * Formats regular numbers for alert metrics.
 *
 * @param {unknown} value
 * @returns {string}
 */
function formatNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : "--";
}

/**
 * Formats percentage values for alert details.
 *
 * @param {unknown} value
 * @returns {string}
 */
function formatPercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1)}%` : "--";
}

/**
 * Picks the right formatter for each alert metric.
 *
 * @param {string} name
 * @param {unknown} value
 * @returns {string}
 */
function formatMetricValue(name, value) {
  if (name === "percent_deviation") {
    return formatPercent(value);
  }
  return formatNumber(value);
}

/**
 * Turns the current filters into a query string.
 *
 * @param {Record<string, string>} filters
 * @returns {string}
 */
function queryFromFilters(filters) {
  const query = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (!value) {
      return;
    }
    query.set(key, value);
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

/**
 * Shortens long alert descriptions for the list view.
 *
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string}
 */
function truncate(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

/**
 * Turns alert severity into the CSS class used by the list cards.
 *
 * @param {string} severity
 * @returns {"high" | "medium" | "low"}
 */
function severityClass(severity) {
  const normalized = String(severity || "").toLowerCase();
  if (normalized === "high") {
    return "high";
  }
  if (normalized === "medium") {
    return "medium";
  }
  return "low";
}

/**
 * Turns backend status names into labels people can read easily.
 *
 * @param {string} status
 * @returns {string}
 */
function statusLabel(status) {
  return String(status || "new").replaceAll("_", " ");
}

/**
 * Formats attached alert data for the detail panel.
 *
 * @param {unknown} value
 * @returns {string}
 */
function toPrettyJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

/**
 * Finds the DOM nodes that show the alert summary counts.
 *
 * @returns {Record<string, HTMLElement | null>}
 */
function summaryElements() {
  return {
    high: document.getElementById("anomaly-high-count"),
    medium: document.getElementById("anomaly-medium-count"),
    low: document.getElementById("anomaly-low-count"),
    reviewed: document.getElementById("anomaly-reviewed-count"),
    confirmed: document.getElementById("anomaly-confirmed-count")
  };
}

/**
 * Finds the alert filters and their related status elements.
 *
 * @returns {Record<string, HTMLElement | null | Element[]>}
 */
function filterElements() {
  return {
    form: document.getElementById("anomaly-filters-form"),
    type: document.getElementById("anomaly-filter-type"),
    severity: document.getElementById("anomaly-filter-severity"),
    status: document.getElementById("anomaly-filter-status"),
    entity: document.getElementById("anomaly-filter-entity"),
    dateFrom: document.getElementById("anomaly-filter-date-from"),
    dateTo: document.getElementById("anomaly-filter-date-to"),
    reset: document.getElementById("anomaly-filter-reset"),
    stateText: document.getElementById("anomaly-filters-status")
  };
}

/**
 * Finds the DOM nodes used by the alert detail drawer.
 *
 * @returns {Record<string, any>}
 */
function detailElements() {
  return {
    panel: document.getElementById("anomaly-detail-panel"),
    close: document.getElementById("anomaly-detail-close"),
    title: document.getElementById("anomaly-detail-title"),
    subtitle: document.getElementById("anomaly-detail-subtitle"),
    meta: document.getElementById("anomaly-detail-meta"),
    description: document.getElementById("anomaly-detail-description"),
    metrics: document.getElementById("anomaly-detail-metrics"),
    reasons: document.getElementById("anomaly-detail-reasons"),
    record: document.getElementById("anomaly-detail-record"),
    duplicates: document.getElementById("anomaly-detail-duplicates"),
    suggestedAction: document.getElementById("anomaly-detail-suggested-action"),
    note: document.getElementById("anomaly-action-note"),
    actionButtons: Array.from(document.querySelectorAll("[data-anomaly-action]")),
    audit: document.getElementById("anomaly-detail-audit")
  };
}

/**
 * Shows the top alert summary counters.
 *
 * @param {Record<string, any>} summary
 */
function renderSummary(summary) {
  const elements = summaryElements();
  if (!elements.high) {
    return;
  }

  elements.high.textContent = String(summary?.high_priority_count ?? 0);
  elements.medium.textContent = String(summary?.medium_priority_count ?? 0);
  elements.low.textContent = String(summary?.low_priority_count ?? 0);
  elements.reviewed.textContent = String(summary?.reviewed_count ?? 0);
  elements.confirmed.textContent = String(summary?.confirmed_count ?? 0);
}

/**
 * Shows the alert inbox list and its empty state.
 *
 * @param {Array<Record<string, any>>} items
 */
function renderAnomalyList(items) {
  const container = document.getElementById("anomaly-list");
  const meta = document.getElementById("anomaly-list-meta");
  if (!container || !meta) {
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = "<div class=\"anomaly-empty\">No anomalies match your current filter selection.</div>";
    meta.textContent = "0 anomalies shown.";
    return;
  }

  container.innerHTML = items.map((item) => `
    <article class="anomaly-item ${severityClass(item.severity)}" data-anomaly-id="${escapeHtml(item.anomaly_id)}">
      <div>
        <div class="anomaly-item-head">
          <h4>${escapeHtml(item.title || "Untitled anomaly")}</h4>
          <button class="anomaly-open-link" type="button" data-anomaly-open="${escapeHtml(item.anomaly_id)}">Investigate</button>
        </div>
        <p>${escapeHtml(truncate(item.description || "No description available.", 180))}</p>
        <div class="anomaly-item-meta">
          <span class="anomaly-badge" data-kind="severity">${escapeHtml(item.severity || "low")}</span>
          <span class="anomaly-badge" data-kind="status">${escapeHtml(statusLabel(item.status))}</span>
          <span class="anomaly-badge" data-kind="time">${escapeHtml(formatDate(item.detected_at))}</span>
        </div>
        <div class="anomaly-item-actions">
          <button type="button" data-anomaly-quick-action="mark_reviewed" data-anomaly-id="${escapeHtml(item.anomaly_id)}">Review</button>
          <button type="button" data-anomaly-quick-action="mark_confirmed" data-anomaly-id="${escapeHtml(item.anomaly_id)}">Confirm</button>
          <button type="button" data-anomaly-quick-action="mark_false_positive" data-anomaly-id="${escapeHtml(item.anomaly_id)}">False Positive</button>
        </div>
      </div>
    </article>
  `).join("");
  meta.textContent = `${items.length} anomalies shown.`;
}

/**
 * Shows the selected alert in the side detail panel.
 *
 * @param {Record<string, any>} item
 */
function renderAnomalyDetail(item) {
  const elements = detailElements();
  if (!elements.panel || !item) {
    return;
  }

  elements.panel.classList.remove("is-hidden");
  elements.panel.dataset.selectedAnomalyId = item.anomaly_id || "";
  elements.title.textContent = item.title || "Untitled anomaly";
  elements.subtitle.textContent = `${statusLabel(item.status)} • ${formatDate(item.detected_at)}`;
  elements.description.textContent = item.description || "No explanation available.";
  elements.suggestedAction.textContent = item.suggested_action
    ? `Suggested action: ${String(item.suggested_action).replaceAll("_", " ")}`
    : "Suggested action is not provided.";

  elements.meta.innerHTML = `
    <span class="anomaly-badge" data-kind="severity">${escapeHtml(item.severity || "low")}</span>
    <span class="anomaly-badge" data-kind="status">${escapeHtml(statusLabel(item.status))}</span>
    <span class="anomaly-badge" data-kind="entity">${escapeHtml(item.entity_type || "unknown")}</span>
    <span class="anomaly-badge" data-kind="type">${escapeHtml(item.anomaly_type || "unknown")}</span>
  `;

  const metrics = item.metrics || {};
  const metricEntries = [
    ["actual_value", metrics.actual_value],
    ["expected_value", metrics.expected_value],
    ["percent_deviation", metrics.percent_deviation],
    ["z_score", metrics.z_score]
  ];
  elements.metrics.innerHTML = metricEntries.map(([name, value]) => `
    <div class="anomaly-metric-box">
      <span>${escapeHtml(name.replaceAll("_", " "))}</span>
      <strong>${escapeHtml(formatMetricValue(name, value))}</strong>
    </div>
  `).join("");

  const reasons = Array.isArray(item.reasons) ? item.reasons : [];
  elements.reasons.innerHTML = reasons.length
    ? reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")
    : "<li>No reasons were provided in this anomaly payload.</li>";

  const recordPayload = item?.details?.transaction || item?.details?.employee || item?.details?.record || {};
  elements.record.textContent = toPrettyJson(recordPayload);

  const duplicatePayload = item?.details?.linked_transactions || item?.details?.matched_records || [];
  elements.duplicates.textContent = Array.isArray(duplicatePayload) && duplicatePayload.length
    ? toPrettyJson(duplicatePayload)
    : "No duplicate record set attached.";

  const auditEntries = Array.isArray(item?.audit_trail) ? item.audit_trail : [];
  elements.audit.innerHTML = auditEntries.length
    ? auditEntries.slice().reverse().map((entry) => `
      <article class="anomaly-audit-item">
        <strong>${escapeHtml(statusLabel(entry.action || entry.message || "updated"))}</strong>
        <p>${escapeHtml(formatDate(entry.at || item.detected_at))} • ${escapeHtml(entry.actor || "Unknown actor")}</p>
        ${entry.note ? `<p>${escapeHtml(entry.note)}</p>` : ""}
      </article>
    `).join("")
    : "<div class=\"anomaly-empty\">No review activity recorded.</div>";
}

/**
 * Hides the detail panel and clears temporary form state.
 */
function clearAnomalyDetail() {
  const elements = detailElements();
  if (!elements.panel) {
    return;
  }
  elements.panel.classList.add("is-hidden");
  elements.panel.dataset.selectedAnomalyId = "";
  if (elements.note) {
    elements.note.value = "";
  }
}

/**
 * Starts alert polling, filters, detail loading, and action handling.
 *
 * @param {{ getAuthToken?: () => string }} [options={}]
 * @returns {() => void}
 */
export function initAnomaliesData({ getAuthToken = () => "" } = {}) {
  const filters = filterElements();
  const listContainer = document.getElementById("anomaly-list");
  const detail = detailElements();
  if (!filters.form || !listContainer || !detail.panel) {
    return () => {};
  }

  if (!getActiveApiUrl()) {
    if (filters.stateText) {
      filters.stateText.textContent = "VITE_getActiveApiUrl() is missing.";
    }
    return () => {};
  }

  let timer = null;
  let latestItems = [];

  const currentFilters = () => ({
    anomaly_type: filters.type?.value || "",
    severity: filters.severity?.value || "",
    status: filters.status?.value || "",
    entity_type: filters.entity?.value || "",
    date_from: filters.dateFrom?.value || "",
    date_to: filters.dateTo?.value || ""
  });

  const fetchAnomalies = async () => {
    const payload = await getJSON(`/anomalies${queryFromFilters(currentFilters())}`, getAuthToken);
    latestItems = Array.isArray(payload?.items) ? payload.items : [];
    renderSummary(payload?.summary || {});
    renderAnomalyList(latestItems);
    if (filters.stateText) {
      const updatedText = payload?.last_modified
        ? `Updated ${formatDate(payload.last_modified)}`
        : "Anomaly feed loaded.";
      filters.stateText.textContent = updatedText;
    }
  };

  const refreshDetail = async (anomalyId) => {
    if (!anomalyId) {
      clearAnomalyDetail();
      return;
    }
    const payload = await getJSON(`/anomalies/${encodeURIComponent(anomalyId)}`, getAuthToken);
    const item = payload?.item || latestItems.find((entry) => entry.anomaly_id === anomalyId);
    if (item) {
      renderAnomalyDetail(item);
    }
  };

  const submitAction = async (anomalyId, action) => {
    if (!anomalyId || !action) {
      return;
    }
    const noteText = detail.note?.value || "";
    const payload = await postJSON(`/anomalies/${encodeURIComponent(anomalyId)}/actions`, {
      action,
      note: noteText
    }, getAuthToken);

    if (detail.note) {
      detail.note.value = "";
    }

    const label = ACTION_LABELS[action] || "Updated";
    if (filters.stateText) {
      filters.stateText.textContent = `${label} on anomaly ${anomalyId}.`;
    }

    await fetchAnomalies();
    const updatedItem = payload?.item || latestItems.find((entry) => entry.anomaly_id === anomalyId);
    if (updatedItem) {
      renderAnomalyDetail(updatedItem);
    }
  };

  const onFilterChange = () => {
    fetchAnomalies().catch((error) => {
      if (filters.stateText) {
        filters.stateText.textContent = `Failed to load anomalies: ${error.message}`;
      }
    });
  };

  const onListClick = (event) => {
    const openButton = event.target.closest("[data-anomaly-open]");
    if (openButton) {
      const anomalyId = openButton.getAttribute("data-anomaly-open") || "";
      refreshDetail(anomalyId).catch((error) => {
        if (filters.stateText) {
          filters.stateText.textContent = `Failed to load anomaly detail: ${error.message}`;
        }
      });
      return;
    }

    const quickActionButton = event.target.closest("[data-anomaly-quick-action]");
    if (quickActionButton) {
      const anomalyId = quickActionButton.getAttribute("data-anomaly-id") || "";
      const action = quickActionButton.getAttribute("data-anomaly-quick-action") || "";
      submitAction(anomalyId, action).catch((error) => {
        if (filters.stateText) {
          filters.stateText.textContent = `Action failed: ${error.message}`;
        }
      });
    }
  };

  const onDetailAction = (event) => {
    const button = event.currentTarget;
    const action = button.getAttribute("data-anomaly-action") || "";
    const anomalyId = detail.panel.dataset.selectedAnomalyId || "";
    submitAction(anomalyId, action).catch((error) => {
      if (filters.stateText) {
        filters.stateText.textContent = `Action failed: ${error.message}`;
      }
    });
  };

  const onReset = () => {
    if (filters.type) filters.type.value = "";
    if (filters.severity) filters.severity.value = "";
    if (filters.status) filters.status.value = "";
    if (filters.entity) filters.entity.value = "";
    if (filters.dateFrom) filters.dateFrom.value = "";
    if (filters.dateTo) filters.dateTo.value = "";
    clearAnomalyDetail();
    onFilterChange();
  };

  const filterInputs = [filters.type, filters.severity, filters.status, filters.entity, filters.dateFrom, filters.dateTo].filter(Boolean);
  filterInputs.forEach((element) => {
    element.addEventListener("change", onFilterChange);
  });
  listContainer.addEventListener("click", onListClick);
  detail.actionButtons.forEach((button) => {
    button.addEventListener("click", onDetailAction);
  });
  if (filters.reset) {
    filters.reset.addEventListener("click", onReset);
  }
  if (detail.close) {
    detail.close.addEventListener("click", clearAnomalyDetail);
  }

  fetchAnomalies().catch((error) => {
    if (filters.stateText) {
      filters.stateText.textContent = `Failed to load anomalies: ${error.message}`;
    }
  });
  timer = window.setInterval(() => {
    fetchAnomalies().catch(() => {});
  }, 30000);

  return () => {
    if (timer) {
      window.clearInterval(timer);
    }
    filterInputs.forEach((element) => {
      element.removeEventListener("change", onFilterChange);
    });
    listContainer.removeEventListener("click", onListClick);
    detail.actionButtons.forEach((button) => {
      button.removeEventListener("click", onDetailAction);
    });
    if (filters.reset) {
      filters.reset.removeEventListener("click", onReset);
    }
    if (detail.close) {
      detail.close.removeEventListener("click", clearAnomalyDetail);
    }
  };
}
