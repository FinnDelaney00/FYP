import { escapeHtml } from "../utils/dom.js";

const CARD_DEFINITIONS = [
  {
    key: "total_pipelines",
    label: "Total pipelines",
    tone: "neutral"
  },
  {
    key: "healthy",
    label: "Healthy",
    tone: "healthy"
  },
  {
    key: "degraded",
    label: "Degraded",
    tone: "degraded"
  },
  {
    key: "down",
    label: "Down",
    tone: "down"
  },
  {
    key: "active_alarms",
    label: "Active alarms",
    tone: "warning"
  }
];

export function renderSummaryCards(overview) {
  return CARD_DEFINITIONS.map((card) => {
    const value = overview?.[card.key] ?? 0;

    return `
      <article class="panel summary-card summary-card--${card.tone}">
        <span class="summary-card__label">${escapeHtml(card.label)}</span>
        <strong class="summary-card__value">${escapeHtml(String(value))}</strong>
      </article>
    `;
  }).join("");
}
