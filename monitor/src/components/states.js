import { escapeHtml } from "../utils/dom.js";

export function renderLoadingState(title, message) {
  return `
    <div class="state-card">
      <span class="state-card__spinner" aria-hidden="true"></span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

export function renderEmptyState(title, message) {
  return `
    <div class="state-card state-card--empty">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

export function renderErrorState(title, message) {
  return `
    <div class="state-card state-card--error">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}
