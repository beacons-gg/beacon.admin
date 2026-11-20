import { describe, expect, it } from "vitest";
import {
  anyServerGate,
  singleServerGate,
  type GateContext,
  type GateNeed,
  type GateServer,
} from "../gate";
import { WALLET } from "./fixtures";

const NEED: GateNeed = {
  server: "moderation targets one server at a time",
  wallet: "moderation actions are signed admin ops",
};

const srv = (over: Partial<GateServer> = {}): GateServer => ({
  origin: "https://h.example",
  host: "h.example",
  capabilities: ["places"],
  ...over,
});

type W = typeof WALLET;

/*
 * The ready state, so each case below states only what it changes about it. A plain spread already
 * has the semantics the cases want: an absent key keeps the default, an explicit `undefined`
 * overrides it. Nothing reads `servers` beyond its length, so the default list need not hold
 * `active`.
 */
const ctx = (over: Partial<GateContext<GateServer, W>> = {}): GateContext<GateServer, W> => ({
  servers: [srv()],
  active: srv(),
  wallet: WALLET,
  identityChanged: [],
  checking: [],
  ...over,
});

describe("singleServerGate", () => {
  it("passes a chosen server and an unlocked wallet through, narrowed", () => {
    const gate = singleServerGate(NEED, ctx());
    expect(gate.ok).toBe(true);
    // The point of the generic: past the check, both are values rather than maybes.
    if (gate.ok) {
      expect(gate.server.host).toBe("h.example");
      expect(gate.wallet.account.did).toBe("did:key:z6MkOperator");
    }
  });

  /*
   * The sidebar lists no server to scope to while the list is empty, so "select a single server"
   * is a dead end in exactly the state a new operator starts in. An empty list is a different
   * refusal with a different remedy, and it comes first because nothing else is reachable without it.
   */
  it("sends an operator with no servers to the page that can add one", () => {
    const gate = anyServerGate(NEED, { servers: [], wallet: WALLET });
    expect(gate).toEqual({ ok: false, refusal: "Add a server on the Servers page first." });
    expect(singleServerGate(NEED, ctx({ servers: [], active: undefined }))).toEqual(gate);
  });

  it("says add-a-server before unlock, when neither is done", () => {
    const gate = singleServerGate(NEED, ctx({ servers: [], active: undefined, wallet: undefined }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.refusal).toContain("Add a server");
  });

  it("names the control that fixes it, and carries the surface's own reason", () => {
    const gate = singleServerGate(NEED, ctx({ active: undefined }));
    expect(gate).toEqual({
      ok: false,
      refusal:
        "Select a single server under Scope in the sidebar: moderation targets one server at a time.",
    });
  });

  it("asks for the wallet once a server is chosen", () => {
    const gate = singleServerGate(NEED, ctx({ wallet: undefined }));
    expect(gate).toEqual({
      ok: false,
      refusal: "Unlock the operator wallet: moderation actions are signed admin ops.",
    });
  });

  /*
   * Order is behaviour, not tidiness. With nothing chosen and nothing unlocked, an operator can only
   * act on one instruction, and "unlock the wallet" leaves them on a screen that still refuses.
   */
  it("asks for the server first when neither is ready", () => {
    const gate = singleServerGate(NEED, ctx({ active: undefined, wallet: undefined }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.refusal).toContain("Select a single server");
  });

  it("refuses a server that does not advertise the capability, by name", () => {
    const active = srv({ name: "Northwind" });
    const gate = singleServerGate({ ...NEED, capability: "media" }, ctx({ active }));
    expect(gate).toEqual({
      ok: false,
      refusal: "Northwind does not advertise the media capability.",
    });
  });

  it("identifies the server in a capability refusal even with a blank descriptor name", () => {
    const active = srv({ name: "" });
    const gate = singleServerGate({ ...NEED, capability: "media" }, ctx({ active }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.refusal).toBe("h.example does not advertise the media capability.");
  });

  /*
   * A capability sentence about a server nobody has chosen is noise, so the capability check runs
   * last rather than wherever it reads best.
   */
  it("does not talk about capabilities before a server is chosen", () => {
    const gate = singleServerGate({ ...NEED, capability: "media" }, ctx({ active: undefined }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.refusal).toContain("Select a single server");
  });

  it("admits a server that advertises the capability", () => {
    expect(singleServerGate({ ...NEED, capability: "places" }, ctx()).ok).toBe(true);
  });
});

describe("singleServerGate and the server's identity", () => {
  const CHANGED =
    "h.example is now signing with a different key than the one pinned when it was added, so the " +
    "console sends it no admin requests. Add its origin again on the Servers page to trust the new key.";

  it("sends a server whose key changed nothing, and says why and what to do, by name", () => {
    const gate = singleServerGate(NEED, ctx({ identityChanged: ["https://h.example"] }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.refusal).toBe(CHANGED);
  });

  it("waits for a server this session hasn't checked yet", () => {
    const gate = singleServerGate(NEED, ctx({ checking: ["https://h.example"] }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.refusal).toBe(
        "Checking h.example's identity before sending it any admin requests.",
      );
    }
  });

  it("refuses before asking for the wallet: unlocking would not help", () => {
    const gate = singleServerGate(
      NEED,
      ctx({ identityChanged: ["https://h.example"], wallet: undefined }),
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.refusal).toBe(CHANGED);
  });

  it("refuses before the capability rung: the capability list is only the last trusted copy", () => {
    const gate = singleServerGate(
      { ...NEED, capability: "media" },
      ctx({ identityChanged: ["https://h.example"] }),
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.refusal).toBe(CHANGED);
  });

  it("leaves every other server alone", () => {
    const others = {
      identityChanged: ["https://other.example"],
      checking: ["https://else.example"],
    };
    expect(singleServerGate(NEED, ctx(others)).ok).toBe(true);
  });
});

describe("singleServerGate and the wallet's role", () => {
  it("closes a server the wallet is not an admin of, and says how to get in", () => {
    const gate = singleServerGate(
      NEED,
      ctx({ active: srv({ name: "Ada" }), notAdmin: ["https://h.example"] }),
    );
    expect(gate).toEqual({
      ok: false,
      refusal:
        "You are not an admin of Ada, so its admin screens are closed to you. To manage it, its operator adds your DID to the server's BEACON_ADMINS.",
    });
  });

  it("asks for the wallet first: the role is the wallet's", () => {
    const gate = singleServerGate(
      NEED,
      ctx({ wallet: undefined, notAdmin: ["https://h.example"] }),
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.refusal).toMatch(/^Unlock the operator wallet/);
  });

  it("admits a server whose role is unknown, as before roles existed", () => {
    expect(singleServerGate(NEED, ctx({ notAdmin: ["https://other.example"] })).ok).toBe(true);
  });
});

describe("anyServerGate", () => {
  it("admits a fan-out surface with servers and a wallet, and answers with the wallet alone", () => {
    expect(anyServerGate(NEED, { servers: [srv()], wallet: WALLET })).toEqual({
      ok: true,
      wallet: WALLET,
    });
  });

  /* The whole point of the second entry point: a fan-out surface must not be asked to pick one. */
  it("does not ask a fan-out surface to select a single server", () => {
    const gate = anyServerGate(NEED, { servers: [srv(), srv()], wallet: undefined });
    expect(gate).toEqual({
      ok: false,
      refusal: "Unlock the operator wallet: moderation actions are signed admin ops.",
    });
  });

  it("shares the empty-list sentence with the single-server gate, so the two cannot drift", () => {
    const fanOut = anyServerGate(NEED, { servers: [], wallet: WALLET });
    const single = singleServerGate(NEED, ctx({ servers: [], active: undefined }));
    expect(fanOut.ok).toBe(false);
    expect(single.ok).toBe(false);
    if (!fanOut.ok && !single.ok) expect(fanOut.refusal).toBe(single.refusal);
  });
});
