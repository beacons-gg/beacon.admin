"use client";

import type { Wallet } from "@beaconsgg/identity";
import type { AdminMediaListParams, MediaListItem } from "@beaconsgg/protocol-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { listMedia } from "./api";

/** The console-side filter shape (a subset of the wire params, sans paging). */
export interface MediaFilters {
  owner?: string;
  type?: string;
  reviewed?: "reviewed" | "unreviewed";
}

/**
 * The list ordering — derived from the wire `sort` so protocol-types stays the single source of truth
 * (`recent` = newest-first, `size` = largest-first).
 */
export type MediaSort = NonNullable<AdminMediaListParams["sort"]>;

const PAGE_SIZE = 30;

/**
 * Manual accumulate + keyset pagination for the media browser. Deliberately **not** `useSWRInfinite`
 * (the app is plain `useSWR` everywhere, and a write-heavy review queue must not re-sign every page
 * or reshuffle mid-review): page 1 loads (and the list resets) whenever server/wallet/filters change;
 * `loadMore` appends the next keyset page; and `markReviewedLocally` / `removeLocally` mutate in place
 * after a signed write, so the operator's position in the queue is stable and no re-fetch fires.
 */
export function useMediaList(
  origin: string | undefined,
  wallet: Wallet | undefined,
  filters: MediaFilters,
  sort: MediaSort,
) {
  const [items, setItems] = useState<MediaListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  // A ref for the wallet so `fetchPage` doesn't churn on the context value's identity.
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const walletDid = wallet?.account.did;
  const { owner, type, reviewed } = filters; // primitive deps — no object-identity churn

  const fetchPage = useCallback(
    async (cursor: string | undefined) => {
      const w = walletRef.current;
      if (!origin || !w) return;
      setLoading(true);
      setError(undefined);
      try {
        // A cursor is only valid for the sort that produced it; `sort` is a fetchPage dep, so any
        // sort change resets to page 1 (cursor undefined) — no stale-sort cursor is ever reused.
        const params: AdminMediaListParams = {
          limit: PAGE_SIZE,
          sort,
          ...(cursor ? { cursor } : {}),
          ...(owner ? { owner } : {}),
          ...(type ? { type } : {}),
          ...(reviewed ? { reviewed } : {}),
        };
        const page = await listMedia(origin, w, params);
        setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [origin, walletDid, owner, type, reviewed, sort],
  );

  // Reset + load page 1 whenever the target server, wallet, or filters change.
  useEffect(() => {
    setItems([]);
    setNextCursor(undefined);
    void fetchPage(undefined);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (nextCursor && !loading) void fetchPage(nextCursor);
  }, [fetchPage, nextCursor, loading]);

  /** After a review write: update the row in place, or drop it when it no longer matches the filter. */
  const markReviewedLocally = useCallback(
    (hash: string, reviewedAt: string | null, reviewedBy: string | null) => {
      setItems((prev) => {
        if (reviewed === "unreviewed" && reviewedAt !== null)
          return prev.filter((i) => i.hash !== hash);
        if (reviewed === "reviewed" && reviewedAt === null)
          return prev.filter((i) => i.hash !== hash);
        return prev.map((i) => (i.hash === hash ? { ...i, reviewedAt, reviewedBy } : i));
      });
    },
    [reviewed],
  );

  const removeLocally = useCallback((hash: string) => {
    setItems((prev) => prev.filter((i) => i.hash !== hash));
  }, []);

  return {
    items,
    loading,
    error,
    hasMore: nextCursor !== undefined,
    loadMore,
    markReviewedLocally,
    removeLocally,
  };
}
