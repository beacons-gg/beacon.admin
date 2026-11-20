"use client";

import { KeyRoundIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UnlockForm } from "./UnlockForm";
import { useWallet } from "@/features/wallet";

/**
 * The unlock the console asks for when a server refuses a request because the wallet session ran
 * out (`lib/session.ts`). Mounted once by the front door (`AccessGate`), so the dialog opens over
 * whatever is on screen, the welcome included, and the refused request is sent again under the new
 * session. Closing the dialog without unlocking fails the waiting requests and locks the wallet.
 */
export function SessionRenewalDialog() {
  const w = useWallet();
  return (
    <Dialog
      open={w.renewing}
      onOpenChange={(open) => {
        if (!open) w.cancelRenewal();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-4 text-primary" />
            Wallet session ended
          </DialogTitle>
          <DialogDescription>
            An unlock lasts 7 days, so a server refused the last request. Enter the passphrase to
            start a new session, and the console sends the request again.
          </DialogDescription>
        </DialogHeader>
        <UnlockForm id="renewal-passphrase" />
      </DialogContent>
    </Dialog>
  );
}
