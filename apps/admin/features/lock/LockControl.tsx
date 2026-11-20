"use client";

import type { AdminStatus } from "@beaconsgg/protocol-types";
import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
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
import { Button } from "@/components/ui/button";
import { describeApiError, fieldIssues } from "@/lib/api";
import { adminStatusKey, serverLabel, type SavedServer } from "@/features/servers";
import { settingsSet } from "@/features/settings/api";
import { settingsKey } from "@/features/settings/useSettings";
import { useWallet } from "@/features/wallet";

/** Why a lock or an unlock did not take: the server's own sentence for a place import still running. */
function refusalOf(err: unknown): string {
  return (
    fieldIssues(err)
      ?.map((issue) => issue.message)
      .join(" ") ?? describeApiError(err)
  );
}

/**
 * Lock or unlock one server, after a confirmation that says what it does to players. `writeLocked` is
 * an ordinary setting, so this is one signed `admin.settings.set`; the status card and the banner
 * both render this control, and the settings screen edits the same value as a row.
 */
export function LockControl({ server, locked }: { server: SavedServer; locked: boolean }) {
  const { wallet } = useWallet();
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  // Fixed when the dialog opens: a poll that moves `locked` must not turn an open "Unlock?" into a lock.
  const [next, setNext] = useState(!locked);
  if (!wallet) return null;

  const did = wallet.account.did;
  const label = serverLabel(server);

  const apply = async () => {
    setBusy(true);
    try {
      const settings = await settingsSet(server.origin, wallet, { writeLocked: next });
      // The reply is the whole configuration, so the settings screen takes it without a read.
      void mutate(settingsKey(server.origin, did), settings, false);
      // The banner follows at once, and the read behind it confirms what the server now reports.
      void mutate<AdminStatus>(
        adminStatusKey(server.origin, did),
        (current) => current && { ...current, writeLocked: next },
      );
      toast.success(next ? `${label} is locked.` : `${label} is unlocked.`);
    } catch (err) {
      toast.error(refusalOf(err));
      // The write may have landed with its answer lost, so what the screens show is read again.
      void mutate(settingsKey(server.origin, did));
      void mutate(adminStatusKey(server.origin, did));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog onOpenChange={(open) => open && setNext(!locked)}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy}>
          {locked ? "Unlock" : "Lock"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {next ? "Lock" : "Unlock"} {label}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {!next
              ? "Players can make changes again as soon as it is unlocked. If you restored this server, check it first."
              : "Players cannot make changes while the server is locked. Maps and photos keep loading, but most admin screens are refused too, and it stays locked until an admin unlocks it."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void apply()}>
            {next ? "Lock server" : "Unlock server"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
