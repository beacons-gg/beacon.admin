import { conformsTo, profileDocReadSchema, type ProfileDoc } from "@beaconsgg/protocol-types";
import useSWR from "swr";
import { getJson, on404 } from "@/lib/api";

/**
 * Resolve an owner DID's public profile from one server's `GET /profiles/:did` (the same public read
 * the game client uses). SWR dedupes by key, so many media rows sharing an owner cost a single fetch.
 * A **404** (the owner never published a profile to *this* server — there's no cross-server
 * aggregation) resolves to `undefined` so the caller falls back to the raw DID; it is not an error.
 * The doc is self-signed, so its shape is checked (never trust a cast) and it is kept as received.
 */
export function useProfile(origin: string, did: string | undefined) {
  return useSWR<ProfileDoc | undefined>(
    did ? ["profile", origin, did] : null,
    () =>
      getJson<unknown>(origin, `/profiles/${encodeURIComponent(did!)}`)
        .then((doc: unknown) => {
          // Shape-checked, then handed back as received: the signature covers fields this build may
          // not know.
          if (!conformsTo(profileDocReadSchema, doc)) throw new Error("malformed profile document");
          return doc;
        })
        .catch(on404(undefined)), // not published here

    { revalidateOnFocus: false, revalidateIfStale: false, shouldRetryOnError: false },
  );
}
