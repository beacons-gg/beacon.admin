import {
  geohashCellSchema,
  geohashPrefixSchema,
  latLngSchema,
  mediaPairs,
  originForHost,
  parseGlobalId,
  type LatLng,
  type Media,
  type PlaceCategory,
  type PlaceTaxonomy,
} from "@beaconsgg/protocol-types";

/**
 * Pure input-parsing for the places UI (unit-tested; the components stay render-only). Both
 * parsers validate through the WIRE schemas, so the console can't send a request the server
 * would reject anyway.
 */

/** A CSV of geohash cells → the valid, normalized list (junk and non-geohash chars dropped). */
export function parseCells(input: string): string[] {
  return input
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => geohashCellSchema.safeParse(c).success);
}

/**
 * A comma/space list of coverage-style geohash prefixes → the valid, deduped list plus what was
 * refused. Unlike {@link parseCells}, junk is REPORTED rather than dropped: a silently-dropped typo
 * here would quietly widen an Atlas import from "my coverage" to the whole volume.
 */
export function parseGeohashPrefixes(input: string): { prefixes: string[]; invalid: string[] } {
  const prefixes = new Set<string>();
  const invalid: string[] = [];
  for (const token of input
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)) {
    if (geohashPrefixSchema.safeParse(token).success) prefixes.add(token);
    else invalid.push(token);
  }
  return { prefixes: [...prefixes], invalid };
}

/** Resolve a content address `<hash>@host` to its public media URL (scheme-on-read). */
export function mediaUrl(uri: string): string | undefined {
  try {
    const { unique, host } = parseGlobalId(uri);
    return `${originForHost(host)}/media/${unique}`;
  } catch {
    return undefined;
  }
}

/** One displayable place photo: the resolved thumb + the full-size link + its credit line. */
export interface PlaceImage {
  thumb: string;
  full: string;
  credit?: string | undefined;
}

/**
 * A place's photos as the UI shows them: each pair resolved to URLs — the thumb renders, the full
 * is the click-through (a pair with no full links to itself). `credit` is the display line CC
 * licensing requires.
 */
export function placeImages(media: readonly Media[] | undefined): PlaceImage[] {
  return mediaPairs(media).flatMap((pair) => {
    const primary = pair[0]!;
    const thumb = mediaUrl(primary.uris[0] ?? "");
    if (!thumb) return [];
    const credit = [primary.credit?.author, primary.credit?.license].filter(Boolean).join(" · ");
    return [
      {
        thumb,
        full: mediaUrl(pair[1]?.uris[0] ?? "") ?? thumb,
        ...(credit ? { credit } : {}),
      },
    ];
  });
}

/** The badge label: `category · subcategory`, suppressing the slug when it adds nothing. */
export function categoryLabel(p: { category: string; subcategory?: string | undefined }): string {
  return p.subcategory && p.subcategory !== p.category
    ? `${p.category} · ${p.subcategory}`
    : p.category;
}

/**
 * A category's curated subcategory slugs, from the server's vocabulary. Empty until a category is
 * picked (slugs are namespaced per category) or while the vocabulary is still loading.
 */
export function subcategoriesFor(
  taxonomy: PlaceTaxonomy | undefined,
  category: PlaceCategory | "",
): string[] {
  if (!category) return [];
  return taxonomy?.categories.find((c) => c.category === category)?.subcategories ?? [];
}

/**
 * Two coordinate inputs → a wire-valid point, or `undefined`. Validated through `latLngSchema`
 * rather than hand-checked bounds — the same discipline as the cell/bbox parsers above, so the
 * console can't send a coordinate the server would reject.
 */
export function parsePoint(lat: string, lng: string): LatLng | undefined {
  if (!lat.trim() || !lng.trim()) return undefined;
  const parsed = latLngSchema.safeParse({ lat: Number(lat), lng: Number(lng) });
  return parsed.success ? parsed.data : undefined;
}
