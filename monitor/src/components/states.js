import { escapeHtml } from "../utils/dom.js";

/**
 * Renders a loading placeholder for sections awaiting async data.
 *
 * @param {string} title
 * @param {string} message
 * @returns {string}
 */
export function renderLoadingState(title, message) {
  return `
    <div class="state-card">
      <span class="state-card__spinner" aria-hidden="true"></span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

/**
 * Renders a neutral empty-state card.
 *
 * @param {string} title
 * @param {string} message
 * @returns {string}
 */
export function renderEmptyState(title, message) {
  return `
    <div class="state-card state-card--empty">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

/**
 * Renders an error-state card for failed requests.
 *
 * @param {string} title
 * @param {string} message
 * @returns {string}
 */
export function renderErrorState(title, message) {
  return `
    <div class="state-card state-card--error">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}
