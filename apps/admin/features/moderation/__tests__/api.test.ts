import { createWallet } from "@beaconsgg/identity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signedRequest, stubFetch } from "@/lib/__tests__/fetchStub";
import { blocklistAdd, blocklistFetch, blocklistRemove } from "../api";

afterEach(() => vi.unstubAllGlobals());

const ORIGIN = "https://s.example";
const BLOCKED = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH";
const wallet = createWallet();

describe("moderation api: signed wrappers over the server's blocklist", () => {
  it("blocklistFetch signs admin.blocklist.fetch and returns the parsed entries", async () => {
    const entry = {
      did: BLOCKED,
      reason: "spam",
      addedBy: "env",
      addedAt: "2026-07-01T00:00:00.000Z",
    };
    const get = stubFetch({ ok: true, entries: [entry] });

    await expect(blocklistFetch(ORIGIN, wallet)).resolves.toEqual([entry]);
    expect(signedRequest(get)).toEqual({
      url: `${ORIGIN}/admin/blocklist/fetch`,
      op: "admin.blocklist.fetch",
      params: {},
    });
  });

  it("blocklistAdd signs admin.blocklist.add with the account and reason", async () => {
    const get = stubFetch({ ok: true });

    await blocklistAdd(ORIGIN, wallet, BLOCKED, "spam");
    expect(signedRequest(get)).toEqual({
      url: `${ORIGIN}/admin/blocklist/add`,
      op: "admin.blocklist.add",
      params: { did: BLOCKED, reason: "spam" },
    });
  });

  it("blocklistRemove signs admin.blocklist.remove and returns the removed flag", async () => {
    const get = stubFetch({ ok: true, removed: true });

    await expect(blocklistRemove(ORIGIN, wallet, BLOCKED)).resolves.toBe(true);
    expect(signedRequest(get)).toEqual({
      url: `${ORIGIN}/admin/blocklist/remove`,
      op: "admin.blocklist.remove",
      params: { did: BLOCKED },
    });
  });
});
