import { renderSeverityPill } from "./severityPill.js";
import { renderStatusBadge } from "./statusBadge.js";
import { renderErrorState, renderLoadingState } from "./states.js";
import { escapeHtml } from "../utils/dom.js";
import { formatLag, formatRelativeTime, formatTimestamp } from "../utils/formatters.js";

export function renderPipelineDetailsModal({ pipeline, detail, isLoading, errorMessage }) {
  if (!pipeline) {
    return "";
  }

  const activeAlarmCount = detail?.active_alarms?.length ?? pipeline.alarm_count ?? 0;

  return `
    <div class="modal-shell">
      <div class="modal-backdrop" data-action="close-modal"></div>
      <section class="panel modal-panel" role="dialog" aria-modal="true" aria-labelledby="pipeline-detail-title">
        <header class="modal-panel__header">
          <div>
            <span class="eyebrow">Pipeline details</span>
            <h2 id="pipeline-detail-title">${escapeHtml(pipeline.name)}</h2>
            <div class="modal-panel__status">
              ${renderStatusBadge(pipeline.overall_status)}
              ${isLoading && detail ? '<span class="modal-inline-note">Refreshing detail snapshot</span>' : ""}
            </div>
          </div>
          <button class="button button--ghost" type="button" data-action="close-modal">Close</button>
        </header>
        ${
          errorMessage
            ? renderErrorState("Unable to load pipeline details", errorMessage)
            : detail
              ? renderDetailBody(detail, activeAlarmCount)
              : renderLoadingState("Loading pipeline details", "Fetching component health, freshness, and alarm context.")
        }
      </section>
    </div>
  `;
}

function renderDetailBody(detail, activeAlarmCount) {
  return `
    <div class="modal-panel__body">
      <p class="modal-panel__summary">${escapeHtml(detail.summary)}</p>

      <section class="snapshot-grid">
        <article class="snapshot-card">
          <span>Freshness lag</span>
          <strong>${escapeHtml(formatLag(detail.freshness?.lag_minutes))}</strong>
          <small>Target ${escapeHtml(formatLag(detail.freshness?.target_minutes))}</small>
          ${renderStatusBadge(detail.freshness?.status ?? "warning")}
        </article>
        <article class="snapshot-card">
          <span>Last success</span>
          <strong>${escapeHtml(formatTimestamp(detail.last_success_at))}</strong>
          <small>${escapeHtml(formatRelativeTime(detail.last_success_at))}</small>
        </article>
        <article class="snapshot-card">
          <span>Last failure</span>
          <strong>${escapeHtml(formatTimestamp(detail.last_failure_at))}</strong>
          <small>${escapeHtml(formatRelativeTime(detail.last_failure_at))}</small>
        </article>
        <article class="snapshot-card">
          <span>Active alarms</span>
          <strong>${escapeHtml(String(activeAlarmCount))}</strong>
          <small>Open alarm conditions</small>
        </article>
      </section>

      <section class="modal-section">
        <div class="modal-section__header">
          <h3>Freshness and lag</h3>
          ${renderStatusBadge(detail.freshness?.status ?? "warning")}
        </div>
        <p class="modal-section__body">${escapeHtml(detail.freshness?.message ?? "No freshness context available.")}</p>
      </section>

      <section class="modal-section">
        <div class="modal-section__header">
          <h3>Component health</h3>
          <span class="modal-section__meta">${escapeHtml(String(detail.components?.length ?? 0))} components</span>
        </div>
        <div class="component-grid">
          ${(detail.components ?? []).map((component) => renderComponentCard(component)).join("")}
        </div>
      </section>

      <div class="modal-split">
        <section class="modal-section">
          <div class="modal-section__header">
            <h3>Recent errors</h3>
            <span class="modal-section__meta">${escapeHtml(String(detail.recent_errors?.length ?? 0))} items</span>
          </div>
          ${
            detail.recent_errors?.length
              ? `<ul class="list-stack">${detail.recent_errors.map((error) => renderErrorItem(error)).join("")}</ul>`
              : '<p class="panel-empty">No recent errors for this pipeline.</p>'
          }
        </section>

        <section class="modal-section">
          <div class="modal-section__header">
            <h3>Active alarms</h3>
            <span class="modal-section__meta">${escapeHtml(String(detail.active_alarms?.length ?? 0))} items</span>
          </div>
          ${
            detail.active_alarms?.length
              ? `<ul class="list-stack">${detail.active_alarms.map((alarm) => renderAlarmItem(alarm)).join("")}</ul>`
              : '<p class="panel-empty">No active alarms for this pipeline.</p>'
          }
        </section>
      </div>

      <section class="modal-section">
        <div class="modal-section__header">
          <h3>Impacted AWS resources</h3>
          <span class="modal-section__meta">${escapeHtml(String(detail.impacted_resources?.length ?? 0))} resources</span>
        </div>
        ${
          detail.impacted_resources?.length
            ? `<div class="resource-grid">${detail.impacted_resources
                .map((resource) => `<code class="resource-chip">${escapeHtml(resource)}</code>`)
                .join("")}</div>`
            : '<p class="panel-empty">No impacted resources were reported.</p>'
        }
      </section>
    </div>
  `;
}

function renderComponentCard(component) {
  return `
    <article class="component-card">
      <div class="component-card__header">
        <div>
          <span class="component-card__area">${escapeHtml(component.area)}</span>
          <h4>${escapeHtml(component.name)}</h4>
        </div>
        ${renderStatusBadge(component.status)}
      </div>
      <code class="component-card__resource">${escapeHtml(component.resource)}</code>
      <p class="component-card__detail">${escapeHtml(component.detail)}</p>
    </article>
  `;
}

function renderErrorItem(error) {
  return `
    <li class="list-item">
      <div class="list-item__header">
        ${renderSeverityPill("high", "Error")}
        <span class="list-item__timestamp">${escapeHtml(formatRelativeTime(error.timestamp))}</span>
      </div>
      <strong class="list-item__title">${escapeHtml(error.service)}</strong>
      <p class="list-item__body">${escapeHtml(error.summary)}</p>
    </li>
  `;
}

function renderAlarmItem(alarm) {
  return `
    <li class="list-item">
      <div class="list-item__header">
        ${renderSeverityPill(alarm.severity)}
        <span class="list-item__timestamp">${escapeHtml(formatRelativeTime(alarm.triggered_at))}</span>
      </div>
      <strong class="list-item__title">${escapeHtml(alarm.name)}</strong>
      <p class="list-item__body">${escapeHtml(alarm.summary)}</p>
      <div class="list-item__meta">
        <span>${escapeHtml(alarm.resource)}</span>
      </div>
    </li>
  `;
}
