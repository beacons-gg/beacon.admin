"use client";

import { placeCategorySchema, type PlaceCategory } from "@beaconsgg/protocol-types";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import {
  colorRooms,
  fillLegend,
  getRoom,
  InspectPanel,
  isShown,
  keepShown,
  MapCanvas,
  NOTHING_HIDDEN,
  originColor,
  toFeatureCollections,
  useMapData,
  type Inspect,
  type MapHidden,
  type RoomGroup,
} from "@/features/map";
import { describeApiError } from "@/lib/api";
import { getPlace, placeImages } from "@/features/places";
import { serverLabel, useServers } from "@/features/servers";
import { ROOM_TYPE_LABELS } from "@/features/games/plugins";
import { toggled } from "@/lib/utils";
import { ResultsColumn } from "./ResultsColumn";
import { StatRibbon } from "./StatRibbon";

const ALL_CATEGORIES: readonly PlaceCategory[] = placeCategorySchema.options;

/**
 * The Explore hub (the console's landing): server health up top, then the pane-of-glass as a
 * three-pane workspace — a search/filter results rail, the map, and an inspector — all over one
 * fan-out (`useMapData`). The map is the jumping-off point: filter or search, click an item on the
 * map or in the list, inspect it, and act.
 */
export function ExploreView() {
  const { targets, servers } = useServers();
  const [cells, setCells] = useState<string[]>([]);
  const [hidden, setHidden] = useState<MapHidden>(NOTHING_HIDDEN);
  const [colorBy, setColorBy] = useState<RoomGroup>("type");
  const [categories, setCategories] = useState<ReadonlySet<PlaceCategory>>(new Set(ALL_CATEGORIES));
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Inspect | undefined>(undefined);

  // The place-type filter as a wire param (server-side `GET /places?categories=`, so it narrows
  // before the page cap): all selected → `[]` (all, the default), none → `null` (skip the places
  // fetch), else the taxonomy-ordered subset. Narrowing on the server is what makes this correct when
  // a viewport has more places than one page can return.
  const placesQuery = useMemo<PlaceCategory[] | null>(() => {
    if (categories.size === 0) return null;
    if (categories.size === ALL_CATEGORIES.length) return [];
    return ALL_CATEGORIES.filter((c) => categories.has(c));
  }, [categories]);

  const data = useMapData(targets, cells, placesQuery);
  const collections = useMemo(
    () => toFeatureCollections(data.data ?? [], ROOM_TYPE_LABELS),
    [data.data],
  );
  // What's drawn and listed = what passes the filters (search only narrows the list further). A
  // collection nothing was hidden from keeps its identity, so the map leaves its layer alone.
  const shownCollections = useMemo(
    () => ({
      rooms: keepShown(colorRooms(collections.rooms, colorBy), hidden),
      scouts: keepShown(collections.scouts, hidden),
      places: keepShown(collections.places, hidden),
    }),
    [collections, colorBy, hidden],
  );
  const shown = useMemo(
    () => Object.values(shownCollections).flatMap((fc) => fc.features),
    [shownCollections],
  );

  const answered = useMemo(() => (data.data ?? []).map((d) => d.origin), [data.data]);
  const labelByOrigin = useMemo(
    () => new Map(servers.map((s) => [s.origin, serverLabel(s)] as const)),
    [servers],
  );
  // An origin that answered but is not in the saved list falls back to the origin itself.
  const originName = useCallback(
    (origin: string) => labelByOrigin.get(origin) ?? origin,
    [labelByOrigin],
  );
  const serverLegend = useMemo(
    () => answered.map((o) => ({ label: originName(o), color: originColor(o, answered) })),
    [answered, originName],
  );

  // A selection the filters now hide closes with its marker, and comes back if it is shown again.
  const inspected = selected && isShown(selected, hidden) ? selected : undefined;

  // The selected place's full record — its area geometry outlines under the markers; its detail
  // fields feed the inspector.
  const placeDetail = useSWR(
    selected?.kind === "place" ? ["explore.place", selected.origin, selected.id] : null,
    () => getPlace(selected!.origin, selected!.id),
    { revalidateOnFocus: false },
  );
  const selectionGeometry = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features:
        inspected?.kind === "place" && placeDetail.data?.geometry
          ? [{ type: "Feature", geometry: placeDetail.data.geometry, properties: {} }]
          : [],
    }),
    [inspected, placeDetail.data],
  );

  // The room on the card's record, for its game, what it opens to other games, and who has yet to
  // claim. Polled like the map, since players keep claiming while the card sits open.
  const roomDetail = useSWR(
    inspected?.kind === "room" ? ["explore.room", inspected.origin, inspected.id] : null,
    () => getRoom(inspected!.origin, inspected!.id),
    { refreshInterval: 20_000, revalidateOnFocus: false },
  );

  // The resolved place record for the selected marker (undefined for non-places / still loading).
  const place = selected?.kind === "place" ? placeDetail.data : undefined;

  const toggleCategory = (c: PlaceCategory) => setCategories((prev) => toggled(prev, c));

  // Fly the map to whatever is selected (from the list or the map itself).
  const focus = useMemo(() => {
    if (!inspected) return undefined;
    const f = shown.find(
      (x) => x.properties.id === inspected.id && x.properties.origin === inspected.origin,
    );
    if (!f) return undefined;
    const [lng, lat] = f.geometry.coordinates;
    return { lng, lat, key: `${inspected.origin}:${inspected.id}` };
  }, [inspected, shown]);

  return (
    // A definite viewport-based height (topbar is h-14 = 3.5rem) so the map pane always has a real
    // height — MapLibre needs one, and the shell's min-h-svh flex chain can collapse to zero here.
    // Inline style (not a Tailwind arbitrary class) to guarantee valid `calc()` spacing.
    <div
      className="flex shrink-0 flex-col overflow-hidden"
      style={{ height: "calc(100svh - 3.5rem)" }}
    >
      <StatRibbon />
      {/* Definite-height region; the panes fill it via `absolute inset-0` so the map div always has
          a real height without depending on flex-stretch propagating down the shell. */}
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex">
          <ResultsColumn
            features={shown}
            hidden={hidden}
            onHiddenChange={setHidden}
            facets={collections.facets}
            colorBy={colorBy}
            onColorByChange={setColorBy}
            categories={categories}
            onToggleCategory={toggleCategory}
            onSetCategories={setCategories}
            query={query}
            onQueryChange={setQuery}
            selectedId={inspected?.id}
            onSelect={setSelected}
            originName={originName}
          />

          <MapCanvas
            collections={shownCollections}
            selectionGeometry={selectionGeometry}
            onCellsChange={setCells}
            onSelect={setSelected}
            serverLegend={serverLegend}
            fillLegend={fillLegend(
              collections.facets,
              colorBy,
              hidden,
              shownCollections.rooms.features,
            )}
            statusText={`${shown.length} on map · ${cells.length} cells`}
            refreshing={data.isValidating}
            focus={focus}
          />

          {inspected ? (
            <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card/40 p-3">
              <InspectPanel
                key={`${inspected.origin} ${inspected.id}`}
                inspect={inspected}
                serverName={originName(inspected.origin)}
                room={roomDetail.data}
                roomError={roomDetail.error ? describeApiError(roomDetail.error) : undefined}
                geometryShown={selectionGeometry.features.length > 0}
                images={placeImages(place?.media)}
                description={place?.description}
                descriptionCredit={place?.descriptionCredit}
                website={place?.website}
                wikipedia={place?.wikipedia}
                altNames={place?.altNames}
                onClose={() => setSelected(undefined)}
                onRemoved={() => {
                  setSelected(undefined);
                  void data.mutate();
                }}
              />
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
