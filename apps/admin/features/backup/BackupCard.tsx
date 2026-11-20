"use client";

import type { Wallet } from "@beaconsgg/identity";
import type { BackupRun, BackupS3Target } from "@beaconsgg/protocol-types";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorText, Panel, ToneBadge } from "@/components/primitives";
import { useAdminStatus } from "@/features/servers";
import { describeBackupError, startBackup } from "./api";

/**
 * Whether the backup about to start will be a locked one, from the status poll. A failed read leaves
 * old data behind, so it says it cannot tell rather than repeating that data. A server too old to
 * report the lock counts as not locked, since it has no lock to set.
 */
function LockedLine({ origin }: { origin: string }) {
  const { data, error } = useAdminStatus(origin);
  if (error || !data) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ToneBadge>{error ? "unknown" : "checking"}</ToneBadge>
        {error ? "Cannot read whether this server is locked right now." : null}
      </p>
    );
  }
  if (data.writeLocked) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <ToneBadge tone="ok">locked</ToneBadge>
        <span>
          This will be a locked backup: nothing can change after this copy, so it can be used for a
          move.
        </span>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <ToneBadge tone="warn">not locked</ToneBadge>
      <span>
        This will not be a locked backup. That is fine for safekeeping, but a move needs a locked
        one: use Lock on this server&apos;s card on the{" "}
        <Link href="/overview" className="underline">
          Overview
        </Link>{" "}
        page first.
      </span>
    </p>
  );
}

/** Start a backup with the storage above. */
export function BackupCard({
  origin,
  wallet,
  working,
  takeTarget,
  onStarted,
}: {
  origin: string;
  wallet: Wallet;
  working: boolean;
  takeTarget: () => BackupS3Target | undefined;
  onStarted: (run: BackupRun) => void;
}) {
  const [includeIdentity, setIncludeIdentity] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const start = async () => {
    setError(undefined);
    const target = takeTarget();
    if (!target) {
      setError("Check the storage details above.");
      return;
    }
    setBusy(true);
    try {
      onStarted(await startBackup(origin, wallet, { target, includeIdentity }));
      toast.success("Backup started");
    } catch (err) {
      setError(describeBackupError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Back up">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The backup runs in the background on the server, so you can leave this page. Running it
          again to the same prefix only uploads new photos.
        </p>
        <LockedLine origin={origin} />
        <div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeIdentity}
              onCheckedChange={(on) => setIncludeIdentity(on === true)}
            />
            Include server key
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            A restore on a new machine needs this key, unless you keep it somewhere else.
          </p>
        </div>
        <p
          role="note"
          className="rounded-md border border-status-warn/40 bg-status-warn/10 p-3 text-sm"
        >
          Treat this bucket like a password.{" "}
          {includeIdentity
            ? "It holds this server's key and all its data, and backups are not encrypted, so anyone who can read it can restore this server."
            : "It holds all this server's data, and backups are not encrypted, so anyone who can read it can read everything on this server."}
        </p>
        <Button disabled={working || busy} onClick={() => void start()}>
          {busy ? "Starting…" : "Start backup"}
        </Button>
        <ErrorText>{error}</ErrorText>
      </div>
    </Panel>
  );
}
