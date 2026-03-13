const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

export function formatTimestamp(value) {
  if (!value) {
    return "No signal";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid time";
  }

  return TIMESTAMP_FORMATTER.format(date);
}

export function formatRelativeTime(value) {
  if (!value) {
    return "No signal";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60_000);

  if (Math.abs(diffMinutes) < 1) {
    return "Just now";
  }

  if (Math.abs(diffMinutes) < 60) {
    return diffMinutes > 0 ? `${diffMinutes}m ago` : `in ${Math.abs(diffMinutes)}m`;
  }

  const diffHours = Math.round(diffMinutes / 60);

  if (Math.abs(diffHours) < 24) {
    return diffHours > 0 ? `${diffHours}h ago` : `in ${Math.abs(diffHours)}h`;
  }

  const diffDays = Math.round(diffHours / 24);
  return diffDays > 0 ? `${diffDays}d ago` : `in ${Math.abs(diffDays)}d`;
}

export function formatLag(minutes) {
  if (minutes == null || Number.isNaN(Number(minutes))) {
    return "n/a";
  }

  const wholeMinutes = Math.round(Number(minutes));

  if (wholeMinutes < 60) {
    return `${wholeMinutes} min`;
  }

  const hours = Math.floor(wholeMinutes / 60);
  const remainder = wholeMinutes % 60;

  if (!remainder) {
    return `${hours}h`;
  }

  return `${hours}h ${remainder}m`;
}
