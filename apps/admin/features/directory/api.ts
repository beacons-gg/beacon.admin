import type { Wallet } from "@beaconsgg/identity";
import { ulidSchema } from "@beaconsgg/protocol-types";
import { z } from "zod";
import { client } from "@/lib/api";
import { directoryHost } from "./config";

/**
 * The directory's routes for a server's own listing. The directory is a website with answers of its
 * own (`{ ok, error, message }` bodies), so these are plain `fetch` calls. Each route allows any
 * origin without credentials, since operators run their consoles at their own addresses.
 *
 * Removing a listing proves control the way a server's admin proves it anywhere: the console signs a
 * read-only `admin.status` op for the server, bound to a one-time nonce the directory issued. The
 * directory forwards that envelope to the server's own `POST /admin/status`, and a `200` there says
 * the signer is on the server's `BEACON_ADMINS`.
 */

/** Whether the directory shows the server: `notListed` covers a pending or private listing too. */
export type ListingState = "listed" | "notListed";

/**
 * Anything the directory said no to, or a directory the console could not reach. `message` is the
 * sentence to show: the directory's own when it gave one, the console's otherwise.
 */
export class DirectoryError extends Error {
  constructor(
    /** The directory's `error` code, `network` when it was not reached, or `unreadable`. */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DirectoryError";
  }
}

/** The console's words for the directory's refusals, used when the directory gives no `message`. */
const refusals = (directory: string): Record<string, string> => ({
  notFound:
    "The directory has no listing for this server, so there is nothing to remove. Check the directory address if you expected one.",
  hosted: `The hosting dashboard lists this server. Clear List on ${directoryHost(directory)} on the server's Settings tab in the hosting dashboard to remove the listing.`,
  rateLimited: "The directory is getting too many requests. Wait a few minutes and try again.",
  denied:
    "The server says this wallet is not one of its admins, so the listing stays. Add the wallet's account DID to BEACON_ADMINS on the server and try again.",
  refused:
    "The server refused the signed request, so the listing stays. Check that this computer's clock is right and try again.",
  unreachable:
    "The directory could not reach the server, so the listing stays. Check that the server answers at its public address and try again.",
  invalid: "The directory refused the request, so the listing stays. Try again.",
  challenge: "The directory's one-time code was already used or expired. Try again.",
});

const refusalSchema = z.object({ error: z.string().optional(), message: z.string().optional() });
const challengeSchema = z.object({ ok: z.literal(true), nonce: ulidSchema });
const removedSchema = z.object({ ok: z.literal(true), removed: z.literal(true) });

const listingPath = (host: string) => `/api/v1/servers/${encodeURIComponent(host.toLowerCase())}`;

/** The cache key of a server's listing: the directory asked and the host asked about. */
export const listingKey = (directory: string, host: string) => [
  "directory.listing",
  directory,
  host,
];

/** What the console says when the directory sent something it cannot read. */
const unreadable = (directory: string) =>
  new DirectoryError(
    "unreadable",
    `The directory at ${directoryHost(directory)} sent an answer the console can't read. Check the directory address and try again.`,
  );

/** One request to the directory: the status and the JSON body, if the body is JSON. */
async function call(
  directory: string,
  path: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(`${directory}${path}`, {
      ...init,
      credentials: "omit",
      headers: { accept: "application/json", ...init.headers },
    });
  } catch {
    throw new DirectoryError(
      "network",
      `The console could not reach the directory at ${directoryHost(directory)}. Check your connection and the directory address, then try again.`,
    );
  }
  const body: unknown = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body };
}

/** The error for a refusal: the directory's own sentence first, then the console's for its code. */
function refusal(directory: string, status: number, body: unknown): DirectoryError {
  const parsed = refusalSchema.safeParse(body);
  const code = (parsed.success ? parsed.data.error : undefined) ?? `http${status}`;
  const message = parsed.success ? parsed.data.message?.trim() : undefined;
  return new DirectoryError(
    code,
    message ||
      refusals(directory)[code] ||
      `The directory answered with status ${status}, so the listing stays. Try again in a few minutes.`,
  );
}

/**
 * Whether the directory shows `host`: `GET /api/v1/servers/{host}`. The directory's own `404`
 * (`error: "notFound"`) is "not listed", which includes a listing the public does not see. Any other
 * `404`, a page from a site that is no directory, is an answer the console can't read.
 *
 * @throws {@link DirectoryError} when the directory can't be reached or answers anything else.
 */
export async function fetchListing(directory: string, host: string): Promise<ListingState> {
  const { status, body } = await call(directory, listingPath(host), { method: "GET" });
  if (status === 200) return "listed";
  if (status === 404) {
    const said = refusalSchema.safeParse(body);
    if (said.success && said.data.error === "notFound") return "notListed";
    throw unreadable(directory);
  }
  throw new DirectoryError(
    `http${status}`,
    `The directory at ${directoryHost(directory)} answered with status ${status}. Try again in a few minutes.`,
  );
}

/** The listing's public page on the directory. */
export function listingUrl(directory: string, host: string): string {
  return `${directory}/servers/${encodeURIComponent(host.toLowerCase())}`;
}

/**
 * Remove `host`'s listing from the directory, as an admin of the server.
 *
 * 1. `POST .../challenge` issues a one-time nonce for the host.
 * 2. The wallet signs `admin.status` with params `{}` and that nonce as the envelope's own. The
 *    console's client signs with no game slug, as every admin op it sends.
 * 3. `POST .../remove` with `{ envelope }`: the directory forwards the envelope to the server and
 *    deletes the listing when the server answers `200`.
 *
 * The nonce works once whatever happens next, so a retry starts again from the challenge.
 *
 * @throws {@link DirectoryError} with the directory's message for a refusal (`hosted`, `denied`,
 * `unreachable` and the rest), and when the directory can't be reached.
 */
export async function removeListing(
  directory: string,
  host: string,
  wallet: Wallet,
): Promise<void> {
  const base = listingPath(host);
  const challenge = await call(directory, `${base}/challenge`, { method: "POST" });
  if (!challenge.ok) throw refusal(directory, challenge.status, challenge.body);
  const issued = challengeSchema.safeParse(challenge.body);
  if (!issued.success) throw unreadable(directory);

  const envelope = client.sign(wallet, {
    op: "admin.status",
    params: {},
    nonce: issued.data.nonce,
  });

  const removed = await call(directory, `${base}/remove`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ envelope }),
  });
  if (!removed.ok) throw refusal(directory, removed.status, removed.body);
  if (!removedSchema.safeParse(removed.body).success) throw unreadable(directory);
}

/** The sentence for any failure of the calls above. */
export function describeDirectoryError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
