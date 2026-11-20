"use client";

import type { BackupRun } from "@beaconsgg/protocol-types";
import { ProgressBar } from "@/components/primitives";
import { formatBytes } from "@/lib/format";
import { isActive } from "./logic";

/** One stage's bar. A stage whose total is not known yet shows no percent. */
function StageProgress({
  label,
  done,
  total,
  trackClassName,
}: {
  label: string;
  done: number;
  total: number;
  trackClassName: string | undefined;
}) {
  const ratio = total > 0 ? Math.min(done / total, 1) : 0;
  return (
    <div>
      <p className="flex items-baseline gap-2 text-xs text-muted-foreground tabular-nums">
        <span className="font-medium text-foreground">{label}</span>
        {done.toLocaleString()} of {total.toLocaleString()}
        {total > 0 ? ` (${Math.floor(ratio * 100)}%)` : ""}
      </p>
      <ProgressBar label={label} ratio={ratio} trackClassName={trackClassName} />
    </div>
  );
}

/** A run's progress or outcome, its warnings, and any files it reported missing. */
export function RunDetails({
  run,
  trackClassName,
}: {
  run: BackupRun;
  /** For a run shown on a surface where the default progress track would not show. */
  trackClassName?: string;
}) {
  const stats = run.stats;
  const active = isActive(run);
  const missing = stats?.mediaMissing ?? 0;
  const copied = stats ? stats.mediaDone - stats.mediaSkipped : 0;
  return (
    <div className="w-full space-y-1.5 text-xs">
      {active && stats ? (
        <div className="space-y-2 py-1">
          <StageProgress
            label="Tables"
            done={stats.tablesDone}
            total={stats.tablesTotal}
            trackClassName={trackClassName}
          />
          <StageProgress
            label="Media files"
            done={stats.mediaDone}
            total={stats.mediaTotal}
            trackClassName={trackClassName}
          />
        </div>
      ) : null}
      {stats ? (
        <p className="text-muted-foreground">
          {stats.tablesDone.toLocaleString()} of {stats.tablesTotal.toLocaleString()} tables ·{" "}
          {stats.rows.toLocaleString()} rows · {stats.mediaDone.toLocaleString()} of{" "}
          {stats.mediaTotal.toLocaleString()} media files, {formatBytes(stats.mediaBytes)}
          {stats.mediaSkipped > 0
            ? ` (${copied.toLocaleString()} copied, ${stats.mediaSkipped.toLocaleString()} already there)`
            : ""}
        </p>
      ) : null}
      {missing > 0 ? (
        <p className="font-medium text-status-warn">
          {missing.toLocaleString()} {missing === 1 ? "media file was" : "media files were"} missing
          or did not match {missing === 1 ? "its hash" : "their hashes"}
          {run.kind === "backup"
            ? ", so this backup does not hold them."
            : ", so this restore could not bring them back."}
        </p>
      ) : null}
      {run.warnings && run.warnings.length > 0 ? (
        <ul className="max-h-48 list-disc space-y-0.5 overflow-auto pl-4 text-status-warn">
          {run.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {run.error ? <p className="text-destructive">{run.error}</p> : null}
    </div>
  );
}
