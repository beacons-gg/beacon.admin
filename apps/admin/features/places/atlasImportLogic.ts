import {
  placeCategorySchema,
  placeSubcategorySchema,
  type PlaceAtlasImportOptions,
  type PlaceAtlasImportParams,
  type PlaceAtlasPreview,
  type PlaceAtlasSurveyBucket,
  type PlaceAtlasSurveyResult,
  type PlaceAtlasSurveyVariant,
  type PlaceCategory,
} from "@beaconsgg/protocol-types";

/**
 * Pure logic behind the Atlas import flow (unit-tested; `AtlasImportCard` stays render-only): the
 * place-type table built from a survey, the selection mapped onto the wire's `categories` and
 * `options`, and the estimates, which are computed from the params actually sent so the summary
 * describes the run the server will perform, not the one the checkboxes suggest.
 */

/** The wire caps (`placeAtlasImportParamsSchema`), restated where the console refuses early. */
export const MAX_IMPORT_CELLS = 64;
export const MAX_IMPORT_CATEGORIES = 16;
export const MAX_IMPORT_SKIP_TYPES = 256;

/** How a volume was named. `url` may be a volume root; see {@link resolveAtlasTarget}. */
export type AtlasTarget = { url: string } | { staged: string } | { path: string };

/**
 * The target import and survey must name: for a URL, the version the inspect resolved it to, so a
 * root URL whose `latest.json` moves between preview and import still imports what was previewed.
 * An older server reports no `versionUrl`, and the typed URL is all there is.
 */
export function resolveAtlasTarget(
  target: AtlasTarget,
  preview: Pick<PlaceAtlasPreview, "versionUrl">,
): AtlasTarget {
  return "url" in target ? { url: preview.versionUrl ?? target.url } : target;
}

/** The subcategory row key for a category's places that have no subcategory (a slug is never empty). */
export const NO_SUBCATEGORY = "";

/** One row of the place-type table: a category and the subcategory keys the survey saw under it. */
export interface AtlasTypeRow {
  category: string;
  /** `false` when the server cannot import the category; such places are dropped whatever is chosen. */
  supported: boolean;
  /** Sorted subcategory slugs, with {@link NO_SUBCATEGORY} last when some places have none. */
  subcategories: string[];
}

const bySlug = (a: string, b: string) => a.localeCompare(b);

/** The survey's buckets folded into one row per category. */
export function typeRowsFromSurvey(
  result: Pick<PlaceAtlasSurveyResult, "buckets">,
): AtlasTypeRow[] {
  const rows = new Map<string, { supported: boolean; subs: Set<string> }>();
  for (const bucket of result.buckets) {
    const row = rows.get(bucket.category) ?? { supported: bucket.supported, subs: new Set() };
    row.supported &&= bucket.supported;
    row.subs.add(bucket.subcategory ?? NO_SUBCATEGORY);
    rows.set(bucket.category, row);
  }
  return [...rows]
    .map(([category, { supported, subs }]) => {
      const named = [...subs].filter((s) => s !== NO_SUBCATEGORY).sort(bySlug);
      return {
        category,
        supported,
        subcategories: subs.has(NO_SUBCATEGORY) ? [...named, NO_SUBCATEGORY] : named,
      };
    })
    .sort((a, b) => bySlug(a.category, b.category));
}

/**
 * Rows for a server without the survey op: the preview's category list, with no subcategories
 * (the preview does not say which category a subcategory belongs to). Support is judged by the
 * console's own vocabulary, which is what the wire validates `categories` against.
 */
export function typeRowsFromPreview(
  preview: Pick<PlaceAtlasPreview, "categories">,
): AtlasTypeRow[] {
  return [...new Set(preview.categories ?? [])].sort(bySlug).map((category) => ({
    category,
    supported: placeCategorySchema.safeParse(category).success,
    subcategories: [],
  }));
}

/** Selected categories mapped to their selected subcategory keys. An absent category is not selected. */
export type AtlasTypeSelection = Readonly<Record<string, readonly string[]>>;

/** Every supported category with every subcategory: the "take everything" starting point. */
export function selectAllTypes(rows: readonly AtlasTypeRow[]): AtlasTypeSelection {
  return Object.fromEntries(
    rows.filter((r) => r.supported).map((r) => [r.category, [...r.subcategories]]),
  );
}

/** Tick or untick a whole category. */
export function toggleCategory(
  selection: AtlasTypeSelection,
  row: AtlasTypeRow,
  on: boolean,
): AtlasTypeSelection {
  const next = { ...selection };
  if (on) next[row.category] = [...row.subcategories];
  else delete next[row.category];
  return next;
}

/** Tick or untick one subcategory; unticking the last one unticks the category. */
export function toggleSubcategory(
  selection: AtlasTypeSelection,
  row: AtlasTypeRow,
  sub: string,
  on: boolean,
): AtlasTypeSelection {
  const current = new Set(selection[row.category] ?? []);
  if (on) current.add(sub);
  else current.delete(sub);
  const next = { ...selection };
  if (current.size === 0) delete next[row.category];
  else next[row.category] = row.subcategories.filter((s) => current.has(s));
  return next;
}

/** One `options.skipTypes` pair: no `subcategory` means the category's places that have none. */
export type AtlasSkipType = NonNullable<PlaceAtlasImportOptions["skipTypes"]>[number];

/** The type half of the import params, plus why the selection cannot be sent, if it cannot. */
export interface AtlasWireTypes {
  /** Absent when every supported category is selected. */
  categories?: PlaceCategory[];
  /** The unticked rows inside selected categories; absent when there are none. */
  skipTypes?: AtlasSkipType[];
  /** Reasons the selection cannot be sent at all. */
  problems: string[];
}

/**
 * The selection → `categories` + `options.skipTypes`. A whole category left out goes in
 * `categories` (which also scopes retirement); a row unticked inside a selected category becomes an
 * exact skip pair. Each is sent only when it narrows, so the common "everything" import carries
 * neither and the run's record reads as a whole-volume import.
 */
export function wireTypes(
  rows: readonly AtlasTypeRow[],
  selection: AtlasTypeSelection,
): AtlasWireTypes {
  const supported = rows.filter((r) => r.supported);
  const chosen = supported.filter((r) => r.category in selection);
  const out: AtlasWireTypes = { problems: [] };
  if (supported.length > 0 && chosen.length === 0) {
    out.problems.push("Choose at least one place type.");
    return out;
  }

  const skipTypes = chosen.flatMap((r) => {
    const ticked = new Set(selection[r.category] ?? []);
    return r.subcategories
      .filter((sub) => !ticked.has(sub))
      .map((sub) => ({
        category: r.category as PlaceCategory,
        ...(sub === NO_SUBCATEGORY ? {} : { subcategory: sub }),
      }));
  });
  const named = [
    ...(chosen.length < supported.length ? chosen : []),
    ...chosen.filter((r) => skipTypes.some((t) => t.category === r.category)),
  ].filter((r) => !placeCategorySchema.safeParse(r.category).success);
  if (named.length > 0) {
    const spelled = [...new Set(named.map((r) => r.category))].join(", ");
    out.problems.push(
      `This console cannot name ${spelled} in a filter; select all of it, and every type, to import it.`,
    );
  }

  if (chosen.length < supported.length) {
    if (chosen.length > MAX_IMPORT_CATEGORIES) {
      out.problems.push(
        `A filter can name at most ${MAX_IMPORT_CATEGORIES} place types (${chosen.length} selected); select all of them or fewer.`,
      );
    }
    out.categories = chosen.map((r) => r.category as PlaceCategory);
  }

  if (skipTypes.length > 0) {
    const invalid = skipTypes.flatMap((t) =>
      t.subcategory !== undefined && !placeSubcategorySchema.safeParse(t.subcategory).success
        ? [t.subcategory]
        : [],
    );
    if (invalid.length > 0) {
      out.problems.push(`Not subcategory slugs the server accepts: ${invalid.join(", ")}.`);
    }
    if (skipTypes.length > MAX_IMPORT_SKIP_TYPES) {
      out.problems.push(
        `An import can skip at most ${MAX_IMPORT_SKIP_TYPES} subcategories (${skipTypes.length} unticked). Untick whole place types instead, or tick some subcategories back.`,
      );
    }
    out.skipTypes = skipTypes;
  }
  return out;
}

/** The yes/no content filters, as the operator sets them: `true` skips places lacking the thing. */
export interface AtlasContentFilters {
  requirePhotos: boolean;
  requireName: boolean;
  requireDescription: boolean;
}

export const NO_CONTENT_FILTERS: AtlasContentFilters = {
  requirePhotos: false,
  requireName: false,
  requireDescription: false,
};

/** Whether a survey variant's places survive the content filters. */
export function variantPasses(v: PlaceAtlasSurveyVariant, filters: AtlasContentFilters): boolean {
  return (
    (!filters.requirePhotos || v.hasPhotos) &&
    (!filters.requireName || v.hasName) &&
    (!filters.requireDescription || v.hasDescription)
  );
}

/** Places, places with photos, and photo files in some buckets, under the content filters. */
export interface AtlasTally {
  places: number;
  withPhotos: number;
  photoFiles: number;
}

export function tallyBuckets(
  buckets: readonly PlaceAtlasSurveyBucket[],
  filters: AtlasContentFilters,
): AtlasTally {
  const tally: AtlasTally = { places: 0, withPhotos: 0, photoFiles: 0 };
  for (const bucket of buckets) {
    for (const v of bucket.variants) {
      if (!variantPasses(v, filters)) continue;
      tally.places += v.places;
      if (v.hasPhotos) tally.withPhotos += v.places;
      tally.photoFiles += v.photoFiles;
    }
  }
  return tally;
}

/** Whether a bucket's places are in scope of the type params as sent. */
export function bucketInScope(
  bucket: PlaceAtlasSurveyBucket,
  types: Pick<AtlasWireTypes, "categories" | "skipTypes">,
): boolean {
  if (!bucket.supported) return false;
  if (types.categories && !(types.categories as string[]).includes(bucket.category)) return false;
  // A pair matches exactly: one without a subcategory matches only places that have none.
  return !types.skipTypes?.some(
    (t) => t.category === bucket.category && t.subcategory === bucket.subcategory,
  );
}

export interface AtlasImportEstimate {
  places: number;
  photoFiles: number;
  /** The photo files at the survey's average file size. */
  mediaBytes: number;
  /** The selected places' share of the area's tile data: the place records themselves. */
  dataBytes: number;
}

/**
 * What the import will take: exact place and photo-file counts (summed over the variants in scope
 * that pass the filters), and the photo bytes at the area's average file size.
 */
export function estimateImport(
  result: PlaceAtlasSurveyResult,
  types: Pick<AtlasWireTypes, "categories" | "skipTypes">,
  filters: AtlasContentFilters,
): AtlasImportEstimate {
  const { places, photoFiles } = tallyBuckets(
    result.buckets.filter((b) => bucketInScope(b, types)),
    filters,
  );
  const perFile = result.photoFiles > 0 ? result.mediaBytesEstimate / result.photoFiles : 0;
  const perPlace = result.places > 0 ? result.tileBytes / result.places : 0;
  return {
    places,
    photoFiles,
    mediaBytes: Math.round(photoFiles * perFile),
    dataBytes: Math.round(places * perPlace),
  };
}

/** The content filters, each with the noun the run summary names it by. */
const CONTENT_FILTERS = [
  ["requirePhotos", "photo", "places without photos"],
  ["requireName", "name", "unnamed places"],
  ["requireDescription", "description", "places without a description"],
] as const satisfies readonly (readonly [keyof AtlasContentFilters, string, string])[];

/**
 * Whether any of the photo, name or description filters is on: what `retireFiltered` acts on. Takes
 * the form's filters or the options built from them.
 */
export function anyContentFilter(
  filters: { [K in keyof AtlasContentFilters]?: boolean | undefined } | undefined,
): boolean {
  return CONTENT_FILTERS.some(([key]) => filters?.[key]);
}

/** The three import switches, in the order the form and the confirm summary show them. */
export const SWITCH_KEYS = [
  "importPhotos",
  "retireMissing",
  "retireFiltered",
  "retireUnselectedTypes",
] as const;
export type AtlasSwitchKey = (typeof SWITCH_KEYS)[number];

/**
 * A switch's state. `unavailable` (disabled) is retireFiltered with no content filter set, or
 * retireUnselectedTypes with every place type selected.
 */
export type AtlasSwitchState = "on" | "off" | "unavailable";

/**
 * Each switch's words: the label says what On does, the hint says what this import will do in the
 * current state (under the switch), the effect says the same in short (in the confirm summary).
 * Only the two clean-up switches have an `unavailable` state.
 */
const SWITCH_COPY: Record<
  AtlasSwitchKey,
  {
    label: string;
    hint: Partial<Record<AtlasSwitchState, string>>;
    effect: Partial<Record<AtlasSwitchState, string>>;
  }
> = {
  importPhotos: {
    label: "Download photo files",
    hint: {
      // The estimate, when there is one, is appended by `switchHint`.
      on: "This import downloads the photos for these places that the server does not have yet",
      off: "This import brings in the places without their photos. Photos a place already has are kept.",
    },
    effect: {
      on: "photos the server does not have yet are downloaded",
      off: "places only; photos a place already has are kept",
    },
  },
  retireMissing: {
    label: "Retire places missing from this version",
    hint: {
      on: "Places an earlier import of this volume brought in that this version no longer has are retired. Only in the map cells this import reads, which can reach a little past the area, and in the place categories selected. A place with an admin edit or a player contribution stays live.",
      off: "Places this version no longer has are kept, even though the volume dropped them.",
    },
    effect: {
      on: "places this version no longer has are retired, in the map cells this import reads",
      off: "places this version no longer has are kept",
    },
  },
  retireFiltered: {
    label: "Retire places these filters skip",
    hint: {
      on: "Places an earlier import of this volume brought in that these filters now skip, such as places without photos, are retired. Only inside the area from step 3 (never a place that only shares a map cell with it), never for place types you left out, and never a place with an admin edit or a player contribution.",
      off: "Places these filters skip are left as they are, even when an earlier import brought them in.",
      unavailable: "Set one of the filters above to Skip to use this.",
    },
    effect: {
      on: "places the filters skip are retired, inside the area",
      off: "places the filters skip are left as they are",
      unavailable: "no filter is set to Skip",
    },
  },
  retireUnselectedTypes: {
    label: "Retire place types left out",
    hint: {
      on: "Places an earlier import of this volume brought in whose type is not selected above, such as surveillance, are retired, including types this version no longer has. Only inside the area from step 3 (never a place that only shares a map cell with it), and never a place with an admin edit or a player contribution.",
      off: "Places of the types you left out are left as they are, even when an earlier import brought them in.",
      unavailable: "Leave out a place type above to use this.",
    },
    effect: {
      on: "places of any type not selected are retired, inside the area",
      off: "places of the types left out are left as they are",
      unavailable: "every place type is selected",
    },
  },
};

/**
 * What the switches read: the import's `categories` and the `options` built for it, the same two
 * fields the import params carry.
 */
export type AtlasSwitchInput = Pick<PlaceAtlasImportParams, "categories" | "options">;

/** Whether the import leaves out any place type: a category not taken, or a skipped type. */
export function anyTypeLeftOut(input: {
  categories?: readonly string[] | undefined;
  skipTypes?: readonly AtlasSkipType[] | undefined;
}): boolean {
  return (input.categories?.length ?? 0) > 0 || (input.skipTypes?.length ?? 0) > 0;
}

/** A switch's label. */
export function switchLabel(key: AtlasSwitchKey): string {
  return SWITCH_COPY[key].label;
}

/**
 * A switch's state, read from what the import sends (`buildImportOptions` and the categories), so
 * the form and the summary can only show what goes over the wire.
 */
export function switchState(key: AtlasSwitchKey, input: AtlasSwitchInput): AtlasSwitchState {
  const { options } = input;
  switch (key) {
    case "importPhotos":
      return options?.importPhotos !== false ? "on" : "off";
    case "retireMissing":
      return options?.retireMissing !== false ? "on" : "off";
    case "retireFiltered":
      if (options?.retireFiltered) return "on";
      return anyContentFilter(options) ? "off" : "unavailable";
    case "retireUnselectedTypes":
      if (options?.retireUnselectedTypes) return "on";
      return anyTypeLeftOut({ categories: input.categories, skipTypes: options?.skipTypes })
        ? "off"
        : "unavailable";
  }
}

/** What this import will do with a switch in `state`: the text under the switch. */
export function switchHint(
  key: AtlasSwitchKey,
  state: AtlasSwitchState,
  estimate?: Pick<AtlasImportEstimate, "photoFiles" | "mediaBytes">,
): string {
  const hint = SWITCH_COPY[key].hint[state] ?? "";
  if (key !== "importPhotos" || state !== "on") return hint;
  return estimate
    ? `${hint}: up to ${estimate.photoFiles.toLocaleString()} files, about ${formatBytes(estimate.mediaBytes)}.`
    : `${hint}.`;
}

/** One switch as the confirm summary states it: its label, whether it is on, and what that does. */
export interface AtlasSwitchSummary {
  key: AtlasSwitchKey;
  label: string;
  on: boolean;
  effect: string;
}

/** The switches as the confirm summary states them, read from what the import sends. */
export function describeSwitches(input: AtlasSwitchInput): AtlasSwitchSummary[] {
  return SWITCH_KEYS.map((key) => {
    const state = switchState(key, input);
    return {
      key,
      label: switchLabel(key),
      on: state === "on",
      effect: SWITCH_COPY[key].effect[state] ?? "",
    };
  });
}

/** The content filters the import sends, in words: `places without photos, unnamed places`. */
export function describeSkipped(options: PlaceAtlasImportOptions | undefined): string[] {
  return CONTENT_FILTERS.filter(([key]) => options?.[key]).map(([, , phrase]) => phrase);
}

/** The operator's choices, as `options`: only what differs from the default, absent when nothing does. */
export function buildImportOptions(input: {
  skipTypes?: AtlasSkipType[] | undefined;
  filters: AtlasContentFilters;
  importPhotos: boolean;
  retireMissing: boolean;
  /** Sent only with a content filter on: without one there is nothing for it to retire. */
  retireFiltered: boolean;
  /** Read only to gate `retireUnselectedTypes`: categories go on the params, not the options. */
  categories?: readonly string[] | undefined;
  /** Sent only with a place type left out: otherwise there is nothing for it to retire. */
  retireUnselectedTypes: boolean;
}): PlaceAtlasImportOptions | undefined {
  const options: PlaceAtlasImportOptions = {
    ...(input.skipTypes ? { skipTypes: input.skipTypes } : {}),
    ...(input.filters.requirePhotos ? { requirePhotos: true } : {}),
    ...(input.filters.requireName ? { requireName: true } : {}),
    ...(input.filters.requireDescription ? { requireDescription: true } : {}),
    ...(input.importPhotos ? {} : { importPhotos: false }),
    ...(input.retireMissing ? {} : { retireMissing: false }),
    ...(input.retireFiltered && anyContentFilter(input.filters) ? { retireFiltered: true } : {}),
    ...(input.retireUnselectedTypes &&
    anyTypeLeftOut({ categories: input.categories, skipTypes: input.skipTypes })
      ? { retireUnselectedTypes: true }
      : {}),
  };
  return Object.keys(options).length > 0 ? options : undefined;
}

/**
 * The whole `places.atlas.import` params for a confirmed flow. `options` is what
 * `buildImportOptions` built from the form, the same object the form and the summary read.
 */
export function buildImportParams(input: {
  target: AtlasTarget;
  preview: Pick<PlaceAtlasPreview, "publisher" | "versionUrl">;
  cells: string[];
  categories?: AtlasWireTypes["categories"];
  options: PlaceAtlasImportOptions | undefined;
}): PlaceAtlasImportParams {
  return {
    ...resolveAtlasTarget(input.target, input.preview),
    publisher: input.preview.publisher,
    ...(input.cells.length > 0 ? { cells: input.cells } : {}),
    ...(input.categories ? { categories: input.categories } : {}),
    ...(input.options ? { options: input.options } : {}),
  };
}

/** `park · playground`, or `park (no subcategory)` for a pair without one. */
export function skipTypeLabel(t: AtlasSkipType): string {
  return t.subcategory === undefined
    ? `${t.category} (no subcategory)`
    : `${t.category} · ${t.subcategory}`;
}

/** A recorded run's options as short phrases, for the runs list. Defaults say nothing. */
export function describeImportOptions(
  options: PlaceAtlasImportOptions | undefined,
  /** The run's categories: retireUnselectedTypes is worded only when a type was left out. */
  categories?: readonly string[] | undefined,
): string[] {
  if (!options) return [];
  return [
    ...(options.skipTypes ? [`skips ${options.skipTypes.map(skipTypeLabel).join(", ")}`] : []),
    ...describeSkipped(options).map((phrase) => `skips ${phrase}`),
    ...(options.importPhotos === false ? ["photo files not downloaded"] : []),
    ...(options.retireMissing === false ? ["places missing from the version kept"] : []),
    ...retiresFilteredPhrase(options),
    ...(options.retireUnselectedTypes &&
    anyTypeLeftOut({ categories, skipTypes: options.skipTypes })
      ? ["retires places already imported of the types left out, inside the area"]
      : []),
  ];
}

/**
 * `retires places already imported that are skipped by the photo and name filters, inside the
 * area`, or nothing when no content filter is on (retireFiltered then had nothing to act on).
 */
function retiresFilteredPhrase(options: PlaceAtlasImportOptions): string[] {
  if (!options.retireFiltered) return [];
  const on = CONTENT_FILTERS.filter(([key]) => options[key]).map(([, noun]) => noun);
  if (on.length === 0) return [];
  const nouns =
    on.length === 1
      ? `the ${on[0]!} filter`
      : `the ${on.slice(0, -1).join(", ")} and ${on.at(-1)!} filters`;
  return [`retires places already imported that are skipped by ${nouns}, inside the area`];
}

/** `0 B` / `812 KB` / `1.4 GB`, decimal units like the rest of the console. */
export function formatBytes(bytes: number): string {
  if (bytes < 1e3) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1e3;
  let unit = 0;
  while (value >= 1e3 && unit < units.length - 1) {
    value /= 1e3;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
