import type { Wallet } from "@beaconsgg/identity";
import {
  adminAccessAdmitAllResultReadSchema,
  adminAccessEntryResultReadSchema,
  adminAccessFetchResultReadSchema,
  type AccessEntry,
  type AdminAccessDidParams,
  type DidKey,
} from "@beaconsgg/protocol-types";
import { parseRemoved, signedPost } from "@/lib/api";

/**
 * Typed wrappers over the member list routes (the server's admin API spec, beacon.server
 * `doc/spec/admin-api.md` §6): who may write to a server at `request` or `private`, and the requests
 * to join waiting for an answer. Every call is a signed admin op; replies are wire-parsed.
 */

export function accessFetch(origin: string, wallet: Wallet): Promise<AccessEntry[]> {
  return signedPost(origin, "/admin/access/fetch", wallet, "admin.access.fetch", {}).then(
    (r) => adminAccessFetchResultReadSchema.parse(r).entries,
  );
}

/** Make `did` a member, approving its request if it has one. */
export function accessAdd(origin: string, wallet: Wallet, did: DidKey): Promise<AccessEntry> {
  const params: AdminAccessDidParams = { did };
  return signedPost(origin, "/admin/access/add", wallet, "admin.access.add", params).then(
    (r) => adminAccessEntryResultReadSchema.parse(r).entry,
  );
}

/** Decline `did`'s pending request. */
export function accessDecline(origin: string, wallet: Wallet, did: DidKey): Promise<AccessEntry> {
  const params: AdminAccessDidParams = { did };
  return signedPost(origin, "/admin/access/decline", wallet, "admin.access.decline", params).then(
    (r) => adminAccessEntryResultReadSchema.parse(r).entry,
  );
}

/** Remove `did`'s entry: a member loses write access, and a declined player may ask again. */
export function accessRemove(origin: string, wallet: Wallet, did: DidKey): Promise<boolean> {
  const params: AdminAccessDidParams = { did };
  return signedPost(origin, "/admin/access/remove", wallet, "admin.access.remove", params).then(
    parseRemoved,
  );
}

/** Make a member of every account with a profile on the server and no entry; the count added. */
export function accessAdmitAll(origin: string, wallet: Wallet): Promise<number> {
  return signedPost(origin, "/admin/access/admitAll", wallet, "admin.access.admitAll", {}).then(
    (r) => adminAccessAdmitAllResultReadSchema.parse(r).added,
  );
}
