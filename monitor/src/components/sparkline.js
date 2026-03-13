import { normalizeStatus } from "../utils/status.js";

export function renderSparkline(history = []) {
  if (!history.length) {
    return '<div class="sparkline sparkline--empty"><span class="sparkline__empty">No history</span></div>';
  }

  return `
    <div class="sparkline" aria-label="Recent pipeline status history">
      ${history
        .map(
          (status, index) =>
            `<span class="sparkline__bar sparkline__bar--${normalizeStatus(status)}" title="Window ${
              index + 1
            }: ${normalizeStatus(status)}"></span>`
        )
        .join("")}
    </div>
  `;
}
