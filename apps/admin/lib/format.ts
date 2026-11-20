/** Human byte sizes for store/media counts — one formatter for every dashboard surface. */
export function formatBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

/** `4m02s` / `18s`, a background run's wall clock from its durable stamps. */
export function formatRunDuration(run: {
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
}): string | undefined {
  if (!run.startedAt || !run.finishedAt) return undefined;
  const seconds = Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000);
  if (seconds < 0) return undefined;
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

/** Compact uptime from an ISO start, derived client-side (the descriptor's own rule). */
export function formatUptime(startedAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
