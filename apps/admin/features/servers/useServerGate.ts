"use client";

import type { Wallet } from "@beaconsgg/identity";
import { useWallet } from "@/features/wallet";
import { anyServerGate, singleServerGate, type Gate, type GateNeed, type WalletGate } from "./gate";
import type { SavedServer } from "./registry";
import { useServerRoles } from "./roles";
import { useServers } from "./ServersProvider";

/**
 * The React half of the gates: the saved list, the active server and the session wallet, resolved to
 * either a refusal sentence or the values the surface needs.
 *
 * **The layering is the reason for the file, not the test config.** `label.ts` and `gate.ts` are
 * pure, this is the wiring, and `GateNotice.tsx` is presentation; a hook has no business sharing a
 * module with the markup it gates. An earlier version of this comment claimed vitest could not cover
 * a `.tsx` module at all, which is simply false: `vitest.config.ts` only constrains the *test* file
 * to `.ts`, and a `.ts` test imports a `.tsx` module here without complaint (checked, not assumed).
 *
 * What these three lines do earn is their own coverage. They decide which provider value feeds which
 * parameter, and that is the part of the extraction that can silently break for all six surfaces at
 * once: reading `targets[0]` instead of `activeServer` type-checks, and un-gates every panel onto an
 * arbitrary server whenever the operator is in "all servers" mode. The suite mocks the two providers
 * and calls these as plain functions, which is faithful because their bodies hold no React
 * primitives of their own.
 *
 * Hooks rather than wrapper components, because the refusal's chrome is not the same everywhere: the
 * panels render it as a paragraph and the Explore ribbon renders it inside its own bordered strip.
 * A wrapper would have had to take that as a prop, which is a component whose only job is to be
 * configured.
 */
export function useSingleServer(need: GateNeed): Gate<SavedServer, Wallet> {
  const { servers, activeServer, identityChanged, checking } = useServers();
  const { wallet } = useWallet();
  const { notAdmin } = useServerRoles();
  return singleServerGate(need, {
    servers,
    active: activeServer,
    wallet,
    identityChanged,
    checking,
    notAdmin,
  });
}

/**
 * The fan-out variant, for a surface that renders every target rather than one chosen server. It
 * takes only the wallet clause: the "select a single server" sentence is one this gate can never
 * reach, so asking a caller for it would be asking them to write operator copy nothing displays.
 */
export function useAnyServer(need: Pick<GateNeed, "wallet">): WalletGate<Wallet> {
  const { servers } = useServers();
  const { wallet } = useWallet();
  return anyServerGate(need, { servers, wallet });
}
