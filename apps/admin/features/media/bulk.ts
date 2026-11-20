/**
 * Run `worker` over `items` with bounded concurrency, isolating failures: a rejected item is counted,
 * never aborts the rest. Used by the media browser's bulk review/delete — each item is one signed admin
 * op, so the cap keeps a large selection from bursting past the server's per-IP write-rate window (a
 * throttled tail simply lands in `failed`, and those items stay selected for a retry). The worker does
 * its own per-success bookkeeping (local-state update); this only tallies outcomes.
 */
export async function runBulk<T>(
  items: readonly T[],
  worker: (item: T) => Promise<void>,
  concurrency = 4,
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  let next = 0;
  const pump = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        await worker(item);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => pump()));
  return { ok, failed };
}
