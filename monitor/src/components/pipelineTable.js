import { renderSparkline } from "./sparkline.js";
import { renderStatusBadge } from "./statusBadge.js";
import { escapeAttr, escapeHtml } from "../utils/dom.js";
import { formatRelativeTime, formatTimestamp } from "../utils/formatters.js";

/**
 * Renders the main pipeline health table.
 *
 * @param {Array<object>} pipelines
 * @returns {string}
 */
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

/**
 * Returns the pipeline group, inferring it from the ID when pipeline_group is absent.
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
 * Renders the group badge shown below the pipeline ID in the name cell.
 *
 * @param {object} pipeline
 * @returns {string}
 */
function renderGroupBadge(pipeline) {
  const group = resolvePipelineGroup(pipeline);

  return `<span class="pipeline-group-badge pipeline-group-badge--${escapeHtml(group)}">${escapeHtml(group)}</span>`;
}

/**
 * Renders a single pipeline table row, including the detail action and status
 * history sparkline.
 *
 * @param {object} pipeline
 * @returns {string}
 */
function renderRow(pipeline) {
  const alarmTone = pipeline.alarm_count > 0 ? "alarm-count--active" : "";

  return `
    <tr>
      <td>
        <div class="pipeline-cell">
          <strong>${escapeHtml(pipeline.name)}</strong>
          <span>${escapeHtml(pipeline.id)}</span>
          ${renderGroupBadge(pipeline)}
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
