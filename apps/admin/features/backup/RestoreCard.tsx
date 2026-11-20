"use client";

import type { Wallet } from "@beaconsgg/identity";
import type { AdminRestoreInspection, BackupRun, BackupS3Target } from "@beaconsgg/protocol-types";
import { useState } from "react";
import { toast } from "sonner";
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
import { Did, ErrorText, Facts, Panel, ToneBadge } from "@/components/primitives";
import { formatBytes } from "@/lib/format";
import { serverLabel, useServers, type SavedServer } from "@/features/servers";
import { describeBackupError, inspectRestore, startRestore } from "./api";
import { manifestFigures, type TargetDraft } from "./logic";

const REWIND =
  "This backup was not taken under a lock, so the server kept changing after it. Restoring it rewinds the game: phones keep items the server has forgotten.";

/** A manifest, and the exact target it was read from: what Start will restore. */
interface Inspected {
  target: BackupS3Target;
  inspection: AdminRestoreInspection;
}

/** What the last Inspect came to, and the form it was asked of. */
interface InspectResult {
  draft: TargetDraft;
  inspected?: Inspected;
  error?: string;
}

/** Inspect a backup first, then confirm what it holds before starting. */
export function RestoreCard({
  server,
  wallet,
  working,
  draft,
  takeTarget,
  onStarted,
}: {
  server: SavedServer;
  wallet: Wallet;
  working: boolean;
  /** The form as it stands. A new one on every edit and every started run. */
  draft: TargetDraft;
  takeTarget: () => BackupS3Target | undefined;
  onStarted: (run: BackupRun) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InspectResult | undefined>(undefined);
  const { expectKey } = useServers();
  // A result speaks for the form it was asked of. Once that is not the form on screen, however late
  // it arrived, it is dropped along with the secret its target holds.
  if (result && result.draft !== draft) setResult(undefined);

  const inspect = async () => {
    setResult(undefined);
    const target = takeTarget();
    if (!target) {
      setResult({ draft, error: "Check the storage details above." });
      return;
    }
    setBusy(true);
    try {
      const inspection = await inspectRestore(server.origin, wallet, { target });
      setResult({ draft, inspected: { target, inspection } });
    } catch (err) {
      setResult({ draft, error: describeBackupError(err) });
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!result?.inspected) return;
    setBusy(true);
    setResult({ ...result, error: "" });
    try {
      const run = await startRestore(server.origin, wallet, { target: result.inspected.target });
      // Signed for by the operator just now, so the console does not warn of it after the restart.
      const { did } = result.inspected.inspection.manifest;
      if (did !== server.key) expectKey(server.origin, did);
      onStarted(run);
      toast.success("Restore started");
    } catch (err) {
      setResult({ ...result, error: describeBackupError(err) });
    } finally {
      setBusy(false);
    }
  };

  const inspected = result?.inspected;
  return (
    <Panel title="Restore">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Reads the backup at the storage above and shows what it holds before anything changes. The
          server restarts when a restore ends.
        </p>
        <Button variant="outline" disabled={working || busy} onClick={() => void inspect()}>
          {busy && !inspected ? "Reading the backup…" : "Inspect backup"}
        </Button>
        {inspected ? (
          <>
            <ManifestReview inspection={inspected.inspection} />
            {inspected.inspection.refusal !== undefined ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
              >
                <span className="font-medium">This server will not restore this backup.</span>{" "}
                {inspected.inspection.refusal}
              </p>
            ) : (
              <ConfirmRestore
                inspected={inspected}
                server={server}
                disabled={working || busy}
                onConfirm={() => void start()}
              />
            )}
          </>
        ) : null}
        <ErrorText>{result?.error}</ErrorText>
      </div>
    </Panel>
  );
}

function ManifestReview({ inspection }: { inspection: AdminRestoreInspection }) {
  const { manifest } = inspection;
  const figures = manifestFigures(manifest);
  return (
    <Facts
      className="gap-x-4 text-sm"
      rows={[
        ["Host", <span className="font-mono break-all">{manifest.host}</span>],
        ["Server DID", <Did value={manifest.did} />],
        ["Taken", new Date(manifest.createdAt).toLocaleString()],
        [
          "Under a lock",
          <ToneBadge tone={manifest.locked ? "ok" : "warn"}>
            {manifest.locked ? "locked" : "not locked"}
          </ToneBadge>,
        ],
        ["Server key", manifest.identity ? "included" : "not included"],
        [
          "Database",
          `${figures.tables.toLocaleString()} tables, ${figures.rows.toLocaleString()} rows, ${formatBytes(figures.databaseBytes)}`,
        ],
        [
          "Media",
          `${manifest.media.count.toLocaleString()} files, ${formatBytes(manifest.media.bytes)}`,
        ],
        ["Version", `${manifest.serverVersion} (schema ${manifest.schemaVersion})`],
        [
          "Missing files",
          manifest.media.missing > 0 ? (
            <span className="text-status-warn">
              {manifest.media.missing.toLocaleString()} missing or corrupt on the server this was
              taken from, so they cannot be restored
            </span>
          ) : undefined,
        ],
      ]}
    />
  );
}

function ConfirmRestore({
  inspected,
  server,
  disabled,
  onConfirm,
}: {
  inspected: Inspected;
  server: SavedServer;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const { manifest } = inspected.inspection;
  const { endpoint, bucket, prefix } = inspected.target;
  const takesKey = manifest.did !== server.key;
  return (
    <div className="space-y-3">
      {takesKey || manifest.host !== server.host ? (
        <p className="rounded-md border border-status-warn/40 bg-status-warn/10 p-3 text-sm">
          Restoring makes this server the one in the backup: it takes the name{" "}
          <span className="font-mono break-all">{manifest.host}</span>
          {takesKey ? " and the backup's key" : ""}. It stays locked afterwards. Point{" "}
          <span className="font-mono break-all">{manifest.host}</span> at this server, set its
          public URL to match, check it, then unlock it.
        </p>
      ) : null}
      {manifest.locked ? (
        <p className="text-sm text-muted-foreground">
          This backup was taken under a lock, so the restored server starts locked and you can check
          it before opening it.
        </p>
      ) : (
        <p
          role="alert"
          className="rounded-md border border-status-warn/40 bg-status-warn/10 p-3 text-sm font-medium"
        >
          {REWIND}
        </p>
      )}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button disabled={disabled}>Start restore</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {serverLabel(server)} from this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              {`Loads ${bucket}/${prefix} from ${endpoint ?? "AWS"} onto this server, then restarts it. Players are cut off until it is back.`}
              {manifest.locked ? "" : ` ${REWIND}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>Restore server</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
