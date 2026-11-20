import type { Wallet } from "@beaconsgg/identity";
import {
  adminBackupRunsReadSchema,
  adminRestoreInspectionReadSchema,
  backupRunReadSchema,
  type AdminBackupRunsParams,
  type AdminBackupStartParams,
  type AdminRestoreInspection,
  type AdminRestoreInspectParams,
  type AdminRestoreStartParams,
  type BackupRun,
} from "@beaconsgg/protocol-types";
import { isFault } from "@beaconsgg/client-sdk";
import { z } from "zod";
import { ApiError, boundedClient, describeApiError, fieldIssues, signedPost } from "@/lib/api";

/**
 * Typed wrappers over the backup and restore ops. Every call is a signed admin op, and these routes
 * stay available while a server is locked. `target` carries the S3 secret, so it goes in a request
 * body and nowhere else: the SWR keys below name the server and the account, and a run reports its
 * destination without the credentials.
 */

const runResponse = z.object({ run: backupRunReadSchema });

/** The runs list's SWR key, the one place it is spelled. */
export function backupRunsKey(origin: string, did: string): [string, string, string] {
  return ["admin.backup.runs", origin, did];
}

/** Start a backup. It runs in the background on the server; the answer is its durable run. */
export function startBackup(
  origin: string,
  wallet: Wallet,
  params: AdminBackupStartParams,
): Promise<BackupRun> {
  return signedPost(origin, "/admin/backup/start", wallet, "admin.backup.start", {
    ...params,
  }).then((r) => runResponse.parse(r).run);
}

/** Read a backup's manifest, and hear in the server's words whether it would restore it here. */
export function inspectRestore(
  origin: string,
  wallet: Wallet,
  params: AdminRestoreInspectParams,
): Promise<AdminRestoreInspection> {
  return signedPost(origin, "/admin/restore/inspect", wallet, "admin.restore.inspect", {
    ...params,
  }).then((r) => adminRestoreInspectionReadSchema.parse(r));
}

/** Start a restore. It ends with the server restarting. */
export function startRestore(
  origin: string,
  wallet: Wallet,
  params: AdminRestoreStartParams,
): Promise<BackupRun> {
  return signedPost(origin, "/admin/restore/start", wallet, "admin.restore.start", {
    ...params,
  }).then((r) => runResponse.parse(r).run);
}

function fetchRuns(
  origin: string,
  wallet: Wallet,
  params: AdminBackupRunsParams,
): Promise<BackupRun[]> {
  return signedPost(
    origin,
    "/admin/backup/runs",
    wallet,
    "admin.backup.runs",
    { ...params },
    boundedClient,
  ).then((r) => adminBackupRunsReadSchema.parse(r).runs);
}

/** The most recent runs of both kinds. */
export function listRuns(origin: string, wallet: Wallet): Promise<BackupRun[]> {
  return fetchRuns(origin, wallet, {});
}

/** One run by id, or `undefined` when the server does not list it. */
export function readRun(
  origin: string,
  wallet: Wallet,
  id: string,
): Promise<BackupRun | undefined> {
  return fetchRuns(origin, wallet, { id }).then((runs) => runs.find((run) => run.id === id));
}

/** Whether a failed read was a reply this console cannot parse. Polling it again would never end. */
export function isParseError(err: unknown): boolean {
  // By name, as `ServersProvider` does: the schemas may parse with another copy of zod.
  return err instanceof Error && err.name === "ZodError";
}

/**
 * Whether a failed read means the server could not be heard, rather than that it answered no: a
 * fault, or a request to come back later (408, 429). A fault is the network, a time limit, a 5xx, or
 * a reply that is not the server's own, such as the 404 Traefik answers while a restarting container
 * is unhealthy. Any other refusal, the lock included, is the server's answer, and asking again will
 * not change it.
 */
export function isUnreachable(err: unknown): boolean {
  if (isFault(err)) return true;
  if (err instanceof ApiError) return err.status === 408 || err.status === 429;
  return !isParseError(err);
}

/** A refusal in the server's words where it gave some, and the console's own copy otherwise. */
export function describeBackupError(err: unknown): string {
  const issues = fieldIssues(err);
  if (issues) return issues.map((issue) => issue.message).join(" ");
  if (err instanceof ApiError && err.status === 404) {
    return "This server cannot do backups yet (it may need updating), or it has no admin surface.";
  }
  return describeApiError(err);
}
