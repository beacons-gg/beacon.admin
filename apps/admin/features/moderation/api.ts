import type { Wallet } from "@beaconsgg/identity";
import {
  adminBlocklistFetchResultReadSchema,
  type AdminBlocklistAddParams,
  type AdminBlocklistRemoveParams,
  type AdminRoomRemoveParams,
  type BlockEntry,
  type DidKey,
} from "@beaconsgg/protocol-types";
import { parseRemoved, signedPost } from "@/lib/api";

/**
 * Typed wrappers over the moderation routes (the server's admin API spec, beacon.server
 * `doc/spec/admin-api.md` §3): remove a room (rides the engine's normal close path server-side) and
 * manage the durable blocklist. Media moderation (remove/list/review) lives in `@/features/media`.
 * Every call is a signed admin op; responses are wire-parsed.
 */

export function removeRoom(
  origin: string,
  wallet: Wallet,
  id: string,
  reason?: string,
): Promise<boolean> {
  // Typed literals: params shape drift against the wire schema fails at compile time.
  const params: AdminRoomRemoveParams = { id, ...(reason ? { reason } : {}) };
  return signedPost(origin, "/admin/rooms/remove", wallet, "admin.room.remove", params).then(
    parseRemoved,
  );
}

export function blocklistFetch(origin: string, wallet: Wallet): Promise<BlockEntry[]> {
  return signedPost(origin, "/admin/blocklist/fetch", wallet, "admin.blocklist.fetch", {}).then(
    (r) => adminBlocklistFetchResultReadSchema.parse(r).entries,
  );
}

export function blocklistAdd(
  origin: string,
  wallet: Wallet,
  did: DidKey,
  reason?: string,
): Promise<void> {
  const params: AdminBlocklistAddParams = { did, ...(reason ? { reason } : {}) };
  return signedPost<{ ok: true }>(
    origin,
    "/admin/blocklist/add",
    wallet,
    "admin.blocklist.add",
    params,
  ).then(() => undefined);
}

export function blocklistRemove(origin: string, wallet: Wallet, did: DidKey): Promise<boolean> {
  const params: AdminBlocklistRemoveParams = { did };
  return signedPost(
    origin,
    "/admin/blocklist/remove",
    wallet,
    "admin.blocklist.remove",
    params,
  ).then(parseRemoved);
}
