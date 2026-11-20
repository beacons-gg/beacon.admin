/**
 * Hand the operator a JSON file.
 *
 * Lifted out of the two export cards that had byte-identical copies of the object-URL dance. Small,
 * but the browser half is easy to get subtly wrong — a `revokeObjectURL` that never runs leaks the
 * blob for the life of the document, and both copies would have to be fixed.
 */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** `beacon-places-example.com-2026-08-09.json` — the shape both exports name their file. */
export function exportFilename(prefix: string, origin: string, at = new Date()): string {
  return `${prefix}-${new URL(origin).hostname}-${at.toISOString().slice(0, 10)}.json`;
}
