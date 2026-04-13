import { renderSeverityPill } from "./severityPill.js";
import { escapeAttr, escapeHtml } from "../utils/dom.js";
import { formatRelativeTime, formatTimestamp } from "../utils/formatters.js";

/**
 * Renders the alarms rail, capped to the most recent active entries so the side
 * panel stays scannable.
 *
 * @param {Array<object>} alarms
 * @returns {string}
 */
export function renderAlarmsPanel(alarms) {
  const activeAlarms = alarms.slice(0, 5);

  if (!activeAlarms.length) {
    return '<p class="panel-empty">No active alarms. The current snapshot is quiet.</p>';
  }

  return `
    <ul class="list-stack">
      ${activeAlarms.map((alarm) => renderAlarmItem(alarm)).join("")}
    </ul>
  `;
}

/**
 * Renders a single alarm row for the rail list.
 *
 * @param {object} alarm
 * @returns {string}
 */
function renderAlarmItem(alarm) {
  return `
    <li class="list-item">
      <div class="list-item__header">
        ${renderSeverityPill(alarm.severity)}
        <span class="list-item__timestamp" title="${escapeAttr(formatTimestamp(alarm.triggered_at))}">
          ${escapeHtml(formatRelativeTime(alarm.triggered_at))}
        </span>
      </div>
      <strong class="list-item__title">${escapeHtml(alarm.name)}</strong>
      <p class="list-item__body">${escapeHtml(alarm.summary)}</p>
      <div class="list-item__meta">
        <span>${escapeHtml(alarm.pipeline_name)}</span>
        <span>${escapeHtml(alarm.resource)}</span>
      </div>
    </li>
  `;
}
