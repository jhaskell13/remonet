/** Human-friendly age of a timestamp, e.g. `just now`, `3 min ago`, `2 h ago`, `4 d ago`. */
export function formatRelativeTime(iso: string | null, now = Date.now()) {
  if (iso === null) return 'never';
  const elapsedMs = now - Date.parse(iso);
  if (Number.isNaN(elapsedMs)) return 'unknown';
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** A readable absolute timestamp for tooltips and history rows. */
export function formatTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
