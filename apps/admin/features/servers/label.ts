/** The fields a display label reads, so callers can pass a saved server or a bare descriptor. */
export interface LabelledServer {
  host: string;
  name?: string | undefined;
}

/**
 * How a server is named on screen: its operator's display name, or the `@host` authority when there
 * is not one.
 *
 * `name ?? host` is the tempting spelling and it is wrong. `serverDescriptorSchema.name` is
 * `z.string().optional()` with no `.min(1)`, so `"name": ""` is a descriptor that verifies and gets
 * pinned by `probeServer`; `??` falls back only on null and undefined, so an empty name renders as
 * an empty label. That is worst in the places a server is named *instead of* being shown, like a
 * capability refusal, where nothing else on screen identifies the box being talked about.
 *
 * One function because the rule was written out nine times across this console, and a rule copied
 * nine times is a rule that gets fixed in one place and stays broken in eight. The game client has
 * its own `serverLabel` with a different fallback (the origin, not the `@host`), so this is the one
 * place a server is named *here*, not repo-wide; hoisting the shared `name?.trim() || fallback` next
 * to `serverDescriptorSchema` would be a protocol-package change and wants its own issue.
 */
export function serverLabel(server: LabelledServer): string {
  return server.name?.trim() || server.host;
}
