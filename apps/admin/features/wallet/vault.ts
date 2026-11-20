import { isWrongPassphrase, passphraseVault } from "@beaconsgg/client-sdk";
import { describeApiError } from "@/lib/api";
import { localKeyStore } from "@/lib/storage";

/**
 * The operator's wallet custody (the server's admin API spec, beacon.server `doc/spec/admin-api.md`
 * §1): the SDK's passphrase vault over this browser's storage. The account DID it unlocks is what
 * goes on `BEACON_ADMINS`; the key is the one the console has always used, so a wallet saved before
 * the SDK still unlocks.
 *
 * Each unlock is a session of the SDK's default length, 7 days (`VAULT_SESSION_TTL_SEC`). A server
 * refuses a request signed after that with `badsig`, and the console asks for the passphrase again
 * (`lib/session.ts`).
 */
export const operatorVault = passphraseVault({ store: localKeyStore, key: "beacon-admin.wallet" });

/** What the wallet dialog says when the passphrase does not open the wallet saved in this browser. */
export const WRONG_PASSPHRASE =
  "That passphrase does not unlock the wallet saved in this browser. Check the passphrase and try again.";

/**
 * The wallet dialog's sentence for a failed create, import or unlock. A wrong passphrase gets
 * {@link WRONG_PASSPHRASE}: `unlock` throws the SDK's `WrongPassphraseError` for one, which
 * `isWrongPassphrase` recognizes. Any other failure gets `describeApiError`'s sentence.
 */
export function describeWalletError(err: unknown): string {
  return isWrongPassphrase(err) ? WRONG_PASSPHRASE : describeApiError(err);
}
