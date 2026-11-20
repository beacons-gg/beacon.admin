"use client";

import type { Wallet } from "@beaconsgg/identity";
import type { BackupRun, BackupS3Target } from "@beaconsgg/protocol-types";
import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  ActiveServerLine,
  AddServerForm,
  GateNotice,
  useServers,
  useSingleServer,
  type SavedServer,
} from "@/features/servers";
import { Panel } from "@/components/primitives";
import { backupRunsKey, listRuns } from "./api";
import { BackupCard } from "./BackupCard";
import { CurrentRunCard } from "./CurrentRunCard";
import {
  buildTarget,
  EMPTY_DRAFT,
  isActive,
  justRestored,
  loadRemembered,
  saveRemembered,
  type TargetDraft,
  type TargetProblems,
} from "./logic";
import { RecentRunsCard } from "./RecentRunsCard";
import { RestoreCard } from "./RestoreCard";
import { S3TargetForm } from "./S3TargetForm";
import { useRunFollower } from "./useRunFollower";

/** How often the runs list is read while nothing is being followed, to notice a run from elsewhere. */
export const RUNS_REFRESH_MS = 15_000;

/**
 * Back up a server to S3 and restore one from a backup. A backup is one server's data, so this works
 * on a single server and needs an unlocked wallet. Nothing here asks for a capability, because these
 * ops are not advertised. The server keeps the address the operator typed, so a restored server can
 * be reached by its slug before DNS moves: `server.origin` is what every call goes to.
 *
 * `addAddress` is the server a link from elsewhere arrived with. It is offered, never added
 * without a press: the operator is about to type storage credentials into whatever gets selected,
 * so a link alone must not be able to choose it.
 */
export function BackupPanel({ addAddress }: { addAddress?: string | undefined } = {}) {
  const { active, setActive } = useServers();
  const [added, setAdded] = useState(false);
  const offering = addAddress !== undefined && !added && active !== addAddress;
  const gate = useSingleServer({
    server: "a backup holds one server's data",
    wallet: "backups and restores are signed admin ops",
  });
  return (
    <div className="space-y-4">
      {offering ? (
        <Panel title="Add this server">
          <p className="mb-3 text-sm text-muted-foreground">
            Add it to this console to back it up or restore it. Its signed descriptor is fetched and
            verified first.
          </p>
          <AddServerForm
            initialInput={addAddress}
            onAdded={(server) => {
              setActive(server.origin);
              setAdded(true);
            }}
          />
        </Panel>
      ) : null}
      {gate.ok ? (
        // Keyed so that typed credentials never carry over to another server.
        <BackupScreen key={gate.server.origin} server={gate.server} wallet={gate.wallet} />
      ) : offering ? null : (
        <GateNotice>{gate.refusal}</GateNotice>
      )}
    </div>
  );
}

function BackupScreen({ server, wallet }: { server: SavedServer; wallet: Wallet }) {
  const { origin } = server;
  const did = wallet.account.did;
  const { mutate } = useSWRConfig();
  const [draft, setDraft] = useState<TargetDraft>(() => ({
    ...EMPTY_DRAFT,
    ...loadRemembered(origin),
  }));
  const [problems, setProblems] = useState<TargetProblems>({});
  const [followed, setFollowed] = useState<BackupRun | undefined>(undefined);

  const follow = useRunFollower(origin, wallet, followed);
  // A restore that failed leaves the server as it was, so the key it would have given it is not
  // expected any more.
  const { expectKey } = useServers();
  const failedRestore =
    follow.phase === "finished" && follow.run.kind === "restore" && follow.run.status === "failed";
  const expecting = server.expecting !== undefined;
  useEffect(() => {
    if (failedRestore && expecting) expectKey(origin, undefined);
  }, [failedRestore, expecting, expectKey, origin]);
  const following =
    follow.phase === "running" || follow.phase === "reconnecting" || follow.phase === "restarting";

  // While a run is followed the follower writes each read into this cache, so a restart leaves no
  // failing list read behind to show the operator. Otherwise it refreshes, to notice another tab.
  const runs = useSWR(backupRunsKey(origin, did), () => listRuns(origin, wallet), {
    revalidateOnFocus: false,
    refreshInterval: following ? 0 : RUNS_REFRESH_MS,
  });
  const activeRun = runs.data?.find(isActive);
  const working = activeRun !== undefined || following;

  // A run already going when the page opens or started elsewhere, and once, on load, a restore that
  // has only just finished: the page may have been reloaded during its restart.
  const resumeChecked = useRef(false);
  useEffect(() => {
    if (!runs.data) return;
    const restored = resumeChecked.current ? undefined : justRestored(runs.data, Date.now());
    resumeChecked.current = true;
    const target = runs.data.find(isActive) ?? restored;
    if (target) setFollowed((current) => (current?.id === target.id ? current : target));
  }, [runs.data]);

  const change = (patch: Partial<TargetDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setProblems((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key as keyof TargetDraft];
      return next;
    });
  };

  /** The form as a target, or undefined with its problems shown beside the fields. */
  const takeTarget = (): BackupS3Target | undefined => {
    const built = buildTarget(draft);
    if (!built.ok) {
      setProblems(built.problems);
      return undefined;
    }
    setProblems({});
    saveRemembered(origin, draft);
    return built.target;
  };

  /** A run has started: follow it, and forget the secret so the next one is typed in again. */
  const started = (run: BackupRun) => {
    setFollowed(run);
    setDraft((current) => ({ ...current, secretAccessKey: "" }));
    void mutate(backupRunsKey(origin, did));
  };

  return (
    <div className="space-y-4">
      <ActiveServerLine server={server}>Backing up or restoring</ActiveServerLine>
      <S3TargetForm draft={draft} problems={problems} onChange={change} />
      <BackupCard
        origin={origin}
        wallet={wallet}
        working={working}
        takeTarget={takeTarget}
        onStarted={started}
      />
      <RestoreCard
        server={server}
        wallet={wallet}
        working={working}
        draft={draft}
        takeTarget={takeTarget}
        onStarted={started}
      />
      <CurrentRunCard server={server} follow={follow} />
      <RecentRunsCard runs={runs.data} error={runs.error} />
    </div>
  );
}
