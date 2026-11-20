import type { Wallet } from "@beaconsgg/identity";
import { ApiError, type BeaconClient } from "@beaconsgg/client-sdk";
import { errorCodeSchema } from "@beaconsgg/protocol-types";

/**
 * The operator's wallet session, as the console's signed calls see it. An unlock authorizes a new
 * device key for the SDK vault's session length (`VAULT_SESSION_TTL_SEC`, 7 days). After that a
 * server refuses every signed request with `badsig`, a retry of an earlier one included, so the
 * console asks for the passphrase again and sends the refused request once more under the new
 * session.
 *
 * The asking is the wallet provider's (`features/wallet/WalletProvider.tsx`), which registers it
 * here with {@link setSessionRenewer}. This module is in `lib` so the wire layer can call it without
 * depending on a feature.
 */

const BADSIG = errorCodeSchema.enum.badsig;

/**
 * How early a `badsig` counts as the session's end: the server compares the expiry with its own
 * clock, which can run a little ahead of this browser's.
 */
const CLOCK_SKEW_MS = 5 * 60_000;

/**
 * Whether `outcome` is a server refusing `wallet`'s signature because its session ran out. The
 * refusal is an `ApiError` thrown by a strict call, or the `{ ok: false, error }` answer a
 * game-facing call returns.
 */
export function sessionExpired(wallet: Wallet, outcome: unknown, now = Date.now()): boolean {
  const code =
    outcome instanceof ApiError
      ? outcome.code
      : (outcome as { ok?: unknown; error?: unknown } | null)?.ok === false
        ? (outcome as { error?: unknown }).error
        : undefined;
  if (code !== BADSIG) return false;
  const expires = wallet.auth.expires;
  return expires !== undefined && now + CLOCK_SKEW_MS >= Date.parse(expires);
}

/** The error a signed call ends with when the operator closes the unlock dialog instead. */
export class SessionEnded extends Error {
  constructor() {
    super("The wallet session ended. Unlock the wallet to sign again, then retry.");
    this.name = "SessionEnded";
  }
}

type SessionRenewer = (expired: Wallet) => Promise<Wallet>;

let renewer: SessionRenewer | undefined;

/**
 * Register the one renewer: it asks the operator to unlock again, and resolves with the new
 * session's wallet. Returns the call that removes it again.
 */
export function setSessionRenewer(next: SessionRenewer): () => void {
  renewer = next;
  return () => {
    if (renewer === next) renewer = undefined;
  };
}

/**
 * Make a signed call with `wallet`, and when a server refuses it because the session ran out, ask
 * for the passphrase and make it once more with the new session's wallet. A `badsig` means the
 * server did nothing with the request, so sending it again is safe. Any other outcome, and a second
 * refusal, reaches the caller as it is.
 */
export function withSession<T>(wallet: Wallet, call: (wallet: Wallet) => Promise<T>): Promise<T> {
  return renewOnce(wallet, call(wallet), call);
}

/** {@link withSession} once the first attempt is under way. */
async function renewOnce<T>(
  wallet: Wallet,
  first: Promise<T>,
  again: (wallet: Wallet) => Promise<T>,
): Promise<T> {
  let outcome: T;
  try {
    outcome = await first;
  } catch (err) {
    if (renewer === undefined || !sessionExpired(wallet, err)) throw err;
    return again(await renewer(wallet));
  }
  if (renewer === undefined || !sessionExpired(wallet, outcome)) return outcome;
  return again(await renewer(wallet));
}

function isWallet(value: unknown): value is Wallet {
  const w = value as Partial<Wallet> | null;
  return typeof w === "object" && w !== null && "account" in w && "device" in w && "auth" in w;
}

/**
 * `client`, with every asynchronous call that takes a wallet made through {@link withSession}, so a
 * plugin's game-facing write is renewed like the console's own. The wallet argument is swapped for
 * the new session's on the second try. Calls that take no wallet, and synchronous ones such as
 * `sign`, are passed through untouched.
 */
export function renewingClient(client: BeaconClient): BeaconClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const member: unknown = Reflect.get(target, prop, receiver);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        const wallet = args.find(isWallet);
        const run = (w: Wallet | undefined): unknown =>
          member.apply(
            target,
            args.map((arg) => (arg === wallet ? w : arg)),
          );
        const first = run(wallet);
        if (wallet === undefined || !(first instanceof Promise)) return first;
        return renewOnce(wallet, first, (w) => run(w) as Promise<unknown>);
      };
    },
  });
}
