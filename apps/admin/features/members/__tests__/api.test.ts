import { createWallet } from "@beaconsgg/identity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signedRequest, stubFetch } from "@/lib/__tests__/fetchStub";
import { accessAdd, accessAdmitAll, accessDecline, accessFetch, accessRemove } from "../api";

afterEach(() => vi.unstubAllGlobals());

const ORIGIN = "https://s.example";
const DID = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH";
const wallet = createWallet();
const entry = {
  did: DID,
  status: "pending",
  note: "it's Ana",
  requestedAt: "2026-11-15T00:00:00Z",
};

describe("members api: signed wrappers over the server's member list", () => {
  it("accessFetch signs admin.access.fetch and returns the parsed entries", async () => {
    const get = stubFetch({ ok: true, entries: [{ ...entry, later: 1 }] });
    await expect(accessFetch(ORIGIN, wallet)).resolves.toEqual([entry]);
    expect(signedRequest(get)).toEqual({
      url: `${ORIGIN}/admin/access/fetch`,
      op: "admin.access.fetch",
      params: {},
    });
  });

  it("accessAdd and accessDecline sign their op with the account and return the entry", async () => {
    const member = { ...entry, status: "member", decidedBy: DID, decidedAt: entry.requestedAt };
    const add = stubFetch({ ok: true, entry: member });
    await expect(accessAdd(ORIGIN, wallet, DID)).resolves.toEqual(member);
    expect(signedRequest(add)).toEqual({
      url: `${ORIGIN}/admin/access/add`,
      op: "admin.access.add",
      params: { did: DID },
    });

    const declined = { ...member, status: "declined" };
    const decline = stubFetch({ ok: true, entry: declined });
    await expect(accessDecline(ORIGIN, wallet, DID)).resolves.toEqual(declined);
    expect(signedRequest(decline).op).toBe("admin.access.decline");
  });

  it("accessRemove returns the removed flag and accessAdmitAll the count", async () => {
    const remove = stubFetch({ ok: true, removed: true });
    await expect(accessRemove(ORIGIN, wallet, DID)).resolves.toBe(true);
    expect(signedRequest(remove)).toEqual({
      url: `${ORIGIN}/admin/access/remove`,
      op: "admin.access.remove",
      params: { did: DID },
    });

    const admit = stubFetch({ ok: true, added: 12 });
    await expect(accessAdmitAll(ORIGIN, wallet)).resolves.toBe(12);
    expect(signedRequest(admit).op).toBe("admin.access.admitAll");
  });
});
