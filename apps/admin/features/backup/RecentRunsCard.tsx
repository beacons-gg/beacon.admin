"use client";

import type { BackupRun } from "@beaconsgg/protocol-types";
import { Did, ErrorText, Panel, RUN_STATUS_TONE, ToneBadge } from "@/components/primitives";
import { formatRunDuration } from "@/lib/format";
import { describeBackupError } from "./api";
import { RunDetails } from "./RunDetails";

/** The durable history: every backup and restore this server ran, most recent first. */
export function RecentRunsCard({ runs, error }: { runs: BackupRun[] | undefined; error: unknown }) {
  return (
    <Panel title="Recent runs">
      {error ? <ErrorText>{describeBackupError(error)}</ErrorText> : null}
      {runs && runs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No backups or restores yet.</p>
      ) : null}
      <ul className="space-y-1 text-sm">
        {(runs ?? []).map((run) => {
          const took = formatRunDuration(run);
          return (
            <li
              key={run.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded bg-muted px-2 py-1"
            >
              <ToneBadge tone={RUN_STATUS_TONE[run.status]}>{run.status}</ToneBadge>
              <span className="font-medium">{run.kind === "backup" ? "Backup" : "Restore"}</span>
              {run.kind === "backup" && run.locked !== undefined ? (
                <span className="text-xs text-muted-foreground">
                  {run.locked ? "locked" : "not locked"}
                </span>
              ) : null}
              <span className="font-mono text-xs text-muted-foreground">
                {run.target.bucket}/{run.target.prefix}
              </span>
              <Did value={run.id} />
              <span className="text-xs text-muted-foreground">
                {new Date(run.createdAt).toLocaleString()}
                {took ? ` · ${took}` : ""}
              </span>
              <RunDetails run={run} trackClassName="bg-background" />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
