import type { Wallet } from "@beaconsgg/identity";
import type { AdminStatus } from "@beaconsgg/protocol-types";
import { mutate } from "swr";
import { adminStatusKey, fetchAdminStatus, isNotAdminError } from "./useAdminStatus";

/**
 * Whether the unlocked wallet is an admin of each server, so the console shows a server's admin
 * controls only to its admins.
 *
 * The server has one role: a DID is on `BEACON_ADMINS` or it isn't (beacon.server
 * `doc/spec/admin-api.md`). The console learns which from the signed `admin.status` read every
 * screen already polls. A `403` (`denied`) says the wallet is not on the list, and a `404` says the
 * server has no admin surface at all. Both mean the same here: nothing this console can do there.
 * Any other outcome (still loading, a server that is down, a session that ran out) is `unknown`, and
 * a surface treats `unknown` the way it did before roles existed rather than guessing either way.
 */
export type ServerRole = "admin" | "notAdmin" | "unknown";

/** The role one status read says, from SWR's `data` and `error`. The error wins: it is the newer. */
export function roleFrom(read: { data?: AdminStatus | undefined; error?: unknown }): ServerRole {
  if (read.error !== undefined) return isNotAdminError(read.error) ? "notAdmin" : "unknown";
  return read.data ? "admin" : "unknown";
}

/**
 * Ask a server once whether `wallet` is one of its admins: what adding a server decides with. A
 * status that answers goes into the shared cache, replacing any refusal read before, so every
 * screen sees the role at once without asking again.
 */
export async function probeRole(origin: string, wallet: Wallet): Promise<ServerRole> {
  try {
    const status = await fetchAdminStatus(origin, wallet);
    void mutate(adminStatusKey(origin, wallet.account.did), status, { revalidate: false });
    return roleFrom({ data: status });
  } catch (error) {
    return roleFrom({ error });
  }
}
