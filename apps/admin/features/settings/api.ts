import type { Wallet } from "@beaconsgg/identity";
import {
  adminSettingsReadSchema,
  type AdminSetting,
  type AdminSettingsResetParams,
  type AdminSettingsSetParams,
} from "@beaconsgg/protocol-types";
import { signedPost } from "@/lib/api";
import type { Draft } from "./logic";

/**
 * Typed wrappers over the three settings ops (the server's runtime settings spec, beacon.server
 * `doc/spec/runtime-settings.md` §5). Every call is a signed admin op and every one answers with
 * the **whole** configuration, so all three parse to the same thing.
 *
 * A write returning everything is the server's design rather than an accident: it can move a field
 * the caller never named, since turning `placesEnabled` off forces its dependants off with it. That
 * is why nothing here returns "what changed" and why the caller replaces its state wholesale instead
 * of re-reading.
 */

/* All three routes answer `{ ok: true, settings }`; the read twin drops `ok` with anything else it does not know. */
function settings(result: unknown): AdminSetting[] {
  return adminSettingsReadSchema.parse(result).settings; // wire-parsed, never cast
}

export function settingsGet(origin: string, wallet: Wallet): Promise<AdminSetting[]> {
  return signedPost(origin, "/admin/settings/get", wallet, "admin.settings.get", {}).then(settings);
}

export function settingsSet(
  origin: string,
  wallet: Wallet,
  patch: Draft,
  reason?: string,
): Promise<AdminSetting[]> {
  // Typed literals: params shape drift against the wire schema fails at compile time.
  const params: AdminSettingsSetParams = { settings: patch, ...(reason ? { reason } : {}) };
  return signedPost(origin, "/admin/settings/set", wallet, "admin.settings.set", params).then(
    settings,
  );
}

export function settingsReset(
  origin: string,
  wallet: Wallet,
  keys: readonly string[],
  reason?: string,
): Promise<AdminSetting[]> {
  const params: AdminSettingsResetParams = { keys: [...keys], ...(reason ? { reason } : {}) };
  return signedPost(origin, "/admin/settings/reset", wallet, "admin.settings.reset", params).then(
    settings,
  );
}
