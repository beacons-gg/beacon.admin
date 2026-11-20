"use client";

import useSWR from "swr";
import { getTaxonomy } from "./api";

/**
 * The server's curated category → subcategory vocabulary (`GET /places/taxonomy`).
 *
 * Public and unsigned, so the key carries no account; and it changes only when an operator edits
 * the tag map, so it's fetched once per server and never revalidated — a near-static read behind a
 * picker shouldn't re-fetch on every focus.
 */
export function useTaxonomy(origin: string | undefined) {
  return useSWR(origin ? ["places.taxonomy", origin] : null, () => getTaxonomy(origin!), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  });
}
