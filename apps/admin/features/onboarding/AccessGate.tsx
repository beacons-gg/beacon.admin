"use client";

import { useState, type ReactNode } from "react";
import { useWallet } from "@/features/wallet";
import { AuthFrame } from "./AuthFrame";
import { SessionRenewalDialog } from "./SessionRenewalDialog";
import { UnlockScreen } from "./UnlockScreen";
import { Welcome } from "./Welcome";

/**
 * The console's front door. Everything behind it needs an unlocked wallet, the way a dashboard needs
 * a sign-in:
 *
 * - no wallet saved in this browser: the welcome, which sets one up;
 * - a wallet saved but locked: the unlock screen, and nothing else;
 * - unlocked: the console.
 *
 * The welcome unlocks the wallet partway through, so once it starts it stays up until the operator
 * finishes it. A session that runs out while the console is open does not come back here: the
 * renewal dialog asks for the passphrase over the page, and only giving up on it locks the wallet.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const w = useWallet();
  const [welcoming, setWelcoming] = useState(false);
  // Derived during render, so the first frame after the storage read is already the welcome.
  if (w.ready && w.status === "none" && !welcoming) setWelcoming(true);

  if (!w.ready) return <AuthFrame />;
  if (!welcoming && w.status !== "unlocked") return <UnlockScreen />;
  return (
    <>
      {welcoming ? <Welcome onDone={() => setWelcoming(false)} /> : children}
      <SessionRenewalDialog />
    </>
  );
}
