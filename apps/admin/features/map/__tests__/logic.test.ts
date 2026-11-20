import type { DiscoveryResponse, ScoutSummary } from "@beaconsgg/protocol-types";
import { describe, expect, it } from "vitest";
import {
  boundsToBBox,
  claimProgress,
  colorRooms,
  fillLegend,
  groupKey,
  isShown,
  keepShown,
  KIND_COLORS,
  NOTHING_HIDDEN,
  openedOps,
  originColor,
  scoutTitle,
  toFeatureCollections,
  viewCells,
  type PointFeature,
  type RoomTypeLabels,
  type ServerMapData,
} from "../logic";

const SEATTLE = { minLat: 47.6, minLng: -122.34, maxLat: 47.62, maxLng: -122.32 };

const scout = (id: string): ScoutSummary =>
  ({
    id,
    owner: { id: "did:key:zOwner" },
    config: { label: "Scout", scoutType: "walker" },
    mintedBy: {},
    movement: {
      lastKnownLocation: { lat: 47.61, lng: -122.33 },
      locationTimestamp: "2026-07-24T00:00:00.000Z",
      speedKmh: 4.828032, // 3 mph
    },
    expiresAt: "2026-07-24T01:00:00.000Z",
  }) as unknown as ScoutSummary;

const jar = (id: string): DiscoveryResponse["rooms"][number] => ({
  id,
  type: "jar",
  location: { lat: 47.61, lng: -122.33 },
  summary: { count: 2 },
});

const place = (unique: string, media?: unknown[]): ServerMapData["places"][number] =>
  ({
    unique,
    category: "park",
    name: `Place ${unique}`,
    point: { lat: 47.61, lng: -122.33 },
    hasGeometry: false,
    ...(media ? { media } : {}),
    updatedAt: "2026-07-24T00:00:00.000Z",
  }) as unknown as ServerMapData["places"][number];

/** Field-level fixture: build the discovery envelope from the parts a test actually varies. */
const serverData = (
  origin: string,
  over: {
    rooms?: DiscoveryResponse["rooms"];
    scouts?: ScoutSummary[];
    places?: ServerMapData["places"];
  } = {},
): ServerMapData => ({
  origin,
  discovery: {
    coveredBy: "h",
    rooms: over.rooms ?? [],
    scouts: over.scouts ?? [],
  } as DiscoveryResponse,
  places: over.places ?? [],
});

describe("map logic", () => {
  it("boundsToBBox: passthrough in range; wrapped longitudes normalize (antimeridian form kept)", () => {
    expect(boundsToBBox(47.6, -122.34, 47.62, -122.32)).toEqual(SEATTLE);
    // A wrapped world pan reports lngs beyond ±180 — normalize into [-180, 180).
    expect(boundsToBBox(0, 190, 10, 200)).toEqual({
      minLat: 0,
      maxLat: 10,
      minLng: -170,
      maxLng: -160,
    });
    // A view straddling the antimeridian keeps the minLng > maxLng convention coveringCells reads.
    const straddle = boundsToBBox(0, 170, 10, -170);
    expect(straddle.minLng).toBeGreaterThan(straddle.maxLng);
    // 180 lands on the -180 side, still in range.
    expect(boundsToBBox(0, 180, 1, 181).minLng).toBe(-180);
  });

  it("viewCells: bounded, SORTED output for a city view AND a world view (auto-coarsening)", () => {
    const city = viewCells(SEATTLE, 14);
    expect(city.length).toBeGreaterThan(0);
    expect(city.length).toBeLessThanOrEqual(48);
    expect(city).toEqual([...city].sort()); // canonical order → stable SWR keys
    const world = viewCells({ minLat: -85, minLng: -179, maxLat: 85, maxLng: 179 }, 1);
    expect(world.length).toBeGreaterThan(0);
    expect(world.length).toBeLessThanOrEqual(48);
  });

  it("originColor is stable per origin and cycles the palette", () => {
    const origins = ["https://a", "https://b"];
    expect(originColor("https://a", origins)).toBe(originColor("https://a", origins));
    expect(originColor("https://a", origins)).not.toBe(originColor("https://b", origins));
  });

  it("scoutTitle: the owner's name, else a config label, else a plain fallback for another game's scout", () => {
    // A config is opaque to the platform: a scout another game minted has no `label`, and the
    // operator map still draws it rather than failing on the field.
    expect(scoutTitle({ name: "Scouty", config: { label: "Heavy Air Scout" } })).toBe("Scouty");
    expect(scoutTitle({ config: { label: "Heavy Air Scout" } })).toBe("Heavy Air Scout");
    expect(scoutTitle({ config: { kind: "drone", range: 4 } })).toBe("Scout");
    expect(scoutTitle({ config: { label: 7 } })).toBe("Scout");
  });

  it("toFeatureCollections: kinds route to their layer; scouts dedupe across servers", () => {
    const a = serverData("https://a", { scouts: [scout("s1")] });
    const b = serverData("https://b", {
      rooms: [jar("j1@https://b")],
      scouts: [scout("s1"), scout("s2")], // s1 already seen via server a
    });

    const fc = toFeatureCollections([a, b]);
    expect(fc.scouts.features.map((f) => f.properties.id)).toEqual(["s1", "s2"]);
    expect(fc.scouts.features[0]?.properties.subtitle).toBe("4.8 km/h");
    expect(fc.rooms.features).toHaveLength(1);
    expect(fc.rooms.features[0]?.properties).toMatchObject({
      kind: "room",
      roomType: "jar",
      title: "jar",
      id: "j1@https://b",
      subtitle: "2 items",
    });
    // GeoJSON is [lng, lat].
    expect(fc.rooms.features[0]?.geometry.coordinates).toEqual([-122.33, 47.61]);
  });

  it("toFeatureCollections: a room's subtitle names its game, since the console reads every game's", () => {
    const fc = toFeatureCollections([
      serverData("https://a", { rooms: [{ ...jar("j1@https://a"), game: "game-a" }] }),
    ]);
    expect(fc.rooms.features[0]?.properties.subtitle).toBe("2 items · game-a");
  });

  it("toFeatureCollections: one item reads in the singular", () => {
    const one = { ...jar("j1@https://a"), summary: { count: 1 } };
    const fc = toFeatureCollections([serverData("https://a", { rooms: [one] })]);
    expect(fc.rooms.features[0]?.properties.subtitle).toBe("1 item");
  });

  it("toFeatureCollections: place features flag hasPhoto from summary media", () => {
    const fc = toFeatureCollections([
      serverData("https://a", { places: [place("p1", [{}]), place("p2")] }),
    ]);
    const hasPhoto = new Map(
      fc.places.features.map((f) => [f.properties.id, f.properties.hasPhoto]),
    );
    expect(hasPhoto.get("p1")).toBe(true);
    expect(hasPhoto.get("p2")).toBe(false);
  });
});

describe("openedOps", () => {
  it("lists the ops a room opens to other games, in op-name order", () => {
    const ops = { take: {}, list: { games: ["*"] }, add: { games: ["game-b"] } };
    expect(openedOps({ game: "game-a", policy: { ops } })).toEqual([
      { op: "add", games: ["game-b"] },
      { op: "list", games: "any" },
    ]);
  });

  it("leaves out the room's own game, which may apply every op anyway", () => {
    const ops = { take: { games: ["game-a"] }, add: { games: ["game-a", "game-b"] } };
    expect(openedOps({ game: "game-a", policy: { ops } })).toEqual([
      { op: "add", games: ["game-b"] },
    ]);
  });

  it("is empty for a room that opens nothing", () => {
    expect(openedOps({ game: "game-a", policy: { ops: { take: {} } } })).toEqual([]);
  });
});

describe("claimProgress", () => {
  const policy = { ops: { claim: { phase: "unlocked" } } };
  const state = { phase: "unlocked", contributors: { a: [], b: [], c: [] }, claimed: ["b"] };

  it("lists the contributors who have yet to claim, for a room of any game", () => {
    expect(claimProgress({ policy, state })).toEqual({ waiting: ["a", "c"], total: 3 });
  });

  it("treats a room nobody has claimed from as everyone waiting", () => {
    const { claimed: _, ...none } = state;
    expect(claimProgress({ policy, state: none })?.waiting).toEqual(["a", "b", "c"]);
  });

  it("works for a claim op with no phase gate", () => {
    const ungated = { ops: { claim: {} } };
    expect(claimProgress({ policy: ungated, state })?.total).toBe(3);
  });

  it("says nothing before claiming opens", () => {
    expect(claimProgress({ policy, state: { ...state, phase: "locked" } })).toBeUndefined();
  });

  it("says nothing for a room whose op never records a claim", () => {
    const challenge = { ops: { collect: {} } };
    expect(claimProgress({ policy: challenge, state })).toBeUndefined();
  });

  it("says nothing for a room with no contributors or no readable state", () => {
    expect(claimProgress({ policy, state: { phase: "unlocked" } })).toBeUndefined();
    expect(claimProgress({ policy })).toBeUndefined();
  });
});

describe("rooms by game and type", () => {
  const room = (id: string, type: string, game?: string): DiscoveryResponse["rooms"][number] => ({
    id,
    type,
    location: { lat: 47.61, lng: -122.33 },
    ...(game ? { game } : {}),
  });
  const rooms = [
    room("1", "jar", "game-a"),
    room("2", "jar", "game-a"),
    room("3", "capsule", "game-a"),
    room("4", "jar", "other-game"),
    room("5", "beacon-tower", "other-game"),
    room("6", "crate"),
  ];
  const data = serverData("https://a", { rooms });
  const labels: RoomTypeLabels = new Map([["game-a", { jar: { label: "Jar", color: "#123456" } }]]);
  const props = (fc: { features: { properties: PointFeature["properties"] }[] }) =>
    fc.features.map((f) => f.properties);

  it("keeps any game's room as a room, under its own type, with no plugin", () => {
    const { rooms: fc } = toFeatureCollections([data]);
    expect(props(fc).map((p) => [p.kind, p.title])).toEqual([
      ["room", "jar"],
      ["room", "jar"],
      ["room", "capsule"],
      ["room", "jar"],
      ["room", "beacon-tower"],
      ["room", "crate"],
    ]);
    expect(props(fc)[5]?.game).toBeUndefined();
  });

  it("names and colours a type by its game's plugin, for that game's rooms only", () => {
    const [gameAJar, , , otherJar] = props(toFeatureCollections([data], labels).rooms);
    expect(gameAJar).toMatchObject({ title: "Jar", color: "#123456" });
    expect(otherJar?.title).toBe("jar");
    expect(otherJar?.color).not.toBe("#123456");
  });

  it("fills by type until asked to fill by game, when every room of a game shares one fill", () => {
    const { rooms: fc } = toFeatureCollections([data], labels);
    expect(colorRooms(fc, "type")).toBe(fc);
    const fill = props(colorRooms(fc, "game")).map((p) => p.color);
    expect(new Set(fill.slice(0, 3)).size).toBe(1);
    expect(fill[3]).toBe(fill[4]); // both other-game
    expect(new Set([fill[0], fill[3], fill[5]]).size).toBe(3);
  });

  it("gives every group in view its own colour while the palette lasts", () => {
    const eight = Array.from({ length: 8 }, (_, i) => room(`${i}`, `t${i}`, `g${i}`));
    const { facets } = toFeatureCollections([serverData("https://a", { rooms: eight })]);
    expect(new Set(facets.game.map((f) => f.color)).size).toBe(8);
    expect(new Set(facets.type.map((f) => f.color)).size).toBe(8);
  });

  it("keeps a group's colour from one view to the next when nothing else claims it", () => {
    const colorOf = (list: DiscoveryResponse["rooms"]) =>
      toFeatureCollections([serverData("https://a", { rooms: list })]).facets.game.find(
        (f) => f.label === "game-a",
      )?.color;
    expect(colorOf([room("1", "jar", "game-a"), room("2", "crate", "zzz")])).toBe(
      colorOf([room("1", "jar", "game-a")]),
    );
  });

  it("names a type that shares a name with an Object method by the type itself", () => {
    const proto = serverData("https://a", { rooms: [room("7", "constructor", "game-a")] });
    expect(props(toFeatureCollections([proto], labels).rooms)[0]?.title).toBe("constructor");
  });

  it("gives places and scouts their own fills, and a scout its game", () => {
    const withGame = { ...scout("s1"), game: "game-a" } as ScoutSummary;
    const fc = toFeatureCollections([
      serverData("https://a", { scouts: [withGame], places: [place("p1")] }),
    ]);
    expect(fc.scouts.features[0]?.properties).toMatchObject({
      color: KIND_COLORS.scout,
      game: "game-a",
    });
    expect(fc.places.features[0]?.properties.color).toBe(KIND_COLORS.place);
  });

  it("keys a type by its game, since two games may mean different things by one word", () => {
    const key = (game: string, roomType: string) => groupKey({ game, roomType }, "type");
    expect(key("game-a", "jar")).not.toBe(key("other-game", "jar"));
    expect(key("a/b", "c")).not.toBe(key("a", "b/c"));
  });

  it("offers each game (of rooms and scouts) and type in view once, counted, by label", () => {
    const scoutOf = { ...scout("s1"), game: "scouts-only" } as ScoutSummary;
    const { facets } = toFeatureCollections(
      [serverData("https://a", { rooms, scouts: [scoutOf] })],
      labels,
    );
    expect(facets.game.map((f) => [f.label, f.count])).toEqual([
      ["game-a", 3],
      ["None listed", 1],
      ["other-game", 2],
      ["scouts-only", 1],
    ]);
    expect(facets.type.map((f) => [f.label, f.count])).toEqual([
      ["beacon-tower · other-game", 1],
      ["capsule · game-a", 1],
      ["crate · None listed", 1],
      ["Jar · game-a", 2],
      ["jar · other-game", 1],
    ]);
  });

  it("hides by kind, game or type; a game hides its scouts too", () => {
    const fc = toFeatureCollections([
      serverData("https://a", {
        rooms,
        scouts: [{ ...scout("s1"), game: "game-a" } as ScoutSummary],
      }),
    ]);
    const [gameAJar, , capsule, otherJar] = props(fc.rooms);
    const gameAScout = props(fc.scouts)[0]!;
    const hide = (over: Partial<typeof NOTHING_HIDDEN>) => ({ ...NOTHING_HIDDEN, ...over });
    const noGameA = hide({ game: new Set([groupKey({ game: "game-a" }, "game")]) });
    expect(isShown(gameAJar!, NOTHING_HIDDEN)).toBe(true);
    expect(isShown(gameAJar!, hide({ kinds: new Set(["room"]) }))).toBe(false);
    expect([gameAJar!, gameAScout, otherJar!].map((p) => isShown(p, noGameA))).toEqual([
      false,
      false,
      true,
    ]);
    const noGameAJars = hide({
      type: new Set([groupKey({ game: "game-a", roomType: "jar" }, "type")]),
    });
    expect([gameAJar!, capsule!, otherJar!].map((p) => isShown(p, noGameAJars))).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("keeps a collection whole, by identity, when nothing in it is hidden", () => {
    const fc = toFeatureCollections([data]);
    expect(keepShown(fc.places, hide({ type: new Set(["x"]) }))).toBe(fc.places);
    expect(keepShown(fc.rooms, hide({ kinds: new Set(["room"]) })).features).toEqual([]);
  });

  it("lists in the legend only what is drawn, rooms by the chosen grouping", () => {
    const fc = toFeatureCollections([data], labels);
    const noGameA = hide({ game: new Set([groupKey({ game: "game-a" }, "game")]) });
    const shownRooms = keepShown(fc.rooms, noGameA).features;
    const legend = (by: "game" | "type", h = noGameA) =>
      fillLegend(fc.facets, by, h, shownRooms).map((e) => e.label);
    expect(legend("game")).toEqual(["Places", "None listed", "other-game", "Scouts"]);
    // A hidden game takes its types out of the legend too.
    expect(legend("type", hide({ ...noGameA, kinds: new Set(["place", "scout"]) }))).toEqual([
      "beacon-tower · other-game",
      "crate · None listed",
      "jar · other-game",
    ]);
  });
});

const hide = (over: Partial<typeof NOTHING_HIDDEN>) => ({ ...NOTHING_HIDDEN, ...over });
