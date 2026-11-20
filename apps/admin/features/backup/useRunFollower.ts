"use client";

import type { Wallet } from "@beaconsgg/identity";
import type { BackupRun } from "@beaconsgg/protocol-types";
import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { describeApiError } from "@/lib/api";
import { adminStatusKey, fetchAdminStatus } from "@/features/servers";
import { backupRunsKey, describeBackupError, isParseError, isUnreachable, readRun } from "./api";
import { bootedAfter, isActive, upsertRun } from "./logic";

/** How often a run, and a server coming back from a restart, is read. */
export const RUN_POLL_MS = 3000;
/** The same, while this tab is in the background. Coming back to the tab reads at once. */
export const HIDDEN_POLL_MS = 30_000;
/** How long a restart runs before the card says it is taking a while. */
export const LONG_RESTART_MS = 5 * 60_000;

/**
 * Where a followed run stands:
 *
 * - `running`: the server answered and the run is queued or running.
 * - `reconnecting`: a backup's read could not reach the server. The run carries on there.
 * - `restarting`: a restore that has finished, or whose reads could not reach the server, on its way
 *   through the restart it ends with. Failures are the expected state here, not an error to show.
 * - `back`: the server answered from a process that started after the restore did.
 * - `finished`: a backup that ended, or a restore that failed.
 * - `refused`: the server answered no, or in a shape this console cannot read.
 * - `lost`: the server answered and no longer lists the run.
 *
 * The first three go on being polled. The rest are ends: asking again would get the same answer.
 */
export type FollowedState =
  | { phase: "running" | "reconnecting" | "finished" | "lost"; run: BackupRun }
  | { phase: "restarting"; run: BackupRun; slow: boolean }
  | { phase: "back"; run: BackupRun; locked: boolean }
  | { phase: "refused"; run: BackupRun; problem: string };

export type FollowState = { phase: "idle" } | FollowedState;

const isOngoing = ({ phase }: FollowState) =>
  phase === "running" || phase === "reconnecting" || phase === "restarting";

/** What to tell the operator when a failed read was a definite answer, or undefined if it may pass. */
function refusalOf(err: unknown): string | undefined {
  if (isParseError(err)) {
    return `The console could not read this run's progress. ${describeApiError(err)}`;
  }
  return isUnreachable(err) ? undefined : describeBackupError(err);
}

/**
 * Follow one durable run until it ends, keeping the runs list current as it goes. `followed` is the
 * run as last known, which is what the card shows until the first read lands.
 *
 * This is a timer rather than SWR's `refreshInterval` because SWR stops polling a key once a read has
 * failed, and a restore ends with the server going away. Once a run is `done` it cannot change, so
 * through the restart only the status is read. The status read that finds the server back is
 * written into its cache, so the lock banner appears now rather than at the status poll's next try.
 *
 * A restart is judged by the status's `startedAt` against the run's own, both from the server's
 * clock, so reloading this page in the middle of one still finds the right answer.
 */
export function useRunFollower(
  origin: string,
  wallet: Wallet,
  followed: BackupRun | undefined,
): FollowState {
  const { mutate } = useSWRConfig();
  const [state, setState] = useState<FollowState>({ phase: "idle" });

  useEffect(() => {
    if (followed === undefined) return;
    const did = wallet.account.did;
    let cancelled = false;
    // Set only while waiting for the next read, so nothing can start a second one alongside it.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = followed;
    let restartingSince: number | undefined;

    const restarting = (run: BackupRun): FollowedState => {
      restartingSince ??= Date.now();
      return { phase: "restarting", run, slow: Date.now() - restartingSince >= LONG_RESTART_MS };
    };

    /** One read of whatever can still change, and where that leaves the run. */
    const step = async (): Promise<FollowedState> => {
      let reached = true;
      if (isActive(last)) {
        try {
          const fresh = await readRun(origin, wallet, last.id);
          if (!fresh) return { phase: "lost", run: last };
          last = fresh;
        } catch (err) {
          const problem = refusalOf(err);
          if (problem !== undefined) return { phase: "refused", run: last, problem };
          reached = false;
        }
      }
      const run = last;

      if (run.status === "failed") return { phase: "finished", run };
      if (run.kind === "backup") {
        if (run.status === "done") return { phase: "finished", run };
        return { phase: reached ? "running" : "reconnecting", run };
      }
      if (run.status !== "done") {
        if (!reached) return restarting(run);
        restartingSince = undefined;
        return { phase: "running", run };
      }

      try {
        const status = await fetchAdminStatus(origin, wallet);
        if (bootedAfter(status.startedAt, run)) {
          if (!cancelled) void mutate(adminStatusKey(origin, did), status, { revalidate: false });
          return { phase: "back", run, locked: status.writeLocked === true };
        }
      } catch (err) {
        const problem = refusalOf(err);
        if (problem !== undefined) return { phase: "refused", run, problem };
      }
      return restarting(run);
    };

    const tick = async () => {
      timer = undefined;
      const next = await step();
      if (cancelled) return;
      setState(next);
      void mutate<BackupRun[]>(
        backupRunsKey(origin, did),
        (list) => list && upsertRun(list, next.run),
        { revalidate: false },
      );
      if (isOngoing(next)) {
        timer = setTimeout(() => void tick(), document.hidden ? HIDDEN_POLL_MS : RUN_POLL_MS);
        return;
      }
      void mutate(backupRunsKey(origin, did));
      void mutate(adminStatusKey(origin, did));
    };

    const onVisibility = () => {
      if (document.hidden || timer === undefined) return;
      clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [origin, wallet, followed, mutate]);

  if (followed === undefined) return { phase: "idle" };
  return state.phase !== "idle" && state.run.id === followed.id
    ? state
    : { phase: "running", run: followed };
}
