import type { BackupManifest, BackupRun } from "@beaconsgg/protocol-types";

/** Shared fixtures for the backup suites. Not collected by vitest, which globs `*.test.ts`. */
export const DID = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
export const RUN_ID = "01KA0000000000000000000000";

export const run = (over: Partial<BackupRun> = {}): BackupRun => ({
  id: RUN_ID,
  kind: "backup",
  status: "running",
  requestedBy: DID,
  target: { region: "us-east-1", bucket: "bkt", prefix: "beacon/one" },
  createdAt: "2026-11-08T10:00:00.000Z",
  startedAt: "2026-11-08T10:00:01.000Z",
  ...over,
});

export const manifest = (over: Partial<BackupManifest> = {}): BackupManifest => ({
  format: 1,
  createdAt: "2026-11-08T09:00:00.000Z",
  host: "game.example",
  did: DID,
  schemaVersion: 42,
  serverVersion: "1.2.3",
  locked: true,
  identity: true,
  tables: [
    { name: "rooms", columns: ["id"], rows: 10, bytes: 2048, file: "db/1/rooms" },
    { name: "media", columns: ["id"], rows: 5, bytes: 1024, file: "db/1/media" },
  ],
  media: { count: 5, bytes: 1048576, missing: 0 },
  ...over,
});
