import { describe, expect, it, vi } from "vitest";
import { savedServer, WALLET } from "./fixtures";

/*
 * The seam under test is three lines of wiring: which provider value feeds which gate parameter.
 * It is worth its own file because it is the part of the extraction that breaks all six surfaces at
 * once and cannot be caught by testing the pure function, and because reading the wrong field
 * type-checks: `useServers()` hands back `servers`, `activeServer` AND `targets`, and the last two
 * are both `SavedServer`-shaped.
 *
 * The providers are mocked rather than rendered, so the hooks are plain function calls here. That is
 * faithful: their bodies contain no React primitives of their own, only the two `useContext` hooks
 * being replaced. It also keeps the file `.ts`, which is what `vitest.config.ts` collects
 * (`environment: "node"`, no JSX transform, component testing deferred until the UI settles).
 */

const servers = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const wallet = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const roles = vi.hoisted(() => ({ value: { notAdmin: [] as string[] } }));

vi.mock("../ServersProvider", () => ({ useServers: () => servers.value }));
vi.mock("@/features/wallet", () => ({ useWallet: () => wallet.value }));
vi.mock("../roles", () => ({ useServerRoles: () => roles.value }));

const { useAnyServer, useSingleServer } = await import("../useServerGate");

const NEED = { server: "this surface works on one server", wallet: "its ops are signed" };

const A = savedServer("a");
const B = savedServer("b");

/** `activeServer` is undefined in "all servers" mode, where `targets` is the whole list. */
function allServersMode(): void {
  servers.value = {
    servers: [A, B],
    activeServer: undefined,
    targets: [A, B],
    identityChanged: [],
  };
  wallet.value = { status: "unlocked", wallet: WALLET };
}

describe("useSingleServer", () => {
  it("hands the gate the active server, not the first of the fan-out targets", () => {
    allServersMode();
    const gate = useSingleServer(NEED);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.refusal).toContain("Select a single server");
  });

  it("hands through the server the operator actually chose", () => {
    servers.value = {
      servers: [A, B],
      activeServer: B,
      targets: [B],
      identityChanged: [],
      checking: [],
    };
    wallet.value = { status: "unlocked", wallet: WALLET };
    const gate = useSingleServer(NEED);
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.server.origin).toBe("b");
  });

  it("hands through the servers whose key changed, so the chosen one is refused", () => {
    servers.value = {
      servers: [A, B],
      activeServer: B,
      targets: [B],
      identityChanged: ["b"],
      checking: [],
    };
    wallet.value = { status: "unlocked", wallet: WALLET };
    const gate = useSingleServer(NEED);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.refusal).toContain("different key");
  });

  it("hands through the servers not yet checked, so the chosen one waits", () => {
    servers.value = {
      servers: [A, B],
      activeServer: B,
      targets: [B],
      identityChanged: [],
      checking: ["b"],
    };
    wallet.value = { status: "unlocked", wallet: WALLET };
    const gate = useSingleServer(NEED);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.refusal).toContain("Checking");
  });

  it("hands through the servers the wallet is not an admin of, so the chosen one is closed", () => {
    servers.value = {
      servers: [A, B],
      activeServer: B,
      targets: [B],
      identityChanged: [],
      checking: [],
    };
    wallet.value = { status: "unlocked", wallet: WALLET };
    roles.value = { notAdmin: ["b"] };
    const gate = useSingleServer(NEED);
    roles.value = { notAdmin: [] };
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.refusal).toContain("You are not an admin of");
  });

  /*
   * `WalletProvider` derives `status` from `wallet`, so the two always agree in the app and a wiring
   * that read `status` would pass every test built from the app's own pairing. Both disagreeing
   * pairs are needed, and the admitting direction is the one that discriminates: with a wallet in
   * hand and a stale "locked" beside it, reading the value admits and reading the string refuses.
   * Refusing a missing wallet under an "unlocked" string is true of either wiring, so on its own it
   * proves nothing. The whole "the narrowing is real" claim rests on the value being what is read.
   */
  it("gates on the wallet value rather than on the status string", () => {
    servers.value = {
      servers: [A],
      activeServer: A,
      targets: [A],
      identityChanged: [],
      checking: [],
    };

    wallet.value = { status: "locked", wallet: WALLET };
    expect(useSingleServer(NEED).ok).toBe(true);

    wallet.value = { status: "unlocked", wallet: undefined };
    const gate = useSingleServer(NEED);
    expect(gate).toEqual({ ok: false, refusal: "Unlock the operator wallet: its ops are signed." });
  });

  it("reads the saved list for the empty case, so an empty console is told to add one", () => {
    servers.value = {
      servers: [],
      activeServer: undefined,
      targets: [],
      identityChanged: [],
      checking: [],
    };
    wallet.value = { status: "unlocked", wallet: WALLET };
    const gate = useSingleServer(NEED);
    expect(gate).toEqual({ ok: false, refusal: "Add a server on the Servers page first." });
  });
});

describe("useAnyServer", () => {
  /* The reason the second entry point exists: "all servers" is this surface's normal state. */
  it("admits the fan-out surface in the mode that refuses the single-server one", () => {
    allServersMode();
    expect(useSingleServer(NEED).ok).toBe(false);
    expect(useAnyServer(NEED)).toEqual({ ok: true, wallet: WALLET });
  });

  it("still refuses an empty console", () => {
    servers.value = {
      servers: [],
      activeServer: undefined,
      targets: [],
      identityChanged: [],
      checking: [],
    };
    wallet.value = { status: "unlocked", wallet: WALLET };
    expect(useAnyServer(NEED)).toEqual({
      ok: false,
      refusal: "Add a server on the Servers page first.",
    });
  });
});
