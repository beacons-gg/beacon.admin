import { ApiError, VAULT_SESSION_TTL_SEC } from "@beaconsgg/client-sdk";
import { walletFromMnemonic, type Wallet } from "@beaconsgg/identity";

/** The session wallet fixtures the renewal suites share. Not a `.test.ts`, so not a suite. */

export const PHRASE = "test test test test test test test test test test test junk";
export const DAY = 24 * 60 * 60 * 1000;
/** How long the vault's session lasts. */
export const SESSION_MS = VAULT_SESSION_TTL_SEC * 1000;

/** A session wallet for `phrase` issued a day ago that ends `endsIn` ms from now (negative: ended). */
export function sessionWallet(endsIn: number, phrase = PHRASE): Wallet {
  const iso = (ms: number) => new Date(ms).toISOString();
  return walletFromMnemonic(phrase, {
    issued: iso(Date.now() - DAY),
    expires: iso(Date.now() + endsIn),
  });
}

/** A server refusing a session that ran out, as a strict call throws it (`badauth` is `verifyOp`'s reason). */
export const BADSIG = new ApiError(401, "badauth", "badsig");
/** The same refusal as the body the server sends, and a game-facing call returns. */
export const BADSIG_BODY = { ok: false, error: "badsig", message: "badauth" };
