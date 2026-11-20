import type { RoomTypeName } from "@beaconsgg/admin-plugin";
import { cellsForView, type BBox } from "@beaconsgg/geo";
import {
  ANY_GAME,
  type DiscoveryResponse,
  type PlaceSummary,
  type ScoutSummary,
} from "@beaconsgg/protocol-types";
import type { RoomCard } from "./api";

/**
 * Pure map logic (unit-tested; MapPanel stays render/plumbing). Everything the pane-of-glass view
 * derives — query cells from the viewport, per-server stroke colors, and the GeoJSON the layers
 * render — lives here.
 */

/** What one server answered for the current viewport. */
export interface ServerMapData {
  origin: string;
  discovery: DiscoveryResponse;
  places: PlaceSummary[];
}

/** What a marker is: the platform's own three kinds. A room's game and type say the rest. */
export type MapKind = "place" | "room" | "scout";

/** A minimal point Feature (maplibre accepts plain JSON; properties stay flat for layer styling). */
export interface PointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    kind: MapKind;
    origin: string;
    originColor: string;
    /** The marker's fill: its kind's colour, or for a room its game's or type's (see {@link colorRooms}). */
    color: string;
    id: string;
    title: string;
    subtitle: string;
    /** A room's or scout's game, as the server reports it; absent when it lists none. */
    game?: string;
    /** A room's type, verbatim from the server (a game's own word, like `jar`). */
    roomType?: string;
    /** A room's fill when rooms are coloured by game, and by type. */
    gameColor?: string;
    typeColor?: string;
    /** Whether a place carries an ingested photo — set only for `place` features (drives the list chip). */
    hasPhoto?: boolean;
  };
}
export interface FeatureCollection {
  type: "FeatureCollection";
  features: PointFeature[];
}

export const MAP_KINDS: { key: MapKind; label: string }[] = [
  { key: "place", label: "Places" },
  { key: "room", label: "Rooms" },
  { key: "scout", label: "Scouts" },
];

/**
 * The fill of a place, a scout, and a room when there is no game or type to tell it apart by. The
 * map, its legend and the results list all read these, so markers and chrome can never drift.
 */
export const KIND_COLORS: Record<MapKind, string> = {
  place: "#0e9fe0",
  room: "#0ea371",
  scout: "#e8930a",
};

/**
 * Room fills. A group's first pick comes from a hash of its key, so it keeps its colour from one view
 * to the next unless another group in view already holds that colour. None is the places' blue or
 * the scouts' orange.
 */
const ROOM_PALETTE = [
  "#0ea371",
  "#7c5cf0",
  "#e5484d",
  "#d6409f",
  "#84cc16",
  "#a18072",
  "#14b8a6",
  "#c084fc",
];

/** The two ways rooms group: by their game, or by their type within a game. */
export type RoomGroup = "game" | "type";
export const ROOM_GROUPS: readonly RoomGroup[] = ["game", "type"];

/** The game plugins' names for their room types: `game → type → label and colour`. */
export type RoomTypeLabels = ReadonlyMap<string, Readonly<Record<string, RoomTypeName>>>;

/** The label of the game of anything that lists none. */
const NO_GAME = "None listed";

/**
 * The key of a marker's game or room type. Two games may use one word for different things, so a
 * type belongs to its game: one game's `jar` and another game's `jar` are two types.
 */
export function groupKey(p: Pick<Props, "game" | "roomType">, by: RoomGroup): string {
  return JSON.stringify(by === "game" ? (p.game ?? null) : [p.game ?? null, p.roomType ?? ""]);
}
type Props = PointFeature["properties"];

/** A game plugin's name for one of its room types, if it gives one. The type is a server's string. */
function pluginName(
  game: string | undefined,
  type: string,
  labels: RoomTypeLabels,
): RoomTypeName | undefined {
  const names = game === undefined ? undefined : labels.get(game);
  return names && Object.hasOwn(names, type) ? names[type] : undefined;
}

/** Palette picks for `keys`, each a different colour while the palette lasts. `fixed` are kept. */
function assignColors(
  keys: Iterable<string>,
  fixed: ReadonlyMap<string, string>,
): Map<string, string> {
  const out = new Map(fixed);
  const used = new Set(fixed.values());
  for (const key of [...keys].sort()) {
    if (out.has(key)) continue;
    let h = 0x811c9dc5; // FNV-1a
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
    const start = (h >>> 0) % ROOM_PALETTE.length;
    const pick =
      ROOM_PALETTE.map((_, i) => ROOM_PALETTE[(start + i) % ROOM_PALETTE.length]!).find(
        (c) => !used.has(c),
      ) ?? ROOM_PALETTE[start]!;
    out.set(key, pick);
    used.add(pick);
  }
  return out;
}

/** One entry of a filter: a game or a room type seen in view, with its colour and count. */
export interface Facet {
  key: string;
  label: string;
  color: string;
  count: number;
}
export type Facets = Record<RoomGroup, Facet[]>;

/**
 * The games (of rooms and scouts) and room types in view, each once, by label, with their colours,
 * and each room's two fills. A plugin's colour for its own type is kept; every other group gets a
 * palette colour no other group in view holds, while there are colours left. Built from what the
 * servers returned, so the filters offer exactly what is on the map, whatever game it belongs to.
 */
function groupRooms(
  rooms: readonly PointFeature[],
  scouts: readonly PointFeature[],
  labels: RoomTypeLabels,
): Facets {
  const groups = { game: new Map<string, Facet>(), type: new Map<string, Facet>() };
  const named = new Map<string, string>();
  const tally = (by: RoomGroup, key: string, label: string) => {
    const seen = groups[by].get(key);
    if (seen) seen.count++;
    else groups[by].set(key, { key, label, color: "", count: 1 });
  };
  for (const { properties: p } of [...rooms, ...scouts]) {
    tally("game", groupKey(p, "game"), p.game ?? NO_GAME);
    if (p.kind !== "room") continue;
    const key = groupKey(p, "type");
    tally("type", key, `${p.title} · ${p.game ?? NO_GAME}`);
    const color = pluginName(p.game, p.roomType ?? "", labels)?.color;
    if (color) named.set(key, color);
  }
  const colors = {
    game: assignColors(groups.game.keys(), new Map()),
    type: assignColors(groups.type.keys(), named),
  };
  for (const by of ROOM_GROUPS)
    for (const f of groups[by].values()) f.color = colors[by].get(f.key)!;
  for (const { properties: p } of rooms) {
    p.gameColor = colors.game.get(groupKey(p, "game"))!;
    p.typeColor = colors.type.get(groupKey(p, "type"))!;
    p.color = p.typeColor;
  }
  const byLabel = (m: Map<string, Facet>) =>
    [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  return { game: byLabel(groups.game), type: byLabel(groups.type) };
}

/** The rooms filled by the chosen grouping (they are built filled by type). */
export function colorRooms(rooms: FeatureCollection, by: RoomGroup): FeatureCollection {
  if (by === "type") return rooms;
  return {
    type: "FeatureCollection",
    features: rooms.features.map((f) => ({
      ...f,
      properties: { ...f.properties, color: f.properties.gameColor ?? f.properties.color },
    })),
  };
}

/**
 * What the operator has hidden on the map and in the list, by kind and by {@link groupKey}. Hidden
 * rather than shown, so a game or a room type that first appears later is shown until someone hides
 * it.
 */
export type MapHidden = { kinds: ReadonlySet<MapKind> } & Record<RoomGroup, ReadonlySet<string>>;
export const NOTHING_HIDDEN: MapHidden = { kinds: new Set(), game: new Set(), type: new Set() };

/** Whether a marker passes the operator's filters. A game hides its scouts with its rooms. */
export function isShown(p: Props, hidden: MapHidden): boolean {
  if (hidden.kinds.has(p.kind)) return false;
  if (p.kind === "place") return true;
  if (hidden.game.has(groupKey(p, "game"))) return false;
  return p.kind !== "room" || !hidden.type.has(groupKey(p, "type"));
}

/** The collection without what is hidden: the same object when nothing in it is. */
export function keepShown(fc: FeatureCollection, hidden: MapHidden): FeatureCollection {
  const features = fc.features.filter((f) => isShown(f.properties, hidden));
  return features.length === fc.features.length ? fc : { type: "FeatureCollection", features };
}

type LegendEntry = Pick<Facet, "key" | "label" | "color">;

/** What the marker fills mean, for what is drawn: places, the room groups of the rooms shown, scouts. */
export function fillLegend(
  facets: Facets,
  by: RoomGroup,
  hidden: MapHidden,
  shownRooms: readonly PointFeature[],
): LegendEntry[] {
  const drawn = new Set(shownRooms.map((f) => groupKey(f.properties, by)));
  return MAP_KINDS.flatMap((k): LegendEntry[] => {
    if (hidden.kinds.has(k.key)) return [];
    if (k.key === "room") return facets[by].filter((f) => drawn.has(f.key));
    return [{ key: k.key, label: k.label, color: KIND_COLORS[k.key] }];
  });
}

/**
 * Raw maplibre bounds → the geo package's BBox convention: longitudes normalized into
 * [-180, 180) (a wrapped world pan can report e.g. 200°), which naturally yields the
 * `minLng > maxLng` antimeridian form `coveringCells` already handles.
 */
export function boundsToBBox(south: number, west: number, north: number, east: number): BBox {
  // Wrap only out-of-range values — the modulo dance would smear float error onto in-range ones.
  const wrap = (lng: number) =>
    lng >= -180 && lng < 180 ? lng : ((((lng + 180) % 360) + 360) % 360) - 180;
  return { minLat: south, maxLat: north, minLng: wrap(west), maxLng: wrap(east) };
}

/**
 * The viewport's query cells (shared `cellsForView` — precision from zoom, auto-coarsened under
 * the cap, so a world-view pan can't produce an unbounded cell list), **sorted** so the same set
 * always yields the same SWR key / query string. One list serves both `GET /discovery?cells=`
 * and `GET /places?cells=`.
 *
 * `withNeighbors: false` — no out-of-view margin ring. The covering cells already include every cell
 * that intersects the visible rectangle, so nothing on screen is dropped; the neighbor ring only added
 * cells *beyond* the edges (and, by eating the `maxCells` budget, forced a coarser precision) — together
 * ~4×–21× more area than the view. Dropping it also frees the budget for a finer precision that hugs the
 * viewport (over-fetch ~1.1×–2.6×). The map re-queries on `moveend`, so the pre-fetch margin bought little.
 */
export function viewCells(bbox: BBox, zoom: number): string[] {
  return [...cellsForView(bbox, zoom, { maxCells: 48, withNeighbors: false }).cells].sort();
}

/** An op a room opens to games other than its own: to the games named, or to every game. */
export interface OpenedOp {
  op: string;
  games: "any" | readonly string[];
}

/**
 * The ops a room opens to other games (its policy's per-op `games`), in op-name order. The room's
 * own game may apply every op, so it is left out: an op that names only that game opens nothing.
 */
export function openedOps(room: Pick<RoomCard, "game" | "policy">): OpenedOp[] {
  return Object.entries(room.policy.ops)
    .flatMap(([op, { games = [] }]): OpenedOp[] => {
      if (games.includes(ANY_GAME)) return [{ op, games: "any" }];
      const others = games.filter((g) => g !== room.game);
      return others.length > 0 ? [{ op, games: others }] : [];
    })
    .sort((a, b) => a.op.localeCompare(b.op));
}

/**
 * Who has yet to claim from a room, for any game, once claiming is open. Undefined when that can't
 * be answered: only the `claim` op writes the `claimed` ledger, so a room without one (a challenge's
 * repeatable `collect` never records a claim) would otherwise show every member as waiting.
 */
export function claimProgress({ policy, state }: Pick<RoomCard, "policy" | "state">) {
  const rule = policy.ops["claim"];
  if (!rule || !state || (rule.phase !== undefined && rule.phase !== state.phase)) return undefined;
  const contributors = Object.keys(state.contributors ?? {});
  if (contributors.length === 0) return undefined;
  const claimed = new Set(state.claimed);
  return { waiting: contributors.filter((d) => !claimed.has(d)), total: contributors.length };
}

/** A stable stroke color per server (the "which server said this" coding in all-servers mode). */
const ORIGIN_PALETTE = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#f87171"];
export function originColor(origin: string, origins: readonly string[]): string {
  const i = Math.max(0, origins.indexOf(origin));
  return ORIGIN_PALETTE[i % ORIGIN_PALETTE.length] as string;
}

/**
 * A scout's title on the operator map: the owner's name for it, else a string `label` in its config
 * (a field a game may set), else "Scout". A server relays every game's scouts and a config is opaque
 * to the platform, so this console reads nothing else from it and a config without a label still
 * draws.
 */
export function scoutTitle(s: Pick<ScoutSummary, "name" | "config">): string {
  const label = s.config["label"];
  return s.name ?? (typeof label === "string" && label !== "" ? label : "Scout");
}

const feature = (
  kind: PointFeature["properties"]["kind"],
  origin: string,
  originColor: string,
  color: string,
  id: string,
  title: string,
  subtitle: string,
  lng: number,
  lat: number,
): PointFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties: { kind, origin, originColor, color, id, title, subtitle },
});

/**
 * Fold every server's answers into one FeatureCollection per layer group, plus the games and room
 * types in view. Rooms are named by their game plugin's `labels` where it gives one.
 */
export function toFeatureCollections(
  data: readonly ServerMapData[],
  labels: RoomTypeLabels = new Map(),
): {
  rooms: FeatureCollection;
  scouts: FeatureCollection;
  places: FeatureCollection;
  facets: Facets;
} {
  const origins = data.map((d) => d.origin);
  const rooms: PointFeature[] = [];
  const scouts: PointFeature[] = [];
  const places: PointFeature[] = [];
  const seenScouts = new Set<string>(); // scouts dedupe by id across servers (wire contract)

  for (const server of data) {
    const color = originColor(server.origin, origins);
    for (const o of server.discovery.rooms) {
      const n = o.summary?.["count"];
      const count = typeof n === "number" ? `${n} ${n === 1 ? "item" : "items"}` : "";
      // Whose room it is: the console reads every game's, so the game is what tells them apart.
      const subtitle = [count, o.game].filter(Boolean).join(" · ");
      const f = feature(
        "room",
        server.origin,
        color,
        KIND_COLORS.room, // groupRooms fills it, once every room in view is known
        o.id,
        pluginName(o.game, o.type, labels)?.label || o.type,
        subtitle,
        o.location.lng,
        o.location.lat,
      );
      f.properties.roomType = o.type;
      if (o.game !== undefined) f.properties.game = o.game;
      rooms.push(f);
    }
    for (const s of server.discovery.scouts) {
      if (seenScouts.has(s.id)) continue;
      seenScouts.add(s.id);
      const at = s.movement.lastKnownLocation;
      const f = feature(
        "scout",
        server.origin,
        color,
        KIND_COLORS.scout,
        s.id,
        scoutTitle(s),
        `${Math.round(s.movement.speedKmh * 10) / 10} km/h`,
        at.lng,
        at.lat,
      );
      if (s.game !== undefined) f.properties.game = s.game;
      scouts.push(f);
    }
    for (const p of server.places) {
      const f = feature(
        "place",
        server.origin,
        color,
        KIND_COLORS.place,
        p.unique,
        p.name ?? "(unnamed)",
        p.category,
        p.point.lng,
        p.point.lat,
      );
      f.properties.hasPhoto = (p.media?.length ?? 0) > 0; // summary carries ingested thumb+full media
      places.push(f);
    }
  }
  return {
    rooms: { type: "FeatureCollection", features: rooms },
    scouts: { type: "FeatureCollection", features: scouts },
    places: { type: "FeatureCollection", features: places },
    facets: groupRooms(rooms, scouts, labels),
  };
}
