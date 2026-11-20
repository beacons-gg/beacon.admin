"use client";

import { useState } from "react";
import { LockIcon, UserRoundPenIcon, UserRoundIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Did, KICKER } from "@/components/primitives";
import { useWallet } from "@/features/wallet";
import { ProfileDialog } from "./ProfileDialog";

/**
 * The operator session, docked in the sidebar footer: the account DID (click to copy → each server's
 * `BEACON_ADMINS`), the public profile, and lock. The console shows only while the wallet is
 * unlocked (`AccessGate`), so locking here returns to the unlock screen.
 */
export function OperatorWell() {
  const w = useWallet();
  const [profileOpen, setProfileOpen] = useState(false);
  if (!w.wallet) return null;

  return (
    <>
      <div className="rounded-lg border bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <span className={KICKER}>operator</span>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-status-ok">
            <span className="size-[7px] bg-current" aria-hidden />
            unlocked
          </span>
        </div>
        <div className="mt-2.5 flex items-center gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-[5px] border border-line-2 bg-card text-muted-foreground">
            <UserRoundIcon className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <Did value={w.wallet.account.did} />
          </div>
        </div>
        <div className="mt-3 flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            aria-label="Edit public profile"
            onClick={() => setProfileOpen(true)}
          >
            <UserRoundPenIcon className="size-3.5" />
            Profile
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            aria-label="Lock wallet"
            onClick={() => w.lock()}
          >
            <LockIcon className="size-3.5" />
            Lock
          </Button>
        </div>
      </div>

      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  );
}
