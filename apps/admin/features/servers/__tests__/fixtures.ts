import type { SavedServer } from "../registry";

/**
 * Shared test fixtures for the servers feature. Not collected by vitest, which globs `*.test.ts`.
 *
 * One factory rather than one per test file, so a required field added to `savedServerSchema` breaks
 * in a single place instead of drifting across the directory. Matches the pattern the repo already
 * uses in `policy-engine/src/__tests__/fixtures.ts` and `apps/server/src/__tests__/atlas-fixture.ts`.
 */
export const savedServer = (origin: string, over: Partial<SavedServer> = {}): SavedServer => ({
  origin,
  host: "h.example",
  key: "did:key:z6MkPinnedServerKeyAAAAAAAAAAAAAAAAAA",
  coverage: [""],
  capabilities: ["places"],
  addedAt: "2026-07-24T00:00:00.000Z",
  ...over,
});

/** Stands in for an unlocked wallet: the gates only ever check that one is present. */
export const WALLET = { account: { did: "did:key:z6MkOperator" } };
