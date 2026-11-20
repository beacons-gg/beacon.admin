/**
 * Explore's inspect card for a room: removal on a server whose identity changed or hasn't been
 * checked yet, and the room's game.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { savedServer, WALLET } from "../../servers/__tests__/fixtures";
import type { RoomCard } from "../api";
import { InspectPanel, type Inspect } from "../InspectPanel";

const A = savedServer("https://a.example", { name: "Alpha" });
const known = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("../../servers/ServersProvider", () => ({ useServers: () => known.value }));
const role = vi.hoisted(() => ({ value: "unknown" }));
vi.mock("../../servers/roles", () => ({
  useServerRoles: () => ({ mayAdmin: () => role.value !== "notAdmin" }),
}));
vi.mock("@/features/wallet", () => ({ useWallet: () => ({ wallet: WALLET }) }));
vi.mock("@/features/moderation", () => ({ removeRoom: vi.fn() }));
vi.mock("@/features/media", () => ({
  OwnerLabel: ({ did }: { did: string }) => <span>{did}</span>,
}));

const jar = { kind: "room", origin: A.origin, id: "r@a.example", title: "jar" } as Inspect;

function show(
  identityChanged: string[],
  checking: string[],
  servers = [A],
  props: { room?: RoomCard | null; roomError?: string } = {},
) {
  known.value = { servers, identityChanged, checking };
  render(
    <InspectPanel
      inspect={jar}
      serverName="Alpha"
      onClose={() => {}}
      onRemoved={() => {}}
      {...props}
    />,
  );
}

describe("InspectPanel's room removal", () => {
  it("is not offered at all on a server the wallet is not an admin of", () => {
    role.value = "notAdmin";
    show([], []);
    role.value = "unknown";
    expect(screen.queryByRole("button", { name: /Remove room/ })).toBeNull();
  });

  it("is offered on a server checked this session and still under its pinned key", () => {
    show([], []);
    expect(screen.getByRole("button", { name: /Remove room/ })).toBeTruthy();
  });

  it("is refused, with the reason, on a server whose key changed", () => {
    show([A.origin], []);
    expect(screen.queryByRole("button", { name: /Remove room/ })).toBeNull();
    expect(screen.getByText(/Alpha is now signing with a different key/)).toBeTruthy();
  });

  it("waits on a server whose identity hasn't been checked yet", () => {
    show([], [A.origin]);
    expect(screen.queryByRole("button", { name: /Remove room/ })).toBeNull();
    expect(screen.getByText(/Checking Alpha's identity/)).toBeTruthy();
  });

  it("is refused on a server that is no longer saved", () => {
    show([], [], []);
    expect(screen.queryByRole("button", { name: /Remove room/ })).toBeNull();
    expect(screen.getByText(/no longer saved/)).toBeTruthy();
  });
});

const PLACER = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";

function room(over: Partial<RoomCard>): RoomCard {
  return { policy: { ops: { take: {} } }, placedBy: PLACER, ...over };
}

const showRoom = (props: { room?: RoomCard | null; roomError?: string }) =>
  show([], [], [A], props);

describe("InspectPanel's room game", () => {
  it("names the room's game, and says no other game may act on a room that opens nothing", () => {
    showRoom({ room: room({ game: "game-a" }) });
    expect(screen.getByText("game-a")).toBeTruthy();
    expect(screen.getByText("None: only game-a can act on it")).toBeTruthy();
  });

  it("lists each op opened to other games, by name or to every game", () => {
    showRoom({
      room: room({
        game: "game-a",
        policy: {
          ops: {
            take: {},
            list: { games: ["*"] },
            add: { games: ["game-b", "game-c"] },
          },
        },
      }),
    });
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["add: game-b, game-c", "list: any game"]);
  });

  it("says when a room lists no game", () => {
    showRoom({ room: room({}) });
    expect(screen.getByText("None listed")).toBeTruthy();
    expect(screen.getByText("None: no game can act on it")).toBeTruthy();
  });

  it("shows the room's name when it has one, keeping the title the list shows", () => {
    showRoom({ room: room({ game: "game-a", name: "Pier jar" }) });
    expect(screen.getByText("Pier jar")).toBeTruthy();
    expect(screen.getByText("jar")).toBeTruthy(); // the title the list shows, unchanged
  });

  it("says when the room is loading, gone, or could not be read", () => {
    showRoom({});
    expect(screen.getByText("Loading the room…")).toBeTruthy();
    showRoom({ room: null });
    expect(screen.getByText("The server no longer has this room.")).toBeTruthy();
    showRoom({ roomError: "Server error 503." });
    expect(screen.getByText("Server error 503.")).toBeTruthy();
  });
});

describe("InspectPanel's waiting to claim", () => {
  const claimable = room({
    policy: { ops: { claim: { phase: "unlocked" } } },
    state: {
      phase: "unlocked",
      contributors: { maple: [], yarrow: [], kobe: [] },
      claimed: ["kobe"],
    },
  });

  it("counts who is waiting, and names them only when asked", () => {
    showRoom({ room: claimable });
    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(screen.queryByText("maple")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show who" }));
    expect(screen.getByText("maple")).toBeTruthy();
    expect(screen.getByText("yarrow")).toBeTruthy();
    expect(screen.queryByText("kobe")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("maple")).toBeNull();
  });

  it("stays out of a room with no claiming to report", () => {
    showRoom({ room: room({ game: "game-a" }) });
    expect(screen.queryByText("Waiting to claim")).toBeNull();
  });
});
