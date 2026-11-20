/**
 * The operator's places reads. A player's list leaves out a place under a category the build has
 * never heard of; the console's browse must not, because an operator cannot moderate what they
 * cannot see. The browse fails the read instead.
 */
import { createWallet, sha256Base64url, verifyOp } from "@beaconsgg/identity";
import { opEnvelopeSchema } from "@beaconsgg/protocol-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCKED, stubFetch } from "@/lib/__tests__/fetchStub";
import { importAtlas, queryPlaces, surveyAtlas, uploadAtlas } from "../api";

afterEach(() => vi.unstubAllGlobals());

/** A GET's reply (the shared `stubFetch` reads a POST body). */
const reply = (body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body)))),
  );

const place = (unique: string, category: string) => ({
  unique,
  category,
  point: { lat: 1, lng: 2 },
  hasGeometry: false,
  hasDescription: false,
  updatedAt: "2026-09-25T00:00:00.000Z",
});
const result = (...places: unknown[]) => ({ places, attribution: [], truncated: false });
const A = "01J00000000000000000000000";
const B = "01J00000000000000000000001";

describe("queryPlaces", () => {
  it("reads a list it knows, dropping a key a newer server added", async () => {
    reply(result({ ...place(A, "park"), rating: 4 }));
    await expect(queryPlaces("https://s.example", ["c23nb"], [])).resolves.toEqual(
      result(place(A, "park")),
    );
  });

  it("asks for a spread page only when told to", async () => {
    reply(result());
    await queryPlaces("https://s.example", ["c23nb"], []);
    await queryPlaces("https://s.example", ["c23nb"], [], { spread: true });
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls[0]).not.toContain("spread");
    expect(urls[1]).toContain("spread=1");
  });

  it("fails on a place under a category it has never heard of, rather than leave it out", async () => {
    reply(result(place(A, "park"), place(B, "volcano")));
    await expect(queryPlaces("https://s.example", ["c23nb"], [])).rejects.toMatchObject({
      name: "ZodError",
      issues: [expect.objectContaining({ path: ["places", 1, "category"] })],
    });
  });
});

describe("uploadAtlas", () => {
  it("signs the archive's hash and size into the header and sends the raw bytes", async () => {
    const wallet = createWallet();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    let sentInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        sentInit = init;
        return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 400 }));
      }),
    );
    // The reply is a refusal; what matters here is the request that went out.
    // jsdom's `File` has no `arrayBuffer()`; the upload reads nothing else from it.
    const file = { arrayBuffer: () => Promise.resolve(bytes.buffer) } as unknown as File;
    await uploadAtlas("https://s.example", wallet, file).catch(() => undefined);
    const headers = sentInit?.headers as Record<string, string>;
    const env = opEnvelopeSchema.parse(JSON.parse(atob(headers["x-beacon-op"]!)));
    expect(env).toMatchObject({
      op: "places.atlas.upload",
      params: { hash: await sha256Base64url(bytes), size: bytes.length },
    });
    expect(verifyOp(env, Date.now()).ok).toBe(true);
    expect(sentInit?.body).toEqual(bytes);
  });
});

describe("Atlas survey and import", () => {
  const PUBLISHER = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH";

  it("surveyAtlas signs places.atlas.survey with the params as given and reads the survey", async () => {
    const wallet = createWallet();
    const get = stubFetch({
      ok: true,
      survey: { status: "running", tilesDone: 3, tilesTotal: 10, eta: 4 },
    });
    await expect(
      surveyAtlas("https://s.example", wallet, { url: "https://h/v/1/", cells: ["9q5"] }),
    ).resolves.toEqual({ status: "running", tilesDone: 3, tilesTotal: 10 });
    const { url, body } = get();
    expect(url).toBe("https://s.example/places/admin/atlas/survey");
    const env = opEnvelopeSchema.parse(body);
    expect(env).toMatchObject({
      op: "places.atlas.survey",
      params: { url: "https://h/v/1/", cells: ["9q5"] },
    });
    expect(verifyOp(env, Date.now()).ok).toBe(true);
  });

  it("surveyAtlas surfaces an older server's 404 as an ApiError the card can tell apart", async () => {
    stubFetch({ ok: false, error: "not found" }, 404);
    await expect(
      surveyAtlas("https://s.example", createWallet(), { path: "us-west" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  /* The one request sent outside the SDK still says why a locked server refused it. */
  it("uploadAtlas reads a locked server's 503 as the lock", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(LOCKED), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    // jsdom's `File` has no `arrayBuffer()`; the upload reads nothing else from it.
    const file = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)) } as unknown as File;
    await expect(uploadAtlas("https://s.example", createWallet(), file)).rejects.toMatchObject({
      status: 503,
      code: "writeLocked",
    });
  });

  it("importAtlas sends categories and options through untouched", async () => {
    const wallet = createWallet();
    const get = stubFetch({}, 400);
    const params = {
      url: "https://h/v/1/",
      publisher: PUBLISHER,
      categories: ["park" as const],
      options: {
        skipTypes: [{ category: "park" as const, subcategory: "playground" }],
        importPhotos: false,
      },
    };
    // The reply is a refusal; what matters here is the request that went out.
    await importAtlas("https://s.example", wallet, params).catch(() => undefined);
    expect(opEnvelopeSchema.parse(get().body).params).toEqual(params);
  });
});
