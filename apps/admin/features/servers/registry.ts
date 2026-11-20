import { z } from "zod";
import { client } from "@/lib/api";
import { loadJson, saveJson } from "@/lib/storage";

/**
 * The operator's server list, after a game client's list of approved servers: add by
 * origin → fetch + **verify** the signed descriptor → pin what it said. Fetching, verifying and the
 * typed-address rule are `@beaconsgg/client-sdk`'s (`verifyServer`); what stays here is how the console
 * stores the list: this browser's storage, one row per server, sorted by origin. Every server
 * independently enforces its own `BEACON_ADMINS`.
 */

export const savedServerSchema = z
  .object({
    origin: z.string().url(), // http(s) origin the console calls
    host: z.string(), // the `@host` authority from the descriptor
    key: z.string(), // pinned server identity (did:key) from the verified descriptor
    name: z.string().optional(),
    coverage: z.array(z.string()),
    capabilities: z.array(z.string()),
    addedAt: z.string(),
    /**
     * The key a restore the operator started here will give the server, since a restore makes the
     * server the one in its backup: the one other key a check accepts, until `until`.
     */
    expecting: z.object({ key: z.string(), until: z.string() }).strict().optional(),
  })
  .strict();
export type SavedServer = z.infer<typeof savedServerSchema>;

const SERVERS_KEY = "beacon-admin.servers";
const listSchema = z.array(savedServerSchema);

export function loadServers(): SavedServer[] {
  return loadJson(SERVERS_KEY, listSchema) ?? [];
}

export function saveServers(servers: SavedServer[]): void {
  saveJson(SERVERS_KEY, servers);
}

/**
 * Fetch + verify a server's signed descriptor at `address`, through the SDK's `verifyServer` (a typed
 * address is normalized by its `normalizeServerUrl`); throws on an unreachable/invalid/forged one.
 *
 * `keepAddress` keeps the origin the operator typed. By default the SDK moves to the host the
 * descriptor names, which a player's app wants, but an operator often reaches a server by an
 * internal address (a LAN IP, a container name) that differs from its public host, and the saved row
 * is keyed by that address.
 */
export async function probeServer(address: string): Promise<SavedServer> {
  const { origin, descriptor } = await client.verifyServer(address, { keepAddress: true });
  return {
    origin,
    host: descriptor.host,
    key: descriptor.key,
    ...(descriptor.name !== undefined ? { name: descriptor.name } : {}),
    coverage: descriptor.coverage,
    capabilities: descriptor.capabilities ?? [],
    addedAt: new Date().toISOString(),
  };
}

/** A saved server's descriptor now identifies someone else — a rotation, or a takeover of the address. */
export class ServerIdentityChanged extends Error {
  constructor(readonly origin: string) {
    super(`${origin} is signing with a different key than the one pinned when it was added`);
    this.name = "ServerIdentityChanged";
  }
}

/**
 * Re-read a saved server's descriptor and refresh the parts an operator changes — capabilities,
 * coverage, name, host — keeping the pinned identity.
 *
 * The pin is about **who** a server is, not how it's configured. `key` is the trust anchor and never
 * moves here; capabilities are a restart away from changing, so the copy captured at add time goes
 * stale the moment an operator turns a feature on, and the console then gates its own UI on a fact
 * that stopped being true (a `places-proposals` server told it wasn't accepting submissions).
 *
 * A key that no longer matches is **not** a refresh. It's a different identity at a familiar
 * address, so nothing is written and the caller is told — auto-accepting it would quietly re-pin
 * the console onto whoever answered.
 */
export async function refreshServer(saved: SavedServer): Promise<SavedServer> {
  const fresh = await probeServer(saved.origin);
  // Bounded, so a restore that never finished does not leave a second key trusted for good.
  const expecting =
    saved.expecting && Date.now() < Date.parse(saved.expecting.until) ? saved.expecting : undefined;
  // The same rule as the SDK's `serverIdentityChanged`: a saved row always verified, so its key alone is
  // the pin, and a different one is refused. The one exception is the key the operator restored the
  // server to, which becomes the pin.
  const restored = fresh.key === expecting?.key;
  if (fresh.key !== saved.key && !restored) throw new ServerIdentityChanged(saved.origin);
  return {
    origin: saved.origin,
    key: fresh.key,
    addedAt: saved.addedAt,
    ...(expecting && !restored ? { expecting } : {}),
    host: fresh.host,
    coverage: fresh.coverage,
    capabilities: fresh.capabilities,
    // Rebuilt rather than merged, so a name the operator *removed* actually goes away.
    ...(fresh.name !== undefined ? { name: fresh.name } : {}),
  };
}

/** How long a check accepts the key a restore started here will give the server. */
export const EXPECT_KEY_MS = 3 * 24 * 60 * 60 * 1000;

/** Add (or refresh) a server in the list, keyed by origin. */
export function upsertServer(servers: SavedServer[], server: SavedServer): SavedServer[] {
  return [...servers.filter((s) => s.origin !== server.origin), server].sort((a, b) =>
    a.origin.localeCompare(b.origin),
  );
}
