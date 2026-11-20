import {
  backupS3TargetSchema,
  type BackupManifest,
  type BackupRun,
  type BackupS3Target,
} from "@beaconsgg/protocol-types";
import { z } from "zod";
import { loadJson, saveJson } from "@/lib/storage";

/** The S3 form as typed. The form's own shape, so an empty endpoint can mean "AWS". */
export interface TargetDraft {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export const EMPTY_DRAFT: TargetDraft = {
  endpoint: "",
  region: "",
  bucket: "",
  prefix: "",
  accessKeyId: "",
  secretAccessKey: "",
  forcePathStyle: false,
};

export type TargetProblems = Partial<Record<keyof TargetDraft, string>>;

export type BuiltTarget =
  { ok: true; target: BackupS3Target } | { ok: false; problems: TargetProblems };

/** The wire schema's fragments ("a region name") read as a sentence under their field. */
function sentence(message: string): string {
  const capital = message.charAt(0).toUpperCase() + message.slice(1);
  return capital.endsWith(".") ? capital : `${capital}.`;
}

/**
 * The form as the wire's target, or what is wrong with it, field by field, in the wire schema's own
 * words. The secret is sent exactly as typed; the other fields lose stray spaces from a paste. A
 * blank endpoint is left out, which is how the wire says AWS.
 */
export function buildTarget(draft: TargetDraft): BuiltTarget {
  const endpoint = draft.endpoint.trim();
  const parsed = backupS3TargetSchema.safeParse({
    ...(endpoint ? { endpoint } : {}),
    region: draft.region.trim(),
    bucket: draft.bucket.trim(),
    prefix: draft.prefix.trim(),
    accessKeyId: draft.accessKeyId.trim(),
    secretAccessKey: draft.secretAccessKey,
    forcePathStyle: draft.forcePathStyle,
  });
  if (parsed.success) return { ok: true, target: parsed.data };
  const problems: TargetProblems = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof TargetDraft;
    problems[field] ??= issue.code === "too_small" ? "Required." : sentence(issue.message);
  }
  return { ok: false, problems };
}

const REMEMBERED_KEY = "beacon-admin.backup-target";

/**
 * What this browser keeps per server: only where the backups live. Both credentials are typed in
 * each time. The access key is left out too, because the wire and the plan treat it as a credential.
 */
const rememberedSchema = z.object({
  endpoint: z.string(),
  region: z.string(),
  bucket: z.string(),
  prefix: z.string(),
  forcePathStyle: z.boolean(),
});
export type RememberedTarget = z.infer<typeof rememberedSchema>;

/** The remembered fields for a server. Storage that is blocked or full reads as nothing saved. */
export function loadRemembered(origin: string): RememberedTarget | undefined {
  try {
    return loadJson(`${REMEMBERED_KEY}:${origin}`, rememberedSchema);
  } catch {
    return undefined;
  }
}

/** Remember the form's non-secret fields, named one by one so a credential cannot ride along. */
export function saveRemembered(origin: string, draft: TargetDraft): void {
  const { endpoint, region, bucket, prefix, forcePathStyle } = draft;
  try {
    saveJson(`${REMEMBERED_KEY}:${origin}`, {
      endpoint,
      region,
      bucket,
      prefix,
      forcePathStyle,
    });
  } catch {
    // Storage is a convenience here; a backup does not depend on it.
  }
}

/** The figures an operator checks before a restore. `tables[].bytes` adds up to the database's size. */
export function manifestFigures(manifest: BackupManifest): {
  tables: number;
  rows: number;
  databaseBytes: number;
} {
  return {
    tables: manifest.tables.length,
    rows: manifest.tables.reduce((sum, table) => sum + table.rows, 0),
    databaseBytes: manifest.tables.reduce((sum, table) => sum + table.bytes, 0),
  };
}

export function isActive(run: BackupRun): boolean {
  return run.status === "queued" || run.status === "running";
}

/** How recently a restore can have finished for a page opened now to still follow its restart. */
export const RESUME_RESTORE_MS = 5 * 60_000;

/**
 * The newest restore, if it finished moments ago: a page reloaded during the restart it ends with has
 * nothing else to say the server is coming back. The list is newest first.
 */
export function justRestored(runs: BackupRun[], now: number): BackupRun | undefined {
  const newest = runs.find((run) => run.kind === "restore");
  if (newest?.status !== "done" || !newest.finishedAt) return undefined;
  return now - Date.parse(newest.finishedAt) < RESUME_RESTORE_MS ? newest : undefined;
}

/** Whether a server that started at `startedAt` has restarted since `run` began. */
export function bootedAfter(startedAt: string, run: BackupRun): boolean {
  return Date.parse(startedAt) > Date.parse(run.startedAt ?? run.createdAt);
}

/** The list with one run replaced in place, or put first when the list has not got it yet. */
export function upsertRun(list: BackupRun[], run: BackupRun): BackupRun[] {
  return list.some((r) => r.id === run.id)
    ? list.map((r) => (r.id === run.id ? run : r))
    : [run, ...list];
}
