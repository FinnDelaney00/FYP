import { escapeHtml } from "../utils/dom.js";

// Severity tones are intentionally aligned with the alarm/list palette so all
// urgency indicators share the same color language.
const SEVERITY_META = {
  critical: {
    tone: "critical",
    label: "Critical"
  },
  high: {
    tone: "high",
    label: "High"
  },
  medium: {
    tone: "medium",
    label: "Medium"
  },
  low: {
    tone: "low",
    label: "Low"
  }
};

/**
 * Renders a severity pill with an optional custom label.
 *
 * @param {string | null | undefined} severity
 * @param {string | undefined} label
 * @returns {string}
 */
export function renderSeverityPill(severity, label) {
  const key = String(severity ?? "low").toLowerCase();
  const meta = SEVERITY_META[key] ?? SEVERITY_META.low;
  const text = label ?? meta.label;

  return `<span class="severity-pill severity-pill--${meta.tone}">${escapeHtml(text)}</span>`;
}
