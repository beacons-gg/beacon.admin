import {
  serverAccessLevelSchema,
  type AdminSetting,
  type SettingValue,
} from "@beaconsgg/protocol-types";

/**
 * How each configuration field is presented: which section it belongs to, what to call it, what to
 * say about it, and which control edits it.
 *
 * **This lives in the console rather than on the wire, and the trade is worth stating.** The server
 * sends `key` and `env` and no human copy, so the alternative was `label`/`group`/`kind` fields on
 * `AdminSetting`. Operator-facing copy is this app's voice and the registry's docblocks are written
 * for whoever edits the registry, so the catalog is here. The cost is that nothing forces it to stay
 * in step: a setting added on the server arrives here unlisted.
 *
 * Which is why {@link entryFor}'s fallback is a first-class path and not an exception. A key the
 * server has *added* renders with its key as the label, its variable name beneath it, and a control
 * inferred from the value it carries, in a trailing section, so a missing description is visible to
 * the first person who opens the screen. That is the property that makes a client-side catalog
 * acceptable here where a client-side list of *secrets* would not be.
 *
 * **Only that direction is loud.** A key the server *removes or renames* leaves an entry here that
 * renders nowhere and that nothing can detect, because the key list is `keyof ServerConfig` and the
 * console cannot see it. Closing that would mean publishing the key list in `protocol-types`, which
 * is a change across packages, left for later.
 *
 * Order matches the server's, which sends editable fields first in the registry's grouped
 * declaration order and the read-only ones after, so rendering {@link GROUPS} in order preserves it.
 */

export type SettingKind = "text" | "textarea" | "number" | "boolean" | "list" | "select";

export interface SettingEntry {
  group: string;
  label: string;
  /** One sentence, only where the field's behaviour is not obvious from its name. */
  help?: string | undefined;
  /**
   * The control that edits it. Optional, and omitted for every read-only field: those render their
   * value and never a control, so a `kind` on them would be a claim nothing checks and nothing uses.
   * One was wrong already (`trustProxy` is `boolean | number`, and was written down as text).
   * {@link entryFor} fills it in from the value when it is missing.
   */
  kind?: SettingKind | undefined;
  /** For `select`. */
  options?: readonly string[] | undefined;
  /** For `number`, appended after the input so a millisecond field cannot read as seconds. */
  unit?: string | undefined;
  /**
   * For `textarea`: the server's limit, shown as a running count under the box. The count never
   * stops the typing (see SettingControl's docblock); a value over it is refused by the server with
   * the field's name.
   */
  maxLength?: number | undefined;
  /** For `textarea`: how tall the box opens, and whether it is set in mono for source text. */
  rows?: number | undefined;
  mono?: boolean | undefined;
  /**
   * For `list`: what an empty box means, when empty is not simply the empty list.
   *
   * Only `coverage` has one. `loadConfig` floors it from `[]` to `[""]`, so "everywhere" is spelled
   * as a one-element list holding the empty prefix, and a list editor that dropped empties would
   * make that value unreachable. Everywhere else `[]` is the honest reading of an empty box, and for
   * `games` it is the documented default: empty means open to every game, which an operator
   * who has restricted a server needs to be able to get back to without a redeploy.
   */
  emptyValue?: SettingValue | undefined;
}

/** Section order on screen. `OTHER` is last and holds whatever the catalog has never heard of. */
export const OTHER = "Unlisted";
export const GROUPS = [
  "Identity",
  "Admission",
  "Capabilities",
  "Mailbox",
  "Media",
  "Geocoding",
  "Places",
  "Listen",
  "Database",
  "Server key",
  "Access control",
  "Media storage",
  "Places data",
  "Docs",
  "Home page",
  OTHER,
] as const;

/** Every entry is `group + label + kind` and then whatever else it has to say. */
const e = (
  group: string,
  label: string,
  kind?: SettingKind,
  extra: Partial<SettingEntry> = {},
): SettingEntry => ({ group, label, kind, ...extra });

export const CATALOG: Record<string, SettingEntry> = {
  // --- Identity: what this server says it is, in its signed descriptor. ---------------------
  name: e("Identity", "Display name", "text", {
    help: "Shown to players and operators wherever this server appears.",
  }),
  description: e("Identity", "Description", "textarea", {
    help: "An optional blurb in the signed descriptor. 280 characters.",
  }),
  contact: e("Identity", "Contact", "text", {
    help: "How to reach the operator. Published in the descriptor.",
  }),
  about: e("Identity", "About", "textarea", {
    help: "A longer description in Markdown with links and formatting. Served at /server/about for directories and games to show.",
    maxLength: 8192,
    rows: 10,
    mono: true,
  }),
  coverage: e("Identity", "Coverage", "list", {
    help: "Geohash prefixes this server serves. Leave it empty to serve every cell.",
    emptyValue: [""],
  }),
  accessLevel: e("Identity", "Access level", "select", {
    // Taken from the wire schema rather than written out: the server validates against this exact
    // enum, so a third value added there appears here without anybody remembering to.
    options: serverAccessLevelSchema.options,
    help: "Who may write. Open: anyone. Request: members, and players can ask to join. Private: members you add. Reads stay open. Moving off open admits nobody, so admit your players on the Members page.",
  }),
  publicUrl: e("Identity", "Public URL", "text", {
    help: "The address clients are told to reach this server on.",
  }),

  // --- Admission: who may write here. --------------------------------------------------------
  games: e("Admission", "Games", "list", {
    help: "Game slugs this server takes writes from. Empty means every game. A write that names no game is always refused.",
  }),
  writeLocked: e("Admission", "Write lock", "boolean", {
    help: "Makes the server read-only: players cannot make changes, every other admin write is refused, and room timers and background sweeps pause until it is off. Maps and photos keep loading, but most admin screens are refused too. It cannot be turned on while a place import is running.",
  }),

  // --- Capabilities: which surfaces answer at all. -------------------------------------------
  mailboxEnabled: e("Capabilities", "Mailbox", "boolean"),
  mediaEnabled: e("Capabilities", "Media", "boolean", {
    help: "Turning this on at runtime opens the routes, but snapshots and contributions keep the media handle they were built with until a restart.",
  }),
  geocodeEnabled: e("Capabilities", "Geocoding", "boolean"),
  placesEnabled: e("Capabilities", "Places", "boolean"),
  placesContributionsEnabled: e("Capabilities", "Player contributions", "boolean", {
    help: "Needs Places on. Stored but dormant while it is off.",
  }),
  placesContribExportEnabled: e("Capabilities", "Contribution export", "boolean", {
    help: "Needs Places on. Stored but dormant while it is off.",
  }),

  // --- Mailbox budgets. ----------------------------------------------------------------------
  mailboxTtlSeconds: e("Mailbox", "Message TTL", "number", { unit: "seconds" }),
  mailboxMaxBody: e("Mailbox", "Max body", "number", { unit: "bytes" }),
  mailboxSendMax: e("Mailbox", "Send rate", "number", { unit: "per window" }),
  mailboxSendWindowMs: e("Mailbox", "Send window", "number", { unit: "ms" }),

  // --- Media budgets. ------------------------------------------------------------------------
  mediaMaxBytes: e("Media", "Max upload size", "number", {
    unit: "bytes",
    help: "Can be lowered at runtime but not raised: the JSON body limit is sized from this at boot, so a higher value is clamped until a restart.",
  }),
  mediaTypes: e("Media", "Accepted types", "list", { help: "MIME types this server will store." }),
  mediaQuotaBytes: e("Media", "Per-account quota", "number", { unit: "bytes" }),
  mediaRateMax: e("Media", "Upload rate", "number", { unit: "per window" }),
  mediaRateWindowMs: e("Media", "Upload window", "number", { unit: "ms" }),
  mediaCdnUrl: e("Media", "CDN URL", "text", {
    help: "Media fetches redirect here instead of being served directly.",
  }),

  // --- Geocoding: the provider and the pacing its terms require. -----------------------------
  geoUserAgent: e("Geocoding", "User agent", "text", {
    help: "Sent on every outbound geocode. Nominatim's terms require a real contact here.",
  }),
  geocodeProvider: e("Geocoding", "Provider", "select", {
    // The one restated list on this screen. Its source of truth is `GEOCODE_PROVIDERS` in the
    // server's geocode module, which is not on the wire and not in a shared package, so there is
    // nothing to import. A provider added there and not here shows up as a value this control
    // cannot offer, which is why the catalog test requires every select to have options at all.
    options: ["nominatim"],
    help: "Read at boot. An unknown value stops the server starting, so this list is the only safe set.",
  }),
  geocodeEndpoint: e("Geocoding", "Endpoint", "text"),
  geocodePrecision: e("Geocoding", "Cache precision", "number", { unit: "geohash chars" }),
  geocodeTtlSeconds: e("Geocoding", "Cache TTL", "number", { unit: "seconds" }),
  geocodeNegativeTtlSeconds: e("Geocoding", "Negative cache TTL", "number", { unit: "seconds" }),
  geocodeMinIntervalMs: e("Geocoding", "Minimum interval", "number", {
    unit: "ms",
    help: "Fair-use pacing between outbound requests.",
  }),
  geocodeTimeoutMs: e("Geocoding", "Timeout", "number", { unit: "ms" }),

  // --- Places budgets. -----------------------------------------------------------------------
  placesQueryPageSize: e("Places", "Query page size", "number", { unit: "rows" }),
  placesQueryMaxCells: e("Places", "Max cells per query", "number", {
    unit: "cells",
    help: "The only bound on a public places read, so raising it raises what one request can ask for.",
  }),
  placesTimeoutMs: e("Places", "Query timeout", "number", { unit: "ms" }),
  placesImageMaxBytes: e("Places", "Max image size", "number", { unit: "bytes" }),
  placesImageTimeoutMs: e("Places", "Image fetch timeout", "number", { unit: "ms" }),
  placesImageMinIntervalMs: e("Places", "Image fetch interval", "number", { unit: "ms" }),
  placesProposalRateMax: e("Places", "Proposal rate", "number", { unit: "per window" }),
  placesProposalRateWindowMs: e("Places", "Proposal window", "number", { unit: "ms" }),
  placesProposalMaxPending: e("Places", "Max pending proposals", "number", { unit: "per account" }),

  // --- Read-only: deploy shape, secrets, and the controls that protect the others. ------------
  port: e("Listen", "Port"),
  host: e("Listen", "Host authority", undefined, {
    help: "Baked into every room id this server mints, so it cannot move.",
  }),
  version: e("Listen", "Version"),
  databaseUrl: e("Database", "Database URL"),
  pgPoolSize: e("Database", "Postgres pool size"),
  maxNonces: e("Database", "Nonce log size"),
  mnemonic: e("Server key", "Recovery phrase"),
  keyProvider: e("Server key", "Key provider"),
  keyFile: e("Server key", "Key file"),
  keyPassphrase: e("Server key", "Key passphrase"),
  corsOrigins: e("Access control", "CORS origins"),
  trustProxy: e("Access control", "Trust proxy"),
  admins: e("Access control", "Admin DIDs"),
  mediaBackend: e("Media storage", "Backend"),
  mediaDir: e("Media storage", "Directory"),
  mediaS3Endpoint: e("Media storage", "S3 endpoint"),
  mediaS3Region: e("Media storage", "S3 region"),
  mediaS3Bucket: e("Media storage", "S3 bucket"),
  mediaS3AccessKeyId: e("Media storage", "S3 access key id"),
  mediaS3SecretAccessKey: e("Media storage", "S3 secret access key"),
  mediaS3ForcePathStyle: e("Media storage", "S3 path-style addressing"),
  mediaS3Prefix: e("Media storage", "S3 key prefix"),
  atlasStagingDir: e("Places data", "Atlas staging directory"),
  atlasVolumesDir: e("Places data", "Atlas volumes directory"),
  placesCellPrecision: e("Places data", "Cell precision", undefined, {
    help: "Writes the place index. Changing it is a reindex, not an edit, which is why it is not editable here.",
  }),
  docsEnabled: e("Docs", "Serve API docs"),
  docsPath: e("Docs", "Docs path"),
  homeEnabled: e("Home page", "Serve the home page"),
  homeConsoleUrl: e("Home page", "Console link"),
  homeSiteUrl: e("Home page", "Site link"),
  homeMapTiles: e("Home page", "Map tiles", undefined, {
    help: "Loaded by visitors' browsers, never by the server: the one thing the page fetches from elsewhere.",
  }),
  homeStats: e("Home page", "Room counts", undefined, {
    help: "auto shows them on an open server only.",
  }),
};

/**
 * The control a value's shape implies, for a key the catalog does not list.
 *
 * `undefined` is the interesting case and it is why this takes the whole row: a setting with no
 * value carries no shape either. Every optional runtime setting is a string today, so text is the
 * right guess, and it is a guess the operator can see rather than one that silently mangles a write.
 */
export function inferKind(value: SettingValue | undefined): SettingKind {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "list";
  return "text";
}

/** Turn `placesQueryMaxCells` into `Places query max cells`, for a key nobody has labelled. */
export function humanise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A catalog entry with its control resolved, which is what every consumer actually wants. */
export type ResolvedEntry = SettingEntry & { kind: SettingKind };

/**
 * The catalog entry for a row, with the control filled in, or a loud fallback that says the catalog
 * has not heard of the key at all.
 */
export function entryFor(setting: AdminSetting): ResolvedEntry {
  const entry = CATALOG[setting.key] ?? { group: OTHER, label: humanise(setting.key) };
  return { ...entry, kind: entry.kind ?? inferKind(setting.value) };
}
