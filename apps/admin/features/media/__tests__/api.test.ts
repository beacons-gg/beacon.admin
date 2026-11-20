import { createWallet, verifyOp } from "@beaconsgg/identity";
import { opEnvelopeSchema } from "@beaconsgg/protocol-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "@/lib/__tests__/fetchStub";
import { listMedia, removeMedia, reviewMedia } from "../api";

afterEach(() => vi.unstubAllGlobals());

const OWNER = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH";

/** One listed media object, as the server answers it; `over` adds or replaces fields. */
const item = (over: Record<string, unknown> = {}) => ({
  hash: "h1",
  type: "image/png",
  size: 10,
  owner: OWNER,
  uploadedAt: "2026-07-01T00:00:00.000Z",
  lastAccessAt: null,
  reviewedAt: null,
  reviewedBy: null,
  ...over,
});

describe("media feature api — signed wrappers over the admin media surface", () => {
  it("listMedia signs admin.media.list, forwards filters, and returns the parsed page", async () => {
    const wallet = createWallet();
    const get = stubFetch({
      ok: true,
      items: [item()],
      nextCursor: "c1",
    });

    const page = await listMedia("https://s.example", wallet, {
      limit: 2,
      reviewed: "unreviewed",
      sort: "size",
    });
    expect(page.items.map((i) => i.hash)).toEqual(["h1"]);
    expect(page.nextCursor).toBe("c1");

    const { url, body } = get();
    expect(url).toBe("https://s.example/admin/media/list");
    const env = opEnvelopeSchema.parse(body);
    expect(env.op).toBe("admin.media.list");
    expect(env.params).toMatchObject({ limit: 2, reviewed: "unreviewed", sort: "size" });
    expect(verifyOp(env, Date.now()).ok).toBe(true);
  });

  it("keeps reading a page a newer server has grown fields on", async () => {
    const wallet = createWallet();
    stubFetch({
      ok: true,
      items: [
        item({ width: 640 }), // a field this console predates
      ],
      total: 1, // and one on the page itself
    });
    const page = await listMedia("https://s.example", wallet, {});
    expect(page.items.map((i) => i.hash)).toEqual(["h1"]);
    expect(page.items[0]).not.toHaveProperty("width");
    expect(page).not.toHaveProperty("total");
  });

  it("reviewMedia signs admin.media.review with hash+reviewed(+reason) and returns the stamp", async () => {
    const wallet = createWallet();
    const at = "2026-07-02T00:00:00.000Z";
    const get = stubFetch({ ok: true, reviewedAt: at, reviewedBy: wallet.account.did });

    const res = await reviewMedia("https://s.example", wallet, "h1", true, "looks fine");
    expect(res).toEqual({ reviewedAt: at, reviewedBy: wallet.account.did });

    const { url, body } = get();
    expect(url).toBe("https://s.example/admin/media/review");
    const env = opEnvelopeSchema.parse(body);
    expect(env.op).toBe("admin.media.review");
    expect(env.params).toEqual({ hash: "h1", reviewed: true, reason: "looks fine" });
  });

  it("removeMedia signs admin.media.remove and returns the removed flag", async () => {
    const wallet = createWallet();
    const get = stubFetch({ ok: true, removed: true });

    expect(await removeMedia("https://s.example", wallet, "h1", "spam")).toBe(true);
    const { url, body } = get();
    expect(url).toBe("https://s.example/admin/media/remove");
    const env = opEnvelopeSchema.parse(body);
    expect(env.op).toBe("admin.media.remove");
    expect(env.params).toEqual({ hash: "h1", reason: "spam" });
  });
});
