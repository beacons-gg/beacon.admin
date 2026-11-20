import { serverLabel, type LabelledServer } from "./label";

/**
 * The gate every signed surface repeats: at least one saved server, the scope it works at, a server
 * whose identity has been checked and still holds, and an unlocked wallet, plus a capability
 * check where the surface needs one.
 *
 * It was copied into six panels before this existed, which cost more than the duplicated lines. The
 * copies disagreed about where to send an operator to change scope, and none of them had an answer
 * for a console with no servers saved at all: the sidebar lists no server to scope to until
 * the list is non-empty, so "select a single server" is a dead end in exactly the state a new
 * operator starts in. The rungs are ordered so every refusal names something the operator can act on
 * right now, and the shared sentences are written once so they cannot drift apart again.
 *
 * Pure and generic over the two values it narrows, so a caller past the check holds a server and a
 * wallet the compiler agrees are there. Gating on the **wallet** rather than on `WalletStatus` is
 * what makes that narrowing real: `status === "unlocked"` and `wallet !== undefined` are the same
 * fact in `WalletProvider`, but only one of them is a fact the type system knows, which is why the
 * panels that checked the status ended up asserting the wallet with `!`.
 */

/** What the capability and identity rungs read, on top of what a label reads. */
export interface GateServer extends LabelledServer {
  origin: string;
  capabilities: string[];
}

/** Why this surface needs what it needs, in the surface's own words. */
export interface GateNeed {
  /** Completes "Select a single server under Scope in the sidebar: ...". */
  server: string;
  /** Completes "Unlock the operator wallet: ...". */
  wallet: string;
  /**
   * A capability the server must advertise. Checked last: it is noise before a server is chosen.
   * Explicitly `| undefined` so a caller may compute it, which `exactOptionalPropertyTypes` would
   * otherwise refuse.
   */
  capability?: string | undefined;
}

/** Everything the rungs read. One shape, so a caller can hand the same object to either gate. */
export interface GateContext<S, W> {
  /** Every saved server: an empty list is a different refusal, with a different remedy. */
  servers: readonly S[];
  /** The selected one, or undefined in "all servers" mode. Not read by {@link anyServerGate}. */
  active: S | undefined;
  wallet: W | undefined;
  /**
   * Origins now signing with a different key than the one pinned when they were added, and
   * origins whose identity this session has not checked yet. No admin request goes to either:
   * {@link trustRefusal} says why. Not read by {@link anyServerGate}; a fan-out caller asks
   * {@link trustRefusal} for each target itself.
   */
  identityChanged: readonly string[];
  checking: readonly string[];
  /**
   * Origins where the wallet is known not to be an admin (`role.ts`). Optional, so a caller that
   * knows no roles gates as before. Not read by {@link anyServerGate}.
   */
  notAdmin?: readonly string[] | undefined;
}

export type Gate<S, W> = { ok: true; server: S; wallet: W } | { ok: false; refusal: string };
export type WalletGate<W> = { ok: true; wallet: W } | { ok: false; refusal: string };

/*
 * The three shared sentences. The empty-list one carries no per-surface clause on purpose: with
 * nothing added, the console cannot do anything anywhere, so "why this screen needs a server" is not
 * yet the operator's question.
 */
const noServers = "Add a server on the Servers page first.";
const noneSelected = (why: string): string =>
  `Select a single server under Scope in the sidebar: ${why}.`;
const locked = (why: string): string => `Unlock the operator wallet: ${why}.`;

/** The sentence for a server whose key changed: also the toast that first tells the operator. */
export function identityChangedRefusal(server: LabelledServer): string {
  return (
    `${serverLabel(server)} is now signing with a different key than the one pinned when it was ` +
    "added, so the console sends it no admin requests. Add its origin again on the Servers page " +
    "to trust the new key."
  );
}

/** The sentence for a server whose admin list does not hold the wallet. */
export function notAdminRefusal(server: LabelledServer): string {
  return (
    `You are not an admin of ${serverLabel(server)}, so its admin screens are closed to you. ` +
    "To manage it, its operator adds your DID to the server's BEACON_ADMINS."
  );
}

/**
 * Why no admin request may go to `server` right now, or `undefined` when one may.
 *
 * A server that answered under a different key than the one pinned when it was added is a rotation
 * or somebody else answering at its origin, and the console can't tell which, so it asks the
 * operator: adding the origin again trusts the new key. A server this session has not re-checked yet
 * could be either, so it waits for the check rather than guessing. Shared by the single-server gate,
 * the dashboard's fan-out and every other surface that sends one, so they say the same thing.
 */
export function trustRefusal(
  server: GateServer,
  ctx: Pick<GateContext<unknown, unknown>, "identityChanged" | "checking">,
): string | undefined {
  if (ctx.identityChanged.includes(server.origin)) return identityChangedRefusal(server);
  if (ctx.checking.includes(server.origin)) {
    return `Checking ${serverLabel(server)}'s identity before sending it any admin requests.`;
  }
  return undefined;
}

export function singleServerGate<S extends GateServer, W>(
  need: GateNeed,
  ctx: GateContext<S, W>,
): Gate<S, W> {
  if (ctx.servers.length === 0) return { ok: false, refusal: noServers };
  if (!ctx.active) return { ok: false, refusal: noneSelected(need.server) };
  const untrusted = trustRefusal(ctx.active, ctx);
  if (untrusted !== undefined) return { ok: false, refusal: untrusted };
  if (ctx.wallet === undefined) return { ok: false, refusal: locked(need.wallet) };
  if (ctx.notAdmin?.includes(ctx.active.origin)) {
    return { ok: false, refusal: notAdminRefusal(ctx.active) };
  }
  if (need.capability !== undefined && !ctx.active.capabilities.includes(need.capability)) {
    return {
      ok: false,
      refusal: `${serverLabel(ctx.active)} does not advertise the ${need.capability} capability.`,
    };
  }
  return { ok: true, server: ctx.active, wallet: ctx.wallet };
}

/**
 * The same ladder for a surface that fans out over every target rather than working on one box: the
 * dashboard's status cards. It answers with the wallet alone, because the caller already holds the
 * `targets` list it means to render and a second copy in the result would only invite the two to
 * disagree.
 */
export function anyServerGate<W>(
  need: Pick<GateNeed, "wallet">,
  ctx: { servers: readonly unknown[]; wallet: W | undefined },
): WalletGate<W> {
  if (ctx.servers.length === 0) return { ok: false, refusal: noServers };
  if (ctx.wallet === undefined) return { ok: false, refusal: locked(need.wallet) };
  return { ok: true, wallet: ctx.wallet };
}
