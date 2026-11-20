import { z } from "zod";
import { loadJson, saveJson } from "@/lib/storage";

/**
 * The server directory the console reads a listing from and asks to remove one: Beacon's public
 * directory unless the operator names another. The address is kept in this browser, the way the
 * map keeps a custom tile style, so the console image still takes no configuration and an operator
 * whose servers are listed elsewhere points the console there.
 */
export const DEFAULT_DIRECTORY = "https://beacons.gg";

const DIRECTORY_KEY = "beacon-admin.directory";

/** Hosts a developer runs a directory on: the one place plain `http` is allowed. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A typed directory address as the origin the console calls, or `undefined` when it is not one.
 * The console hands the directory a signed admin read of the server, so the address must be
 * `https`; plain `http` is allowed for a directory on this computer only. Only the origin is kept:
 * every directory route hangs off it.
 */
export function directoryOrigin(input: string): string | undefined {
  try {
    const url = new URL(input.trim());
    if (url.protocol === "https:") return url.origin;
    return url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** The directory this browser uses: the saved address, or the default when none is saved. */
export function loadDirectory(): string {
  const saved = loadJson(DIRECTORY_KEY, z.string());
  return (saved === undefined ? undefined : directoryOrigin(saved)) ?? DEFAULT_DIRECTORY;
}

/**
 * Save the directory this browser uses. The default is stored as no address, so a browser that
 * never chose one follows the default if the default ever moves.
 */
export function saveDirectory(origin: string): void {
  saveJson(DIRECTORY_KEY, origin === DEFAULT_DIRECTORY ? "" : origin);
}

/** The directory's host, as copy names it: `beacons.gg`. */
export function directoryHost(origin: string): string {
  return new URL(origin).host;
}
