import { renderSeverityPill } from "./severityPill.js";
import { escapeHtml } from "../utils/dom.js";
import { formatRelativeTime } from "../utils/formatters.js";

/**
 * Renders the log summary rail, showing the highest-signal entries from the
 * latest 15-minute window.
 *
 * @param {Array<object>} entries
 * @returns {string}
 */
export function renderLogSummaryPanel(entries) {
  if (!entries.length) {
    return '<p class="panel-empty">No elevated log volume detected in the current window.</p>';
  }

  return `
    <ul class="list-stack">
      ${entries.slice(0, 4).map((entry) => renderLogEntry(entry)).join("")}
    </ul>
  `;
}

/**
 * Renders a single service log summary entry.
 *
 * @param {object} entry
 * @returns {string}
 */
function renderLogEntry(entry) {
  return `
    <li class="list-item">
      <div class="list-item__header">
        ${renderSeverityPill(getSeverityFromLevel(entry.level), entry.level)}
        <span class="list-item__timestamp">${escapeHtml(formatRelativeTime(entry.updated_at))}</span>
      </div>
      <strong class="list-item__title">
        ${escapeHtml(entry.service)} &middot; ${escapeHtml(String(entry.count_15m))} events
      </strong>
      <p class="list-item__body">${escapeHtml(entry.latest_message)}</p>
    </li>
  `;
}

/**
 * Maps log levels to the alarm severity palette used elsewhere in the UI so the
 * side rail reads consistently with the alarms list.
 *
 * @param {string} level
 * @returns {"high" | "medium" | "low"}
 */
function getSeverityFromLevel(level) {
  if (level === "ERROR") {
    return "high";
  }

  if (level === "WARN") {
    return "medium";
  }

  return "low";
}
