"use client";

import type { Wallet } from "@beaconsgg/identity";
import { adminStatusReadSchema, type AdminStatus } from "@beaconsgg/protocol-types";
import useSWR from "swr";
import { ApiError, boundedClient, signedPost } from "@/lib/api";
import { useWallet } from "@/features/wallet";

/**
 * The cache key of a server's status, so a write that changes what the status says can refresh it:
 * the logical resource, never an envelope (every request signs a fresh one).
 */
export const adminStatusKey = (origin: string, did: string) => ["admin.status", origin, did];

/** How often a server's status is read, and how soon a failed read is tried again. */
const STATUS_REFRESH_MS = 30_000;

/**
 * How soon a read refused because the wallet is not an admin is tried again. Being added to
 * `BEACON_ADMINS` takes a restart, so asking every 30 seconds would only sign refusals.
 */
const NOT_ADMIN_RETRY_MS = 5 * 60_000;

/**
 * Whether a refused status read means "not an admin here" rather than "could not ask": a 403 says
 * the wallet is not on `BEACON_ADMINS`, and a 404 that the server has no admins at all (`role.ts`).
 */
export function isNotAdminError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 403 || err.status === 404);
}

/**
 * The signed `admin.status` read, wire-parsed and never cast. It has a time limit because it repeats
 * while a server may be down: one that hung through a restart would never be asked again.
 */
export function fetchAdminStatus(origin: string, wallet: Wallet): Promise<AdminStatus> {
  return signedPost<{ ok: true; status: unknown }>(
    origin,
    "/admin/status",
    wallet,
    "admin.status",
    {},
    boundedClient,
  ).then((r) => adminStatusReadSchema.parse(r.status));
}

/**
 * SWR over the signed `admin.status` read. Paused while the wallet is locked. A 30s refresh keeps
 * the dashboard live without weight: counts are aggregate-cheap by store contract.
 *
 * SWR's interval skips a key whose last read failed, so a failure is retried here at the same pace.
 * That is what lets every reader, the lock banner included, recover once a restarted server returns.
 *
 * It lives with the servers rather than the dashboard because the banner and the settings screen
 * need it too, and both sit under features the dashboard imports.
 */
export function useAdminStatus(origin: string) {
  const { wallet } = useWallet();
  return useSWR(
    wallet ? adminStatusKey(origin, wallet.account.did) : null,
    () => fetchAdminStatus(origin, wallet!),
    {
      refreshInterval: STATUS_REFRESH_MS,
      revalidateOnFocus: false,
      onErrorRetry: (err, _key, _config, revalidate, opts) => {
        const wait = isNotAdminError(err) ? NOT_ADMIN_RETRY_MS : STATUS_REFRESH_MS;
        setTimeout(() => void revalidate(opts), wait);
      },
    },
  );
}
