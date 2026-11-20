"use client";

import type { Wallet } from "@beaconsgg/identity";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { identityChangedRefusal } from "./gate";
import { probeRole } from "./role";
import {
  EXPECT_KEY_MS,
  loadServers,
  probeServer,
  refreshServer,
  saveServers,
  upsertServer,
  type SavedServer,
} from "./registry";

/**
 * What adding a server did. `preview` is a server the wallet is not an admin of: it is shown for a
 * quick look and never saved (see {@link ServersContextValue.preview}).
 */
export interface AddResult {
  server: SavedServer;
  preview: boolean;
}

export interface ServersContextValue {
  /** The saved servers, and the quick-view server when there is one. */
  servers: SavedServer[];
  /**
   * The origin of the server open for a quick view, if any: one the operator added without being one
   * of its admins. It sits in `servers` like any other for this session, so its public map and
   * descriptor show, but it is never written to storage. It goes away at a reload, when another
   * quick view replaces it, or with `remove`.
   */
  preview: string | undefined;
  /** The selected server's origin, or undefined = "all servers" (the pane-of-glass mode). */
  active: string | undefined;
  /** The selected server's record (the feature owns this derivation — undefined in "all" mode). */
  activeServer: SavedServer | undefined;
  setActive(origin: string | undefined): void;
  /**
   * Add by origin: normalize → fetch + verify descriptor → pin. Throws on failure. With a wallet,
   * the server is first asked whether that wallet is one of its admins. One that says no opens as
   * the quick view and is not saved, unless it is saved already.
   */
  add(input: string, wallet?: Wallet): Promise<AddResult>;
  /**
   * Origins whose descriptor is now signed by a different key than the pinned one. No admin
   * request goes to them (see `trustRefusal`) until the operator adds the origin again, which
   * clears it.
   */
  identityChanged: readonly string[];
  /**
   * Origins whose identity this session has not re-checked yet, including any that couldn't be
   * reached (re-tried every {@link RECHECK_MS}). No admin request goes to them either until their
   * check lands, so nothing is sent before the console knows who answers.
   */
  checking: readonly string[];
  remove(origin: string): void;
  /**
   * Accept `key` for `origin` at a check in the next few days: the key a restore started here gives
   * it. Undefined stops expecting one, for a restore that failed.
   */
  expectKey(origin: string, key: string | undefined): void;
  /** The servers a view should fan out over (the active one, or all). */
  targets: SavedServer[];
}

/** How long an unreachable server waits before its identity is checked again. */
export const RECHECK_MS = 30_000;

const ServersContext = createContext<ServersContextValue | undefined>(undefined);

export function ServersProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<SavedServer[]>([]);
  const [active, setActive] = useState<string | undefined>(undefined);
  const [identityChanged, setIdentityChanged] = useState<readonly string[]>([]);
  const [checking, setChecking] = useState<readonly string[]>([]);
  const [preview, setPreviewState] = useState<SavedServer | undefined>(undefined);
  // The quick view as of now, for `add` and `remove`, which compare against it after awaits.
  const previewNow = useRef<SavedServer | undefined>(undefined);
  const setPreview = (next: SavedServer | undefined) => {
    previewNow.current = next;
    setPreviewState(next);
  };
  // The list as last written, for the refresh results and the add/remove handlers, which can run
  // before a render has caught up with each other.
  const current = useRef<SavedServer[]>([]);

  const persist = (next: SavedServer[]) => {
    current.current = next;
    setServers(next);
    saveServers(next);
  };
  const settle = (origin: string) => setChecking((origins) => origins.filter((o) => o !== origin));

  // Hydrate from browser storage, then re-read every descriptor. What's stored is a cache of the
  // server's *configuration*, and an operator changes that by restarting a process — so the console
  // must not gate its UI on what was true the day the server was added. A changed key is surfaced
  // rather than absorbed (see `refreshServer`).
  //
  // Each server's check lands on its own, so one unreachable server doesn't hold the rest back. One
  // that can't be reached stays unchecked and is tried again, rather than trusted on its stored pin: a
  // key rotation is a restart, so "down at launch" is exactly when the key may be changing. A result
  // applies only to the record it checked: a re-add or remove since then is the operator's say-so,
  // newer than a check that was already in flight, so a late result neither undoes it nor flags it.
  useEffect(() => {
    const stored = loadServers();
    current.current = stored;
    setServers(stored);
    setChecking(stored.map((s) => s.origin));
    let cancelled = false;
    const retries = new Set<ReturnType<typeof setTimeout>>();
    const check = (before: SavedServer) => {
      void refreshServer(before).then(
        (fresh) => {
          if (cancelled) return;
          settle(before.origin);
          persist(current.current.map((s) => (s === before ? fresh : s)));
        },
        (err: unknown) => {
          if (cancelled || !current.current.includes(before)) return;
          if (!(err instanceof Error && err.name === "ServerIdentityChanged")) {
            const retry = setTimeout(() => {
              retries.delete(retry);
              if (current.current.includes(before)) check(before);
            }, RECHECK_MS);
            retries.add(retry);
            return;
          }
          settle(before.origin);
          setIdentityChanged((origins) => [...origins, before.origin]);
          // Told once, at the check that found it; the Servers page and every gated surface keep
          // saying so for as long as it stands.
          toast.warning(identityChangedRefusal(before));
        },
      );
    };
    stored.forEach(check);
    return () => {
      cancelled = true;
      retries.forEach(clearTimeout);
    };
  }, []);

  const forget = (origin: string) => {
    settle(origin);
    setIdentityChanged((origins) => origins.filter((o) => o !== origin));
  };

  // Kept by identity, so the fan-out views keyed on the list do not start again every render.
  const listed = useMemo(
    () => (preview ? upsertServer(servers, preview) : servers),
    [servers, preview],
  );

  const value: ServersContextValue = {
    servers: listed,
    preview: preview?.origin,
    identityChanged,
    checking,
    active,
    activeServer: listed.find((s) => s.origin === active),
    setActive,
    async add(input, wallet) {
      const server = await probeServer(input);
      const saved = current.current.some((s) => s.origin === server.origin);
      // Only a clear "not an admin" makes a quick view. A server that could not say keeps the old
      // behavior and is saved, so a slow status read never loses the operator a server.
      if (!saved && wallet && (await probeRole(server.origin, wallet)) === "notAdmin") {
        setPreview(server);
        forget(server.origin);
        return { server, preview: true };
      }
      persist(upsertServer(current.current, server));
      if (previewNow.current?.origin === server.origin) setPreview(undefined);
      // Adding the origin again is the operator's say-so for whatever key answered: trusted now, and
      // just checked.
      forget(server.origin);
      return { server, preview: false };
    },
    expectKey(origin, key) {
      const until = new Date(Date.now() + EXPECT_KEY_MS).toISOString();
      persist(
        current.current.map((s) => {
          if (s.origin !== origin) return s;
          const { expecting: _dropped, ...rest } = s;
          return key === undefined ? rest : { ...rest, expecting: { key, until } };
        }),
      );
    },
    remove(origin) {
      if (previewNow.current?.origin === origin) setPreview(undefined);
      else persist(current.current.filter((s) => s.origin !== origin));
      forget(origin);
      if (active === origin) setActive(undefined);
    },
    targets: active ? listed.filter((s) => s.origin === active) : listed,
  };
  return <ServersContext.Provider value={value}>{children}</ServersContext.Provider>;
}

export function useServers(): ServersContextValue {
  const ctx = useContext(ServersContext);
  if (!ctx) throw new Error("useServers outside ServersProvider");
  return ctx;
}
