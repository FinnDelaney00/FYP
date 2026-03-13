import { escapeHtml } from "../utils/dom.js";

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

export function renderSeverityPill(severity, label) {
  const key = String(severity ?? "low").toLowerCase();
  const meta = SEVERITY_META[key] ?? SEVERITY_META.low;
  const text = label ?? meta.label;

  return `<span class="severity-pill severity-pill--${meta.tone}">${escapeHtml(text)}</span>`;
}
