import { verifyOp } from "@beaconsgg/identity";
import { createWallet } from "@beaconsgg/identity";
import { opEnvelopeSchema, UNDERSTANDS_HEADER } from "@beaconsgg/protocol-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isFault, isRefusal, ServerError } from "@beaconsgg/client-sdk";
import {
  ApiError,
  clientFor,
  describeApiError,
  GAME_NOT_ADMITTED,
  getJson,
  signedPost,
  signedUpload,
  UNKNOWN_PLACE,
  UNKNOWN_PROPOSAL,
  UNKNOWN_RUN,
  WRITE_LOCKED,
} from "../api";
import { LOCKED, stubFetch } from "./fetchStub";

afterEach(() => vi.unstubAllGlobals());

describe("signedPost — the one signed-request shape", () => {
  it("POSTs a wire-valid, offline-verifiable envelope and returns the JSON body", async () => {
    const wallet = createWallet();
    const get = stubFetch({ ok: true, value: 7 });

    const out = await signedPost<{ ok: true; value: number }>(
      "https://s.example",
      "/admin/status",
      wallet,
      "admin.status",
      {},
    );
    expect(out.value).toBe(7);
    const { url, body } = get();
    expect(url).toBe("https://s.example/admin/status");
    const env = opEnvelopeSchema.parse(body);
    expect(env.op).toBe("admin.status");
    expect(env.actor).toBe(wallet.account.did);
    expect(verifyOp(env, Date.now()).ok).toBe(true);
  });

  it("maps a non-2xx wire error to ApiError and to operator copy", async () => {
    stubFetch({ ok: false, error: "denied", message: "not an admin" }, 403);
    const err = await signedPost("https://s.example", "/admin/status", createWallet(), "x", {})
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect(describeApiError(err)).toMatch(/BEACON_ADMINS/);
    expect(describeApiError(new ApiError(404, "x"))).toMatch(/admin surface/);
  });
});

describe("signedUpload — the {env, data} upload shape", () => {
  it("sends the attestation it was given beside the bytes", async () => {
    const wallet = createWallet();
    const get = stubFetch({ ok: true, id: "h@s.example" });
    const params = { hash: "h", type: "image/webp", size: 3 };
    await signedUpload("https://s.example", "/media", wallet, "media.put", params, "AAAA");
    const { url, body } = get();
    expect(url).toBe("https://s.example/media");
    const { env, data } = body as { env: unknown; data: string };
    expect(data).toBe("AAAA");
    // `size` and `hash` are the integrity link the server re-checks against the bytes.
    expect(opEnvelopeSchema.parse(env)).toMatchObject({ op: "media.put", params });
    expect(verifyOp(opEnvelopeSchema.parse(env), Date.now()).ok).toBe(true);
  });
});

describe("describeApiError", () => {
  it("says a server fault once, rather than as '500: server error 500'", () => {
    expect(describeApiError(new ServerError(503))).toBe("Server error 503.");
    expect(describeApiError(new ApiError(500, "boom"))).toBe("500: boom");
  });
});

/* The server's 404s that name what is missing (beacon.server#104), sent only to a client that declares them. */
describe("the missing-thing codes", () => {
  it("declares the three a console write can get, on a signed write", async () => {
    let header: string | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        header = new Headers(init.headers).get(UNDERSTANDS_HEADER);
        return Promise.resolve(Response.json({ ok: true }));
      }),
    );
    await signedPost("https://s.example", "/places/admin/edit", createWallet(), "places.edit", {});
    expect(header?.split(",").sort()).toEqual([
      "code:unknownPlace",
      "code:unknownProposal",
      "code:unknownRun",
    ]);
  });

  it.each([
    ["unknownPlace", 404, UNKNOWN_PLACE],
    ["unknownProposal", 404, UNKNOWN_PROPOSAL],
    ["unknownRun", 404, UNKNOWN_RUN],
    // A proposal review whose place retired, a 400 every client has always received.
    ["unknownPlace", 400, UNKNOWN_PLACE],
  ] as const)("words %s at %i, not as a missing admin surface", async (code, status, sentence) => {
    stubFetch({ ok: false, error: code, message: "missing" }, status);
    const err = await signedPost("https://s.example", "/places/admin/edit", createWallet(), "x", {})
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(describeApiError(err)).toBe(sentence);
  });

  it("still words a bare unknownRoute as a missing admin surface", () => {
    expect(describeApiError(new ApiError(404, "x", "unknownRoute"))).toMatch(/admin surface/);
  });
});

describe("a server locked read-only", () => {
  const write = () =>
    signedPost("https://s.example", "/places/admin/run", createWallet(), "x", {})
      .then(() => undefined)
      .catch((e: unknown) => e);

  it("reads as the lock, not as a server fault", async () => {
    stubFetch(LOCKED, 503);
    const err = await write();
    expect(err).not.toBeInstanceOf(ServerError);
    expect(err).toMatchObject({ status: 503, code: "writeLocked" });
    expect(describeApiError(err)).toBe(WRITE_LOCKED);
  });

  it("reads the code, whatever the message says", () => {
    expect(describeApiError(new ApiError(503, "locked read-only", "writeLocked"))).toBe(
      WRITE_LOCKED,
    );
    expect(describeApiError(new ApiError(503, "locked", "writeLocked", 60))).toBe(WRITE_LOCKED);
  });

  /* The SDK throws the lock as a refusal from every call: a strict one and a game-facing one. */
  it.each([
    ["strict", "postSignedOrThrow"],
    ["game-facing", "postSigned"],
  ] as const)("does the same for a game plugin's %s call", async (_case, call) => {
    stubFetch(LOCKED, 503);
    const err = await clientFor("game-a")
      [call]("https://s.example", "/rooms", createWallet(), { op: "x", params: {} })
      .catch((e: unknown) => e);
    expect(isRefusal(err)).toBe(true);
    expect(err).toMatchObject({ status: 503, code: "writeLocked" });
    expect(describeApiError(err)).toBe(WRITE_LOCKED);
  });

  /* A proxy in front of a dead server answers 503 too, and must not tell anybody to unlock it. */
  it.each([
    ["a body with another code", { ok: false, error: "unavailable", message: "busy" }],
    ["a body that is not an error", { ok: true }],
    ["the code without ok: false", { error: "writeLocked", message: "busy" }],
  ])("leaves a 503 with %s alone", async (_case, body) => {
    stubFetch(body, 503);
    const err = await write();
    expect(isFault(err)).toBe(true);
    expect((err as ApiError).code).not.toBe("writeLocked");
    expect(describeApiError(err)).not.toBe(WRITE_LOCKED);
  });

  it("leaves a 503 that is not JSON alone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("<html>Bad gateway</html>", { status: 503 }))),
    );
    const err = await write();
    expect(isFault(err)).toBe(true);
    expect(describeApiError(err)).toBe("Server error 503.");
  });
});

describe("a server that does not admit a plugin's game", () => {
  const refused = { ok: false, error: "gameNotAdmitted", message: "game not admitted" };
  const pluginWrite = () =>
    clientFor("game-a")
      .postSignedOrThrow("https://s.example", "/media", createWallet(), { op: "x", params: {} })
      .catch((e: unknown) => e);

  it("reads as the game's refusal, not as a wallet missing from BEACON_ADMINS", async () => {
    stubFetch(refused, 403);
    const err = await pluginWrite();
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "gameNotAdmitted" });
    expect(describeApiError(err)).toBe(GAME_NOT_ADMITTED);
  });

  it("hands a game-facing call the server's refusal as its answer, untouched", async () => {
    stubFetch(refused, 403);
    const out = await clientFor("game-a").postSigned(
      "https://s.example",
      "/media",
      createWallet(),
      {
        op: "x",
        params: {},
      },
    );
    expect(out).toEqual(refused);
  });

  it("leaves any other 403 as the admin refusal", async () => {
    stubFetch({ ok: false, error: "denied", message: "not an admin" }, 403);
    expect(describeApiError(await pluginWrite())).toMatch(/BEACON_ADMINS/);
  });
});

describe("the console's client", () => {
  it("sends every request with no timeout, as the console always has", async () => {
    // An operator at a desk sees the spinner and can reload. Configured as `timeoutMs: null`; an
    // unset timeout would quietly give every console request the SDK's 15 s default.
    const fetch = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }))),
    );
    vi.stubGlobal("fetch", fetch);
    await getJson("https://a.example", "/server/descriptor");
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty("signal");
  });
});
