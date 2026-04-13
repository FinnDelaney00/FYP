import { escapeHtml } from "../utils/dom.js";

// Card order is fixed so overview metrics always land in a predictable place.
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

/**
 * Renders the overview summary cards from the aggregated monitor snapshot.
 *
 * @param {Record<string, number>} overview
 * @returns {string}
 */
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
