import { createAccount, signDescriptor } from "@beaconsgg/identity";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  probeServer,
  refreshServer,
  savedServerSchema,
  ServerIdentityChanged,
  upsertServer,
} from "../registry";
import { savedServer } from "./fixtures";

// Through the SDK for real: `fetch` answers with a descriptor a server account actually signed, so
// `verifyServer` checks the signature it would check in a browser.
const serverAccount = createAccount();
const KEY = serverAccount.did;

/** A descriptor signed by `account` (the pinned server unless another is given). */
function descriptor(over: Record<string, unknown> = {}, account = serverAccount) {
  const base = {
    host: "h.example",
    key: account.did,
    name: "Old name",
    coverage: [""],
    capabilities: ["places"],
    version: "0.0.1",
    startedAt: "2026-08-01T00:00:00.000Z",
    accessLevel: "open",
    updated: "2026-08-01T00:00:00.000Z",
    ...over,
  };
  return signDescriptor(account, base as Parameters<typeof signDescriptor>[1]);
}

/** Point `fetch` at one descriptor; answers every call with it. Returns the mock for URL checks. */
function serve(body: unknown) {
  const fetch = vi.fn((_url: string) => Promise.resolve(new Response(JSON.stringify(body))));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

const server = savedServer;

describe("servers registry", () => {
  it("probes a typed address at the platform scheme-on-read origin (LAN hosts get http)", async () => {
    const fetch = serve(descriptor());
    await expect(probeServer("  beacon.example:3001 ")).resolves.toMatchObject({
      origin: "https://beacon.example:3001",
      key: KEY,
    });
    expect(fetch.mock.calls[0]?.[0]).toBe("https://beacon.example:3001/server/descriptor");
    await expect(probeServer("192.168.10.10:3001")).resolves.toMatchObject({
      origin: "http://192.168.10.10:3001",
    });
  });

  /* The descriptor says `h.example`; the console keeps the address the operator reached it by. */
  it("keeps the typed address when the server names another host", async () => {
    const fetch = serve(descriptor());
    await expect(probeServer("http://10.0.0.5:3001")).resolves.toMatchObject({
      origin: "http://10.0.0.5:3001",
      host: "h.example",
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "http://10.0.0.5:3001/server/descriptor",
    ]);
  });

  it("refuses a descriptor whose signature does not check", async () => {
    serve({ ...descriptor(), name: "spoofed" }); // body changed after signing
    await expect(probeServer("https://a.example")).rejects.toThrow(/does not verify/);
  });

  it("upsert replaces by origin and keeps the list sorted", () => {
    const list = upsertServer([server("https://b.example")], server("https://a.example"));
    expect(list.map((s) => s.origin)).toEqual(["https://a.example", "https://b.example"]);
    const refreshed = upsertServer(list, server("https://a.example", { name: "renamed" }));
    expect(refreshed).toHaveLength(2);
    expect(refreshed[0]?.name).toBe("renamed");
  });

  it("saved-server rows validate (schema guards what storage rehydrates)", () => {
    expect(savedServerSchema.parse(server("https://a.example"))).toBeTruthy();
    expect(savedServerSchema.safeParse({ origin: "nope" }).success).toBe(false);
  });
});

const FUTURE = "2999-01-01T00:00:00.000Z";

describe("refreshServer — configuration is a cache, identity is a pin", () => {
  const pinned = server("https://a.example", {
    key: KEY,
    name: "Old name",
    capabilities: ["places"],
  });

  it("picks up a capability the operator switched on after the server was added", () => {
    // The bug this exists for: the console gated its contributions UI on a copy captured at add
    // time, so turning BEACON_PLACES_PROPOSALS on left it insisting submissions were off.
    serve(descriptor({ capabilities: ["places", "places-proposals"] }));
    return expect(refreshServer(pinned)).resolves.toMatchObject({
      capabilities: ["places", "places-proposals"],
      key: KEY,
      addedAt: pinned.addedAt,
    });
  });

  it("drops a name the operator removed, rather than keeping the stale one", async () => {
    const { name } = descriptor();
    expect(name).toBeDefined(); // the pinned copy had one
    serve(descriptor({ name: undefined }));
    await expect(refreshServer(pinned)).resolves.not.toHaveProperty("name");
  });

  it("reads past a descriptor field this build does not know", async () => {
    // A newer server's descriptor. The console used to strict-parse it before verifying, so one new
    // field made the server unaddable; now the read twin drops it and the verifier sees the raw body.
    serve(descriptor({ region: "eu" }));
    await expect(refreshServer(pinned)).resolves.toMatchObject({
      key: KEY,
      capabilities: ["places"],
    });
    await expect(probeServer("https://a.example")).resolves.toMatchObject({
      key: KEY,
      host: "h.example",
    });
  });

  it("refuses to re-pin when the descriptor is signed by a different key", async () => {
    // A new identity at a familiar address. Accepting it silently would move the console's trust
    // anchor onto whoever answered — that has to be the operator's decision.
    serve(descriptor({}, createAccount()));
    await expect(refreshServer(pinned)).rejects.toBeInstanceOf(ServerIdentityChanged);
  });

  it("re-pins to the key a restore started here gives the server, and only that one", async () => {
    const restored = createAccount();
    const expecting = { ...pinned, expecting: { key: restored.did, until: FUTURE } };
    serve(descriptor({ host: "old.example" }, restored));
    const fresh = await refreshServer(expecting);
    expect(fresh).toMatchObject({ key: restored.did, host: "old.example" });
    expect(fresh).not.toHaveProperty("expecting");

    serve(descriptor({}, createAccount()));
    await expect(refreshServer(expecting)).rejects.toBeInstanceOf(ServerIdentityChanged);
  });

  it("keeps waiting for the expected key while the old one still answers", async () => {
    const expecting = { ...pinned, expecting: { key: createAccount().did, until: FUTURE } };
    serve(descriptor());
    await expect(refreshServer(expecting)).resolves.toMatchObject({
      key: KEY,
      expecting: expecting.expecting,
    });
  });

  it("stops accepting the expected key once it has lapsed", async () => {
    const restored = createAccount();
    const lapsed = {
      ...pinned,
      expecting: { key: restored.did, until: "2026-01-01T00:00:00.000Z" },
    };
    serve(descriptor({}, restored));
    await expect(refreshServer(lapsed)).rejects.toBeInstanceOf(ServerIdentityChanged);
    serve(descriptor());
    await expect(refreshServer(lapsed)).resolves.not.toHaveProperty("expecting");
  });
});
