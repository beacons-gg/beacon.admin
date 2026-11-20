"use client";

import { Panel, RUN_STATUS_TONE, ToneBadge } from "@/components/primitives";
import { serverLabel, type SavedServer } from "@/features/servers";
import { RunDetails } from "./RunDetails";
import type { FollowedState, FollowState } from "./useRunFollower";

/** The run this page is following: its progress, then how it ended and what to do next. */
export function CurrentRunCard({ server, follow }: { server: SavedServer; follow: FollowState }) {
  if (follow.phase === "idle") return null;
  const { run } = follow;
  const kind = run.kind === "restore" ? "Restore" : "Backup";
  return (
    <Panel title="Current run">
      <div className="space-y-2 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={RUN_STATUS_TONE[run.status]}>{run.status}</ToneBadge>
          <span className="text-muted-foreground">{kind}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {run.target.bucket}/{run.target.prefix}
          </span>
        </p>
        <PhaseNote follow={follow} label={serverLabel(server)} kind={kind} />
        <RunDetails run={run} />
      </div>
    </Panel>
  );
}

function PhaseNote({
  follow,
  label,
  kind,
}: {
  follow: FollowedState;
  label: string;
  kind: string;
}) {
  switch (follow.phase) {
    case "running":
      return null;
    case "reconnecting":
      return (
        <p className="text-muted-foreground">
          Cannot reach the server right now. The {kind.toLowerCase()} carries on there, and this
          page keeps trying.
        </p>
      );
    case "restarting":
      return (
        <div className="space-y-1 text-muted-foreground">
          <p>
            {label} is restarting, as it does at the end of a restore. It will not answer for a
            while, which is expected. This page keeps trying and will say when it is back.
          </p>
          {follow.slow ? (
            <p>
              This is taking longer than usual. If it does not come back soon, check the
              server&apos;s logs.
            </p>
          ) : null}
        </div>
      );
    case "back":
      return (
        <p role="status" className="text-status-ok">
          <span className="font-medium">{label} is back.</span>{" "}
          <span className="text-foreground">
            {follow.locked
              ? "It came back locked, as the backup was. Check it through this address, then use Unlock in the banner at the top of the page to open it to players."
              : "It came back unlocked, so players can use it now."}
          </span>
        </p>
      );
    case "finished":
      if (follow.run.status === "failed") {
        return <p className="text-destructive">The {kind.toLowerCase()} failed.</p>;
      }
      return (
        <p className="text-status-ok">
          Backup finished.{" "}
          <span className="text-muted-foreground">
            {follow.run.locked
              ? "It was taken under a lock, so it can be used for a move."
              : "It was not taken under a lock: fine for safekeeping, but a move needs a locked one."}
          </span>
        </p>
      );
    case "refused":
      return <p className="text-destructive">{follow.problem}</p>;
    case "lost":
      return (
        <p className="text-muted-foreground">
          The server no longer lists this {kind.toLowerCase()}, so this page cannot say how it
          ended.
        </p>
      );
  }
}
