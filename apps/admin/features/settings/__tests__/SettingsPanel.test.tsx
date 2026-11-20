import type { AdminSetting } from "@beaconsgg/protocol-types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import useSWR, { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { adminStatusKey } from "@/features/servers";
import { savedServer, WALLET } from "@/features/servers/__tests__/fixtures";
import { setting } from "./fixtures";

/*
 * The settings screen as an operator meets it. Most of the defects review found in the screen lived
 * in this file, and none of them were reachable from `logic.ts`: which op settles what, whether a
 * failed write refetches, whether the audit reason rides the next op, and where a refusal lands.
 * They are behaviours of the wiring, so they are tested through the wiring.
 *
 * SWR runs for real, with only the three signed calls stubbed. Mocking `mutate` instead would leave
 * the two questions this file exists to answer (does a failure refetch, does a success replace)
 * asserted against the test's own idea of what SWR does.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), reset: vi.fn() }));
const servers = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const wallet = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("../api", () => ({
  settingsGet: api.get,
  settingsSet: api.set,
  settingsReset: api.reset,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The two providers the gate reads, replaced at their own modules so the gate itself stays real.
// `ServersProvider` is named as well as `useServers` because the feature barrel re-exports both.
vi.mock("@/features/servers/ServersProvider", () => ({
  ServersProvider: () => null,
  useServers: () => servers.value,
}));
vi.mock("@/features/wallet", () => ({ useWallet: () => wallet.value }));

const { SettingsPanel } = await import("../SettingsPanel");

const SERVER = savedServer("https://alpha.example");

/**
 * Three rows, one per control shape, and the last one already overridden so it offers a Reset.
 * Small on purpose: the screen renders 70 of these and none of the wiring cares how many.
 */
const rows = (): AdminSetting[] => [
  setting({ key: "name", env: "BEACON_NAME", value: "Alpha", configured: true }),
  setting({ key: "mailboxEnabled", env: "BEACON_MAILBOX", value: false }),
  setting({ provenance: "admin", updatedBy: "did:key:z6MkOperator" }),
];

/** Fresh cache per render, so one test's settings cannot answer the next one's read. */
function renderPanel(): void {
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <SettingsPanel />
    </SWRConfig>,
  );
}

/** Load the screen and wait for the rows, which is where every test below starts. */
async function openPanel(): Promise<void> {
  renderPanel();
  await screen.findByLabelText("Display name");
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue(rows());
  servers.value = {
    servers: [SERVER],
    activeServer: SERVER,
    targets: [SERVER],
    identityChanged: [],
    checking: [],
  };
  wallet.value = { status: "unlocked", wallet: WALLET };
});

describe("the gate", () => {
  it("refuses without a wallet, and reads nothing", () => {
    wallet.value = { status: "locked", wallet: undefined };
    renderPanel();
    expect(screen.getByText(/Unlock the operator wallet/)).toBeTruthy();
    expect(screen.queryByText("Display name")).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("names the server the ops are about to hit", async () => {
    await openPanel();
    expect(screen.getByText(/Configuring/).textContent).toContain("https://alpha.example");
  });
});

describe("a failed read", () => {
  it("renders the refusal instead of an empty form", async () => {
    api.get.mockRejectedValue(new ApiError(403, "nope"));
    renderPanel();
    expect(
      await screen.findByText("Denied — this wallet is not on the server's BEACON_ADMINS."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Display name")).toBeNull();
  });
});

describe("save", () => {
  it("sends every pending change as one write, with the reason", async () => {
    await openPanel();
    await userEvent.type(screen.getByLabelText("Display name"), " two");
    await userEvent.click(screen.getByLabelText("Mailbox"));
    expect(screen.getByText("2 pending changes")).toBeTruthy();

    api.set.mockResolvedValue(rows());
    await userEvent.type(
      screen.getByLabelText("Reason for this change (audit log)"),
      "beta cohort",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(api.set).toHaveBeenCalledWith(
      SERVER.origin,
      WALLET,
      { name: "Alpha two", mailboxEnabled: true },
      "beta cohort",
    );
  });

  /*
   * The buffer is what a save consumed, so a save clears it. Stated as an assertion because the
   * screen's whole argument is that edits collect and go as one write, and the count is the only
   * thing on screen that says so.
   */
  it("consumes the whole buffer", async () => {
    await openPanel();
    await userEvent.type(screen.getByLabelText("Display name"), " two");
    await userEvent.click(screen.getByLabelText("Mailbox"));
    api.set.mockResolvedValue(rows());
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByText(/pending change/)).toBeNull());
  });

  /*
   * The reason described the edits that just went. It lives in the save bar, which is off screen
   * whenever the buffer is empty, so a reason left behind is one an operator cannot see and cannot
   * clear: it rides the next write and labels it with a sentence about a different one. `reason` is
   * the seed of an audit trail the server may keep later, where a wrong one is worse than none.
   */
  it("does not carry the reason into the next write", async () => {
    await openPanel();
    await userEvent.type(screen.getByLabelText("Display name"), " two");
    api.set.mockResolvedValue(rows());
    await userEvent.type(
      screen.getByLabelText("Reason for this change (audit log)"),
      "beta cohort",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByText(/pending change/)).toBeNull());

    await userEvent.click(screen.getByLabelText("Mailbox"));
    const reason = await screen.findByLabelText("Reason for this change (audit log)");
    expect((reason as HTMLInputElement).value).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    // Explicitly `undefined` rather than absent: the panel always passes the slot, empty or not.
    expect(api.set).toHaveBeenLastCalledWith(
      SERVER.origin,
      WALLET,
      { mailboxEnabled: true },
      undefined,
    );
  });
});

describe("reset", () => {
  /*
   * A reset consumed one row, and settling like a save would throw away every other pending edit on
   * the screen. It renders beside "Undo edit" on every overridden row, so the gesture is one click
   * away from the buffer at all times, and the toast says nothing about what it cost. Three edits in
   * and two out is the whole of the difference between the two postconditions.
   */
  it("consumes only its own row, leaving the rest of the buffer", async () => {
    await openPanel();
    await userEvent.type(screen.getByLabelText("Display name"), " two");
    await userEvent.click(screen.getByLabelText("Mailbox"));
    await userEvent.clear(screen.getByLabelText("Message TTL"));
    await userEvent.type(screen.getByLabelText("Message TTL"), "60");
    expect(screen.getByText("3 pending changes")).toBeTruthy();

    api.reset.mockResolvedValue(rows());
    await userEvent.click(screen.getByRole("button", { name: "Reset to BEACON_MAILBOX_TTL" }));
    await waitFor(() => expect(screen.getByText("2 pending changes")).toBeTruthy());
  });

  /*
   * And it carries no reason at all. The field is in the save bar, so the only sentence a row-level
   * reset could reach is one somebody wrote about a different op. The server logs the actor and the
   * key either way.
   */
  it("names the key and passes no reason", async () => {
    await openPanel();
    api.reset.mockResolvedValue(rows());
    await userEvent.click(screen.getByRole("button", { name: "Reset to BEACON_MAILBOX_TTL" }));
    expect(api.reset).toHaveBeenCalledWith(SERVER.origin, WALLET, ["mailboxTtlSeconds"]);
  });
});

describe("a failed write", () => {
  /*
   * A 400 is `setMany` refusing the whole patch before storing any of it, so nothing moved and the
   * cache is still true. Refetching would cost a signed round trip to be told what the screen
   * already holds. The refusal lands on the row it names, and the draft survives so the operator can
   * fix it rather than retype it.
   */
  it("keeps the cache and the draft when the server refused the whole patch", async () => {
    await openPanel();
    await userEvent.type(screen.getByLabelText("Display name"), " two");
    api.set.mockRejectedValue(
      new ApiError(
        400,
        JSON.stringify([
          { path: ["name"], message: "String must contain at most 60 character(s)" },
        ]),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("String must contain at most 60 character(s)")).toBeTruthy();
    expect(screen.getByText("1 pending change")).toBeTruthy();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  /*
   * Anything else can have left a partial write: the multi-key op is deliberately not atomic
   * (beacon.server `doc/spec/runtime-settings.md` §5), so a store error on key 3 of 5 leaves two
   * rows overridden with no response to show for it. Rendering the pre-write values then is the one
   * failure this screen exists to prevent, so the read goes again.
   */
  it("refetches when the write may have half-landed", async () => {
    await openPanel();
    await userEvent.type(screen.getByLabelText("Display name"), " two");
    api.set.mockRejectedValue(new ApiError(500, "store failed on key 3"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("500: store failed on key 3")).toBeTruthy();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  /*
   * A refusal naming a key the server did not report has no row to land on. Dropping it would leave
   * a save that failed with nothing on screen to say why.
   */
  it("shows a refusal about a row this screen does not have", async () => {
    await openPanel();
    await userEvent.type(screen.getByLabelText("Display name"), " two");
    api.set.mockRejectedValue(
      new ApiError(400, JSON.stringify([{ path: ["placesRadius"], message: "Required" }])),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("placesRadius: Required")).toBeTruthy();
  });
});

/*
 * The banner on every page reads `writeLocked` from the status, and the row on this screen can change
 * it, by a save or by a reset to the environment, so a write here has to refresh what the banner sees.
 */
describe("the status the lock banner reads", () => {
  const statusRead = vi.fn(() => Promise.resolve({}));
  function StatusReader() {
    useSWR(adminStatusKey(SERVER.origin, WALLET.account.did), statusRead);
    return null;
  }

  async function openWithReader(): Promise<void> {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <StatusReader />
        <SettingsPanel />
      </SWRConfig>,
    );
    await screen.findByLabelText("Display name");
    await waitFor(() => expect(statusRead).toHaveBeenCalledTimes(1));
  }

  it("is read again after a save", async () => {
    await openWithReader();
    await userEvent.type(screen.getByLabelText("Display name"), " two");
    api.set.mockResolvedValue(rows());
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(statusRead).toHaveBeenCalledTimes(2));
  });

  it("is read again after a reset", async () => {
    await openWithReader();
    api.reset.mockResolvedValue(rows());
    await userEvent.click(screen.getByRole("button", { name: /Reset to/ }));
    await waitFor(() => expect(statusRead).toHaveBeenCalledTimes(2));
  });
});

describe("an empty number box", () => {
  /*
   * The console can tell this one without asking. `setMany` validates the whole patch and throws
   * before storing any of it, so one blank box costs every other pending edit a signed round trip to
   * learn something already on screen. Named on the row as well as counted in the bar: on a 69-row
   * page, "1 number field is empty" is a hunt.
   */
  it("blocks the save and names the row", async () => {
    await openPanel();
    await userEvent.type(screen.getByLabelText("Display name"), " two");
    await userEvent.clear(screen.getByLabelText("Message TTL"));

    expect(screen.getByText("1 number field is empty.")).toBeTruthy();
    expect(screen.getByText("This field needs a number.")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.click(save);
    expect(api.set).not.toHaveBeenCalled();
  });
});
