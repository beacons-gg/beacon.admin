"use client";

import type { Wallet } from "@beaconsgg/identity";
import type { AdminSetting } from "@beaconsgg/protocol-types";
import useSWR from "swr";
import { settingsGet } from "./api";

/** The configuration's cache key, so a write made elsewhere can hand this screen the reply. */
export const settingsKey = (origin: string, did: string) => ["admin.settings", origin, did];

/**
 * SWR over the signed `admin.settings.get` read, keyed `[resource, origin, account]` like every
 * other read in the console.
 *
 * **No refresh interval, and `revalidateOnFocus` off.** A dashboard polls because the numbers move
 * on their own; a configuration only moves when somebody changes it, and a background refetch under
 * an operator part way through editing would either discard their draft or leave the page arguing
 * with itself about which value is current. The writes hand back the whole configuration, so the
 * one thing that does change it also supplies the new state.
 */
export function useSettings(origin: string, wallet: Wallet) {
  return useSWR<AdminSetting[]>(
    settingsKey(origin, wallet.account.did),
    () => settingsGet(origin, wallet),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
}
