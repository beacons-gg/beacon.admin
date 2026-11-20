import type { Wallet } from "@beaconsgg/identity";
import {
  ApiError,
  createClient,
  ServerError,
  type BeaconClient,
  type ClientConfig,
} from "@beaconsgg/client-sdk";
import { errorCodeSchema } from "@beaconsgg/protocol-types";
import { z } from "zod";
import { renewingClient } from "./session";

/**
 * The console's wire layer (the server's admin API spec, beacon.server `doc/spec/admin-api.md` §1):
 * every admin call is a **browser-signed** `OpEnvelope` POST — the platform's one auth model, no
 * tokens, no sessions. Public reads are plain GETs. Multi-server is just "same wallet, different
 * origin" — each server enforces its own `BEACON_ADMINS` allowlist.
 *
 * The wire is `@beaconsgg/client-sdk`, configured here for the console: no timeout (an operator at a
 * desk sees the spinner and can reload, as before the SDK), no game slug (the console is no game),
 * and the error codes in {@link UNDERSTANDS}. The functions below keep the names and argument order
 * every feature already calls, over the SDK's `...OrThrow` calls, where any non-2xx is an
 * `ApiError`. The one request sent outside it is `uploadAtlas` (`features/places/api.ts`): its body
 * is an archive's raw bytes, which the SDK's JSON transport does not carry, so it signs through
 * `client.sign` and sends itself.
 *
 * Every client here is wrapped by `renewingClient` (`lib/session.ts`): a request a server refused
 * because the wallet session ran out is sent again once the operator unlocks. `uploadAtlas` does the
 * same through `withSession`.
 *
 * A locked server answers 503 with the code `writeLocked`, and every SDK call throws it as a refusal:
 * an `ApiError` with that `code`. A reply that is a fault (any other 5xx, or a reply without the
 * server's own error body) throws a `ServerError`. {@link describeApiError} gives the sentence.
 */

/**
 * What the console says when a server refuses a request because it does not admit the request's
 * game (`gameNotAdmitted`). Only a game plugin's requests name a game, and the admin surface admits
 * every request, so this is always about the plugin's game. The setting it names is `games` in
 * `features/settings/catalog.ts`.
 */
export const GAME_NOT_ADMITTED =
  "This server does not admit this game, so it refused the request. To admit the game, add it to the Games setting under Admission in Settings.";

/**
 * What the console says when an admin locked the server read-only (`writeLocked`), as opposed to a
 * server that is down. Most signed reads are refused along with the writes, so the message does not
 * call it a change.
 */
export const WRITE_LOCKED =
  "This server is locked, so it can't do that right now. Unlock it and try again.";

/**
 * The refusal code of a server an admin locked read-only, which it answers with a 503. Not in
 * `errorCodeSchema`, whose codes are a game's 4xx answers. The SDK puts it on the error's `code`.
 */
export const WRITE_LOCKED_CODE = "writeLocked";

/**
 * What the console says when a write names a place, a proposal or a run the server doesn't have
 * (`unknownPlace`, `unknownProposal`, `unknownRun`). Each is a 404 on a route that exists. A
 * proposal review also answers `unknownPlace` at 400 when the place it improves has retired.
 */
export const UNKNOWN_PLACE =
  "The server has no active place with this ID, so nothing changed. Another operator may have retired the place since this screen loaded.";
export const UNKNOWN_PROPOSAL =
  "The server has no proposal with this ID, so nothing changed. The proposal may have been removed since this screen loaded.";
export const UNKNOWN_RUN =
  "The server has no run with this ID, so nothing changed. The run may have been removed since this screen loaded.";

const MISSING = new Map<string, string>([
  [errorCodeSchema.enum.unknownPlace, UNKNOWN_PLACE],
  [errorCodeSchema.enum.unknownProposal, UNKNOWN_PROPOSAL],
  [errorCodeSchema.enum.unknownRun, UNKNOWN_RUN],
]);

/**
 * The error codes the console declares in `beacon-understands`: the 404s a console write can get
 * that name what is missing (`places.edit`, `places.proposals.review`, `places.snapshot.cancel`).
 * Undeclared, a server answers each with `unknownRoute`, which the console can only word as a
 * missing admin surface. The SDK declares on writes only, so a GET read's 404 stays
 * `unknownRoute`, and the console reads `unknownMedia` and `noAbout` nowhere. A game plugin's
 * client ({@link clientFor}) declares the same codes, and its `describeError` words them the same.
 */
export const UNDERSTANDS: readonly string[] = [...MISSING.keys()].map((code) => `code:${code}`);

const CONSOLE: ClientConfig = { timeoutMs: null, understands: UNDERSTANDS };
export const client = renewingClient(createClient(CONSOLE));

/**
 * The console's client with a time limit, for reads that repeat while a server may be down. Without
 * one, a connection that hangs during a restart never settles, the loop waiting on it stops, and
 * each one left behind holds one of the browser's few connections to that origin.
 */
export const boundedClient = renewingClient(createClient({ ...CONSOLE, timeoutMs: 15_000 }));

/**
 * The console's client, signing as `game` and reading that game's content by default: a game
 * plugin's (see `features/games/host.tsx`). One configuration with {@link client}, so the two
 * cannot drift.
 */
export function clientFor(game: string): BeaconClient {
  return renewingClient(createClient({ ...CONSOLE, game }));
}

export { ApiError, on404, parseOrThrow, fieldIssues, type FieldIssue } from "@beaconsgg/client-sdk";

const removedResultSchema = z.object({ removed: z.boolean() });
/** Parse the shared `{ ok, removed }` admin-mutation reply down to the boolean (room/media/blocklist). */
export function parseRemoved(r: unknown): boolean {
  return removedResultSchema.parse(r).removed;
}

/** Public unauthenticated GET (descriptor, discovery, places reads). */
export function getJson<T>(origin: string, path: string): Promise<T> {
  return client.getOrThrow<T>(origin, path);
}

/** Sign `op(params)` with the operator wallet and POST it — the one shape every admin route takes. */
export function signedPost<T>(
  origin: string,
  path: string,
  wallet: Wallet,
  op: string,
  params: Record<string, unknown>,
  via: BeaconClient = client,
): Promise<T> {
  return via.postSignedOrThrow<T>(origin, path, wallet, { op, params });
}

/** POST a signed capability upload: the media route's `{env, data}` wire shape. */
export function signedUpload<T>(
  origin: string,
  path: string,
  wallet: Wallet,
  op: string,
  params: Record<string, unknown>,
  dataBase64: string,
  via: BeaconClient = client,
): Promise<T> {
  return via.uploadSignedOrThrow<T>(origin, path, wallet, { op, params }, dataBase64);
}

/** The console's sentence for a refusal code it words itself, or `undefined` for any other. */
export function describeRefusal(code: string | undefined): string | undefined {
  if (code === WRITE_LOCKED_CODE) return WRITE_LOCKED;
  if (code === errorCodeSchema.enum.gameNotAdmitted) return GAME_NOT_ADMITTED;
  return code === undefined ? undefined : MISSING.get(code);
}

/** Human copy for the admin-surface error statuses (one place, consistent everywhere). */
export function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    const refusal = describeRefusal(err.code);
    if (refusal !== undefined) return refusal;
    if (err.status === 404) return "No admin surface (server has no BEACON_ADMINS, or wrong URL).";
    if (err.status === 403) return "Denied — this wallet is not on the server's BEACON_ADMINS.";
    // A fault the server raised rather than a refusal: its status is the whole message.
    if (err instanceof ServerError) return `Server error ${err.status}.`;
    return `${err.status}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
