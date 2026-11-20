import type { AdminStatus } from "@beaconsgg/protocol-types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { savedServer, WALLET } from "@/features/servers/__tests__/fixtures";
import { ApiError } from "@/lib/api";

/*
 * The banner and the control as an operator meets them. SWR runs for real and the status read is
 * stubbed at the wire function, so the cache the two share is the one the console uses: whether the
 * banner follows a lock, an unlock and a change of server is the thing being tested.
 */

const wire = vi.hoisted(() => ({ post: vi.fn(), set: vi.fn() }));
const servers = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const wallet = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  signedPost: wire.post,
}));
vi.mock("@/features/settings/api", () => ({ settingsSet: wire.set }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/features/servers/ServersProvider", () => ({
  ServersProvider: () => null,
  useServers: () => servers.value,
}));
vi.mock("@/features/wallet", () => ({ useWallet: () => wallet.value }));

const { LockControl, ServerLockBanner } = await import("..");

const ALPHA = savedServer("https://alpha.example", { name: "Alpha" });
const BRAVO = savedServer("https://bravo.example", { name: "Bravo" });

const status = (writeLocked?: boolean): { ok: true; status: AdminStatus } => ({
  ok: true,
  status: {
    host: "h.example",
    name: "Alpha",
    version: "1.0.0",
    startedAt: "2026-11-08T00:00:00.000Z",
    accessLevel: "open",
    coverage: [""],
    capabilities: [],
    counts: {
      rooms: 0,
      profiles: 0,
      places: 0,
      placesRetired: 0,
      conflictsPending: 0,
      snapshots: 0,
      mediaObjects: 0,
      mediaBytes: 0,
      mediaUnreviewed: 0,
    },
    ...(writeLocked === undefined ? {} : { writeLocked }),
  },
});

/** Status by server, so a test can change what one reports between reads. */
let reported: Record<string, boolean | undefined>;

const selected = (server: typeof ALPHA | undefined, over: Record<string, unknown> = {}): void => {
  servers.value = {
    servers: [ALPHA, BRAVO],
    activeServer: server,
    targets: server ? [server] : [ALPHA, BRAVO],
    identityChanged: [],
    checking: [],
    ...over,
  };
};

/** Fresh cache per render, so one test's status cannot answer the next one's read. */
function renderWith(
  children: ReactNode,
  provider: () => Map<string, never> = () => new Map<string, never>(),
) {
  return render(<SWRConfig value={{ provider }}>{children}</SWRConfig>);
}

const unlockButton = () => screen.findByRole("button", { name: "Unlock" });

beforeEach(() => {
  vi.clearAllMocks();
  reported = { [ALPHA.origin]: true, [BRAVO.origin]: false };
  wire.post.mockImplementation((origin: string) => Promise.resolve(status(reported[origin])));
  wire.set.mockImplementation(
    async (origin: string, _w: unknown, patch: { writeLocked: boolean }) => {
      reported[origin] = patch.writeLocked;
      return [];
    },
  );
  selected(ALPHA);
  wallet.value = { status: "unlocked", wallet: WALLET };
});

describe("the banner", () => {
  it("says a locked server is locked, with an Unlock action", async () => {
    renderWith(<ServerLockBanner />);
    expect((await screen.findByRole("alert")).textContent).toContain("Alpha is locked.");
    expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy();
  });

  /* Absent is what a server too old to have a lock sends, which is the same as unlocked. */
  it.each([
    ["unlocked", false],
    ["too old to report it", undefined],
  ])("stays away from a server that is %s", async (_case, locked) => {
    reported[ALPHA.origin] = locked;
    renderWith(<ServerLockBanner />);
    await waitFor(() => expect(wire.post).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("clears as soon as the admin unlocks, and asks the server to confirm", async () => {
    const user = userEvent.setup();
    renderWith(<ServerLockBanner />);
    await user.click(await unlockButton());
    await user.click(await screen.findByRole("button", { name: "Unlock server" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(wire.set).toHaveBeenCalledWith(ALPHA.origin, WALLET, { writeLocked: false });
    await waitFor(() => expect(wire.post.mock.calls.length).toBeGreaterThan(1));
  });

  it("follows the operator to another server", async () => {
    const cache = new Map<string, never>();
    const provider = () => cache;
    const { rerender } = renderWith(<ServerLockBanner />, provider);
    await screen.findByRole("alert");

    selected(BRAVO);
    rerender(
      <SWRConfig value={{ provider }}>
        <ServerLockBanner />
      </SWRConfig>,
    );
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(wire.post.mock.calls.some(([origin]) => origin === BRAVO.origin)).toBe(true);
  });

  /* Each of these is a state where no signed read may go, so the banner cannot know and must not ask. */
  it.each([
    ["the all-servers scope", () => selected(undefined)],
    ["a locked wallet", () => (wallet.value = { status: "locked", wallet: undefined })],
    ["a server whose key changed", () => selected(ALPHA, { identityChanged: [ALPHA.origin] })],
    ["a server still being checked", () => selected(ALPHA, { checking: [ALPHA.origin] })],
  ])("sends no status read in %s", async (_case, arrange) => {
    arrange();
    renderWith(<ServerLockBanner />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wire.post).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the control", () => {
  const openLock = async (user: ReturnType<typeof userEvent.setup>) => {
    renderWith(<LockControl server={ALPHA} locked={false} />);
    await user.click(screen.getByRole("button", { name: "Lock" }));
    await screen.findByRole("alertdialog");
  };

  it("says players cannot make changes, and sends nothing until confirmed", async () => {
    const user = userEvent.setup();
    await openLock(user);
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Players cannot make changes while the server is locked",
    );
    expect(wire.set).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Lock server" }));
    await waitFor(() =>
      expect(wire.set).toHaveBeenCalledWith(ALPHA.origin, WALLET, { writeLocked: true }),
    );
    expect(toast.success).toHaveBeenCalledWith("Alpha is locked.");
  });

  it("does nothing when cancelled", async () => {
    const user = userEvent.setup();
    await openLock(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(wire.set).not.toHaveBeenCalled();
  });

  it("shows the server's reason when a place import is running", async () => {
    const user = userEvent.setup();
    wire.set.mockRejectedValueOnce(
      new ApiError(
        400,
        JSON.stringify([{ path: ["writeLocked"], message: "A place import is running." }]),
      ),
    );
    await openLock(user);
    await user.click(screen.getByRole("button", { name: "Lock server" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("A place import is running."));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("keeps the console's own words for a wallet the server does not admit", async () => {
    const user = userEvent.setup();
    wire.set.mockRejectedValueOnce(new ApiError(403, "denied"));
    await openLock(user);
    await user.click(screen.getByRole("button", { name: "Lock server" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/BEACON_ADMINS/)),
    );
  });
});
