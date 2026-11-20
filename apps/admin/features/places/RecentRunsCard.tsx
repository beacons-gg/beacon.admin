"use client";

import type { PlaceSnapshotStats } from "@beaconsgg/protocol-types";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Did,
  ErrorText,
  Panel,
  ProgressBar,
  RUN_STATUS_TONE,
  ToneBadge,
} from "@/components/primitives";
import { describeApiError } from "@/lib/api";
import { formatRunDuration } from "@/lib/format";
import { useWallet } from "@/features/wallet";
import { cancelSnapshot, listSnapshots, snapshotsKey } from "./api";
import { describeImportOptions } from "./atlasImportLogic";

/**
 * The durable run history — every ingestion this server performed, whatever started it: an Atlas
 * volume import, a `list:` file from the Transfer tab, a re-run. Its own card because it is the
 * *outcome* surface the other cards point at ("watch Recent runs"), not part of any one starter.
 *
 * Polls fast only while something is queued/running; otherwise the list is static history.
 */
export function RecentRunsCard({ origin }: { origin: string }) {
  const { wallet } = useWallet();
  const [error, setError] = useState<string | undefined>(undefined);

  const runs = useSWR(
    wallet ? snapshotsKey(origin, wallet.account.did) : null,
    () => listSnapshots(origin, wallet!),
    {
      refreshInterval: (data) =>
        data?.some((s) => s.status === "queued" || s.status === "running") ? 3000 : 0,
      revalidateOnFocus: false,
    },
  );

  const cancel = async (id: string) => {
    if (!wallet) return;
    // A live run stops at its next chunk boundary; an orphaned one flips immediately. Safe to re-run.
    if (!window.confirm("Cancel this run? A live run stops at its next chunk boundary.")) return;
    setError(undefined);
    try {
      await cancelSnapshot(origin, wallet, id);
      toast.success("Run cancelled");
      await runs.mutate();
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  return (
    <Panel title="Recent runs">
      {runs.error ? <ErrorText>{describeApiError(runs.error)}</ErrorText> : null}
      {runs.data && runs.data.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No runs yet — import an Atlas volume above, or a places file from the Transfer tab.
        </p>
      ) : null}
      <ul className="space-y-1 text-sm">
        {(runs.data ?? []).map((s) => {
          const took = formatRunDuration(s);
          // What the run was asked to take, when it narrowed anything: types and import options.
          const scope = [
            ...(s.params.categories ? [`types ${s.params.categories.join(", ")}`] : []),
            ...describeImportOptions(s.params.options, s.params.categories),
          ];
          return (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded bg-muted px-2 py-1"
            >
              <ToneBadge tone={RUN_STATUS_TONE[s.status]}>{s.status}</ToneBadge>
              <span className="text-muted-foreground">{s.source}</span>
              <Did value={s.id} />
              <span className="text-xs text-muted-foreground">
                {new Date(s.createdAt).toLocaleString()}
                {took ? ` · ${took}` : ""}
              </span>
              {s.status === "running" && s.stats ? (
                <RunProgress
                  stats={s.stats}
                  unit={s.source.startsWith("atlas:") ? "cells" : "chunks"}
                />
              ) : null}
              {s.stats ? (
                <span className="text-xs text-muted-foreground">
                  +{s.stats.created} ~{s.stats.updated} ={s.stats.unchanged} −{s.stats.retired}
                  {s.stats.conflicts > 0 ? ` · ${s.stats.conflicts} conflicts` : ""}
                  {s.stats.filtered ? ` · ${s.stats.filtered} skipped by filters` : ""}
                  {s.stats.retiredFiltered
                    ? ` · ${s.stats.retiredFiltered} of the retired skipped by filters`
                    : ""}
                  {s.stats.retiredUnselected
                    ? ` · ${s.stats.retiredUnselected} of the retired were types left out`
                    : ""}
                  {s.stats.imagesStorageFull ? (
                    <span className="text-status-warn">
                      {` · ${s.stats.imagesStorageFull.toLocaleString()} photos not imported: storage full`}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {scope.length > 0 ? (
                <span className="w-full text-xs text-muted-foreground">{scope.join(" · ")}</span>
              ) : null}
              {s.error ? <span className="text-xs text-destructive">{s.error}</span> : null}
              {s.status === "queued" || s.status === "running" ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className="ml-auto text-destructive"
                  onClick={() => void cancel(s.id)}
                >
                  Cancel
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <ErrorText>{error}</ErrorText>
    </Panel>
  );
}

/**
 * A running run's percent done, the one thing an operator watching a long import wants, so it is
 * the largest text in the row. Progress is chunks; an Atlas import's chunks are its volume cells.
 */
function RunProgress({ stats, unit }: { stats: PlaceSnapshotStats; unit: string }) {
  const ratio = stats.chunksTotal > 0 ? stats.chunksDone / stats.chunksTotal : 0;
  // A regional run has tens of thousands of chunks, so a whole percent can sit still for minutes.
  const percent = (ratio * 100).toFixed(stats.chunksTotal >= 1000 ? 1 : 0);
  return (
    <div className="w-full py-1">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{percent}%</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {stats.chunksDone.toLocaleString()} of {stats.chunksTotal.toLocaleString()} {unit} done
        </span>
      </div>
      <ProgressBar label="Import progress" ratio={ratio} trackClassName="h-2 bg-background" />
    </div>
  );
}
