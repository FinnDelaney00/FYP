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

export function normalizeStatus(status) {
  const key = String(status ?? "unknown").toLowerCase();
  return STATUS_META[key] ? key : "unknown";
}

export function getStatusMeta(status) {
  return STATUS_META[normalizeStatus(status)];
}

export function compareStatusSeverity(leftStatus, rightStatus) {
  return getStatusMeta(leftStatus).priority - getStatusMeta(rightStatus).priority;
}
