"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useWallet } from "@/features/wallet";
import { AuthCard, AuthFrame, StepHead } from "./AuthFrame";
import { UnlockForm } from "./UnlockForm";

/**
 * The console's sign-in: a wallet is saved in this browser but locked, so the passphrase is the only
 * way in. Nothing of the console shows until it opens. The way out for an operator who lost the
 * passphrase is to forget the saved wallet and restore it from its recovery phrase on the welcome.
 */
export function UnlockScreen() {
  const w = useWallet();

  return (
    <AuthFrame>
      <AuthCard>
        <StepHead kicker="operator sign-in" title="Welcome back">
          Your operator wallet is saved in this browser. Enter its passphrase to open the console.
        </StepHead>
        <div className="mt-6">
          <UnlockForm id="unlock-passphrase" large />
        </div>
        <p className="mt-3 text-xs text-ink-3">An unlock lasts 7 days on this browser.</p>
      </AuthCard>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            className="mx-auto mt-5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Forgot the passphrase, or using another identity?
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Forget the wallet saved in this browser?</AlertDialogTitle>
            <AlertDialogDescription>
              The console removes the encrypted wallet from this browser and starts the welcome
              again. You can then restore this identity from its twelve-word recovery phrase, or set
              up another one. Without the recovery phrase, this identity cannot come back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => w.forget()}>
              Forget the wallet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AuthFrame>
  );
}
