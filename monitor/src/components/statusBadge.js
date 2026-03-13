import { escapeHtml } from "../utils/dom.js";
import { getStatusMeta } from "../utils/status.js";

export function renderStatusBadge(status, label) {
  const meta = getStatusMeta(status);
  const text = label ?? meta.label;

  return `<span class="status-badge status-badge--${meta.tone}">${escapeHtml(text)}</span>`;
}
