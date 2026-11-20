import type { AdminStatusCounts } from "@beaconsgg/protocol-types";

/** The share of its limit a server's media may fill before the console says it is getting full. */
export const MEDIA_NEARLY_FULL = 0.8;

/**
 * How a server's media stands against the limit its host set (`mediaLimitBytes`), or `undefined`
 * for a server without one: what is used, what the limit is, and the room left, never below zero.
 * Given `capabilities`, also `undefined` for a server with media off: a host gives one with no
 * storage a limit of nothing, which is no news to its operator.
 */
export function mediaRoom(
  counts: Pick<AdminStatusCounts, "mediaBytes" | "mediaLimitBytes">,
  capabilities?: readonly string[],
): { used: number; limit: number; room: number; nearlyFull: boolean } | undefined {
  const limit = counts.mediaLimitBytes;
  if (limit === undefined || (capabilities && !capabilities.includes("media"))) return undefined;
  const used = counts.mediaBytes;
  return {
    used,
    limit,
    room: Math.max(0, limit - used),
    nearlyFull: limit === 0 || used / limit >= MEDIA_NEARLY_FULL,
  };
}
