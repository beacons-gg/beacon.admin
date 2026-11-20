"use client";

import { coverageIntersects } from "@beaconsgg/geo";
import { discoveryResponseReadSchema, type PlaceCategory } from "@beaconsgg/protocol-types";
import useSWR from "swr";
import { getJson } from "@/lib/api";
import { queryPlaces } from "@/features/places";
import type { SavedServer } from "@/features/servers";
import type { ServerMapData } from "./logic";

/**
 * The pane-of-glass fan-out: for the current viewport cells, ask every target server whose
 * pinned **coverage intersects the view** (the shared `coverageIntersects` pre-query filter;
 * empty coverage = everywhere) for its discovery snapshot (rooms + scouts) and, when it
 * advertises the capability, its places. All PUBLIC reads (the map works with the wallet
 * locked); wire-parsed, never cast. One 20s refresh keeps the view live without weight.
 *
 * `categories` is the Explore place-type filter, applied **server-side** (`GET /places?categories=`)
 * so it narrows before the page cap, not after (a client filter over a truncated page would miss
 * places): `[]` = all types (the default), a subset = only those, and `null` = skip the places
 * fetch entirely (the place-type filter is emptied). It's part of the SWR key, so changing it
 * revalidates (`keepPreviousData` keeps the current markers visible meanwhile).
 */
export function useMapData(
  targets: readonly SavedServer[],
  cells: readonly string[],
  categories: readonly PlaceCategory[] | null,
) {
  // Stable key signature: "none" (places filtered out), "" (all — same key as an unfiltered view), or
  // the subset joined. The caller passes a deterministically-ordered subset (taxonomy order), so the
  // key stays stable across renders without re-sorting here.
  const catsKey = categories === null ? "none" : categories.join(",");
  return useSWR(
    targets.length > 0 && cells.length > 0
      ? ["map.data", targets.map((t) => t.origin).join(","), cells.join(","), catsKey]
      : null,
    async (): Promise<ServerMapData[]> => {
      const inView = targets.filter(
        (s) => s.coverage.length === 0 || coverageIntersects(s.coverage, cells),
      );
      const results = await Promise.all(
        inView.map((server) => fetchServerMapData(server, cells, categories)),
      );
      return results.filter((r): r is ServerMapData => r !== undefined);
    },
    { refreshInterval: 20_000, revalidateOnFocus: false, keepPreviousData: true },
  );
}

/**
 * One server's answers for the view. The pane-of-glass degrades per server and per read: a server
 * whose discovery fails contributes nothing, and one whose places read fails (a view too wide for its
 * places precision answers 400) still contributes its rooms and scouts.
 */
export async function fetchServerMapData(
  server: Pick<SavedServer, "origin" | "capabilities">,
  cells: readonly string[],
  categories: readonly PlaceCategory[] | null,
): Promise<ServerMapData | undefined> {
  const [discovery, places] = await Promise.all([
    getJson<unknown>(server.origin, `/discovery?cells=${cells.join(",")}`)
      .then((r) => discoveryResponseReadSchema.parse(r))
      .catch(() => undefined),
    server.capabilities.includes("places") && categories !== null
      ? // Spread: a dense view holds more places than one page, and by id a page is one corner.
        queryPlaces(server.origin, [...cells], [...categories], { spread: true })
          .then((r) => r.places)
          .catch(() => [])
      : Promise.resolve([]),
  ]);
  return discovery ? { origin: server.origin, discovery, places } : undefined;
}
