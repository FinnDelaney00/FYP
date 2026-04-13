// Lower priority numbers represent more severe states so the compare helper can
// sort pipelines from most urgent to least urgent.
const STATUS_META = {
  down: {
    tone: "down",
    label: "Down",
    priority: 0
  },
  degraded: {
    tone: "degraded",
    label: "Degraded",
    priority: 1
  },
  warning: {
    tone: "warning",
    label: "Warning",
    priority: 2
  },
  healthy: {
    tone: "healthy",
    label: "Healthy",
    priority: 3
  },
  unknown: {
    tone: "unknown",
    label: "Unknown",
    priority: 4
  }
};

/**
 * Collapses unknown or mixed-case status values into the canonical tokens used
 * throughout the monitor.
 *
 * @param {string | null | undefined} status
 * @returns {"down" | "degraded" | "warning" | "healthy" | "unknown"}
 */
export function normalizeStatus(status) {
  const key = String(status ?? "unknown").toLowerCase();
  return STATUS_META[key] ? key : "unknown";
}

/**
 * Returns the visual label/tone metadata for a status token.
 *
 * @param {string | null | undefined} status
 * @returns {{ tone: string, label: string, priority: number }}
 */
export function getStatusMeta(status) {
  return STATUS_META[normalizeStatus(status)];
}

/**
 * Compares two statuses by operational severity.
 *
 * @param {string | null | undefined} leftStatus
 * @param {string | null | undefined} rightStatus
 * @returns {number}
 */
export function compareStatusSeverity(leftStatus, rightStatus) {
  return getStatusMeta(leftStatus).priority - getStatusMeta(rightStatus).priority;
}
