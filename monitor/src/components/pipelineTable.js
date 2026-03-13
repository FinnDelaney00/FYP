import { renderSparkline } from "./sparkline.js";
import { renderStatusBadge } from "./statusBadge.js";
import { escapeAttr, escapeHtml } from "../utils/dom.js";
import { formatRelativeTime, formatTimestamp } from "../utils/formatters.js";

export function renderPipelineTable(pipelines) {
  return `
    <div class="table-shell">
      <table class="pipeline-table">
        <thead>
          <tr>
            <th>Pipeline</th>
            <th>Overall</th>
            <th>Source</th>
            <th>Processing</th>
            <th>Delivery</th>
            <th>Freshness</th>
            <th>Last success</th>
            <th>Alarms</th>
            <th>History</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${pipelines.map((pipeline) => renderRow(pipeline)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderRow(pipeline) {
  const alarmTone = pipeline.alarm_count > 0 ? "alarm-count--active" : "";

  return `
    <tr>
      <td>
        <div class="pipeline-cell">
          <strong>${escapeHtml(pipeline.name)}</strong>
          <span>${escapeHtml(pipeline.id)}</span>
        </div>
      </td>
      <td>${renderStatusBadge(pipeline.overall_status)}</td>
      <td>${renderStatusBadge(pipeline.source_status)}</td>
      <td>${renderStatusBadge(pipeline.processing_status)}</td>
      <td>${renderStatusBadge(pipeline.delivery_status)}</td>
      <td>${renderStatusBadge(pipeline.freshness_status)}</td>
      <td>
        <div class="timestamp-cell">
          <span>${escapeHtml(formatTimestamp(pipeline.last_success_at))}</span>
          <span>${escapeHtml(formatRelativeTime(pipeline.last_success_at))}</span>
        </div>
      </td>
      <td>
        <span class="alarm-count ${alarmTone}">${escapeHtml(String(pipeline.alarm_count))}</span>
      </td>
      <td>${renderSparkline(pipeline.status_history)}</td>
      <td>
        <button
          class="button button--inline"
          type="button"
          data-action="open-details"
          data-pipeline-id="${escapeAttr(pipeline.id)}"
        >
          Details
        </button>
      </td>
    </tr>
  `;
}
