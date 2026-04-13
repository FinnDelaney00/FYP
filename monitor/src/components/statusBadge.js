import { escapeHtml } from "../utils/dom.js";
import { getStatusMeta } from "../utils/status.js";

/**
 * Renders a status badge using the normalized status metadata.
 *
 * @param {string | null | undefined} status
 * @param {string | undefined} label
 * @returns {string}
 */
export function renderStatusBadge(status, label) {
  const meta = getStatusMeta(status);
  const text = label ?? meta.label;

  return `<span class="status-badge status-badge--${meta.tone}">${escapeHtml(text)}</span>`;
}
