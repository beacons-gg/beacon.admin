import { createWallet, verifyOp } from "@beaconsgg/identity";
import { opEnvelopeSchema } from "@beaconsgg/protocol-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectoryError, fetchListing, listingUrl, removeListing } from "../api";
import { DEFAULT_DIRECTORY, directoryOrigin } from "../config";
import { directoryReplies, HOSTED, NONCE } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

const DIRECTORY = DEFAULT_DIRECTORY;
const HOST = "alpha.example";
const BASE = `${DIRECTORY}/api/v1/servers/${HOST}`;
const wallet = createWallet();

/** The error a call rejected with, so a test can read its code and its sentence. */
async function failure(promise: Promise<unknown>): Promise<DirectoryError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DirectoryError);
  return err as DirectoryError;
}

describe("removeListing", () => {
  it("asks for a challenge, signs admin.status with the issued nonce, then removes", async () => {
    const sent = directoryReplies([
      [{ ok: true, nonce: NONCE, expiresAt: "2026-11-17T12:10:00.000Z" }, 201],
      [{ ok: true, removed: true }, 200],
    ]);
    await expect(removeListing(DIRECTORY, "Alpha.Example", wallet)).resolves.toBeUndefined();

    const [challenge, remove] = sent();
    expect(challenge).toMatchObject({ url: `${BASE}/challenge`, method: "POST", body: undefined });
    expect(remove).toMatchObject({ url: `${BASE}/remove`, method: "POST" });
    expect(remove?.credentials).toBe("omit");

    const { envelope } = remove?.body as { envelope: unknown };
    const env = opEnvelopeSchema.parse(envelope);
    expect(env.op).toBe("admin.status");
    expect(env.params).toEqual({});
    expect(env.nonce).toBe(NONCE);
    expect(env.actor).toBe(wallet.account.did);
    expect(env).not.toHaveProperty("game");
    expect(verifyOp(env).ok).toBe(true);
  });

  it("stops at a hosted listing with the directory's own sentence", async () => {
    const sent = directoryReplies([[HOSTED, 409]]);
    const err = await failure(removeListing(DIRECTORY, HOST, wallet));
    expect(err.code).toBe("hosted");
    expect(err.message).toBe(HOSTED.message);
    expect(sent()).toHaveLength(1);
  });

  it("says when the server denies the wallet", async () => {
    const message = "The server says this identity is not one of its admins.";
    directoryReplies([
      [{ ok: true, nonce: NONCE, expiresAt: "2026-11-17T12:10:00.000Z" }, 201],
      [{ ok: false, error: "denied", message }, 403],
    ]);
    const err = await failure(removeListing(DIRECTORY, HOST, wallet));
    expect(err.code).toBe("denied");
    expect(err.message).toBe(message);
  });

  it("names the directory in use when it words the hosted refusal itself", async () => {
    directoryReplies([[{ ok: false, error: "hosted" }, 409]]);
    const err = await failure(removeListing("https://dir.example", HOST, wallet));
    expect(err.message).toContain("List on dir.example");
  });

  it("words a refusal itself when the directory gives no message", async () => {
    directoryReplies([
      [{ ok: true, nonce: NONCE, expiresAt: "2026-11-17T12:10:00.000Z" }, 201],
      [{ ok: false, error: "denied" }, 403],
    ]);
    const err = await failure(removeListing(DIRECTORY, HOST, wallet));
    expect(err.message).toMatch(/not one of its admins.*BEACON_ADMINS/);
  });

  it("says when the directory could not reach the server", async () => {
    const message = "The server did not answer at https://alpha.example within 10 seconds.";
    directoryReplies([
      [{ ok: true, nonce: NONCE, expiresAt: "2026-11-17T12:10:00.000Z" }, 201],
      [{ ok: false, error: "unreachable", message }, 502],
    ]);
    const err = await failure(removeListing(DIRECTORY, HOST, wallet));
    expect(err.code).toBe("unreachable");
    expect(err.message).toBe(message);
  });

  it("says when the directory itself can't be reached, and signs nothing", async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    vi.stubGlobal("fetch", fetch);
    const err = await failure(removeListing(DIRECTORY, HOST, wallet));
    expect(err.code).toBe("network");
    expect(err.message).toMatch(/could not reach the directory at beacons\.gg/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("names the status of an answer that is not the directory's", async () => {
    directoryReplies([["<html>Bad gateway</html>", 504]]);
    const err = await failure(removeListing(DIRECTORY, HOST, wallet));
    expect(err.message).toMatch(/status 504/);
  });

  it("refuses a challenge it can't read before signing", async () => {
    const sent = directoryReplies([[{ ok: true }, 201]]);
    const err = await failure(removeListing(DIRECTORY, HOST, wallet));
    expect(err.code).toBe("unreadable");
    expect(sent()).toHaveLength(1);
  });
});

describe("fetchListing", () => {
  it("reads 200 as listed and 404 as not listed", async () => {
    const sent = directoryReplies([
      [{ ok: true, server: {} }, 200],
      [{ ok: false, error: "notFound" }, 404],
    ]);
    await expect(fetchListing(DIRECTORY, HOST)).resolves.toBe("listed");
    await expect(fetchListing(DIRECTORY, HOST)).resolves.toBe("notListed");
    expect(sent()[0]).toMatchObject({ url: BASE, method: "GET" });
  });

  it("reads a 404 that is not the directory's own as an answer it can't read", async () => {
    directoryReplies([["<html>Not Found</html>", 404]]);
    expect((await failure(fetchListing("https://wrong.example", HOST))).code).toBe("unreadable");
  });

  it("throws for a directory that can't be reached or answers anything else", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    expect((await failure(fetchListing(DIRECTORY, HOST))).code).toBe("network");

    directoryReplies([[{}, 500]]);
    expect((await failure(fetchListing(DIRECTORY, HOST))).message).toMatch(/status 500/);
  });
});

describe("the directory address", () => {
  it("keeps only the origin of an http(s) address", () => {
    expect(directoryOrigin(" https://dir.example/servers/ ")).toBe("https://dir.example");
    expect(directoryOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(directoryOrigin("dir.example")).toBeUndefined();
    expect(directoryOrigin("ftp://dir.example")).toBeUndefined();
    // The directory receives a signed admin read, so plain http only reaches this computer.
    expect(directoryOrigin("http://dir.example")).toBeUndefined();
    expect(directoryOrigin("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });

  it("links the listing's page in lower case", () => {
    expect(listingUrl(DIRECTORY, "Alpha.Example")).toBe(`${DIRECTORY}/servers/alpha.example`);
  });
});
