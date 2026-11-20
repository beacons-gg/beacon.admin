import type { Wallet } from "@beaconsgg/identity";
import {
  adminMediaListReadSchema,
  adminMediaReviewReadSchema,
  type AdminMediaList,
  type AdminMediaListParams,
  type AdminMediaRemoveParams,
  type AdminMediaReview,
  type AdminMediaReviewParams,
} from "@beaconsgg/protocol-types";
import { parseRemoved, signedPost } from "@/lib/api";

/**
 * Typed wrappers over the admin media routes (the server's admin API spec, beacon.server
 * `doc/spec/admin-api.md` §3): browse (`admin.media.list`), review-toggle (`admin.media.review`),
 * and remove (`admin.media.remove`, owned here so both this feature and moderation call one wire
 * seam). Every call is a signed admin op; the server wraps its payload in `{ ok, ... }`, and the
 * read twins drop `ok` along with anything else they do not know.
 */

/** One newest-first, filtered page of the media store (an opaque `cursor` walks subsequent pages). */
export function listMedia(
  origin: string,
  wallet: Wallet,
  params: AdminMediaListParams,
): Promise<AdminMediaList> {
  return signedPost(origin, "/admin/media/list", wallet, "admin.media.list", params).then((page) =>
    adminMediaListReadSchema.parse(page),
  );
}

/** Mark one object reviewed (or clear the stamp); returns the resulting `{reviewedAt, reviewedBy}`. */
export function reviewMedia(
  origin: string,
  wallet: Wallet,
  hash: string,
  reviewed: boolean,
  reason?: string,
): Promise<AdminMediaReview> {
  const params: AdminMediaReviewParams = { hash, reviewed, ...(reason ? { reason } : {}) };
  return signedPost(origin, "/admin/media/review", wallet, "admin.media.review", params).then((r) =>
    adminMediaReviewReadSchema.parse(r),
  );
}

/** Delete a media object (blob bytes + metadata) by content hash; `false` for an unknown hash. */
export function removeMedia(
  origin: string,
  wallet: Wallet,
  hash: string,
  reason?: string,
): Promise<boolean> {
  const params: AdminMediaRemoveParams = { hash, ...(reason ? { reason } : {}) };
  return signedPost(origin, "/admin/media/remove", wallet, "admin.media.remove", params).then(
    parseRemoved,
  );
}
