import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootedAfter,
  buildTarget,
  EMPTY_DRAFT,
  justRestored,
  loadRemembered,
  manifestFigures,
  RESUME_RESTORE_MS,
  saveRemembered,
  upsertRun,
  type TargetDraft,
} from "../logic";
import { manifest, run } from "./fixtures";

const ORIGIN = "https://alpha.example";
const DRAFT: TargetDraft = {
  endpoint: "",
  region: " us-east-1 ",
  bucket: "bkt",
  prefix: "beacon/one",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: " s3cret value ",
  forcePathStyle: false,
};

describe("buildTarget", () => {
  it("leaves a blank endpoint out, tidies the fields, and keeps the secret exactly as typed", () => {
    const built = buildTarget(DRAFT);
    expect(built).toEqual({
      ok: true,
      target: {
        region: "us-east-1",
        bucket: "bkt",
        prefix: "beacon/one",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: " s3cret value ",
        forcePathStyle: false,
      },
    });
  });

  it("reports each field in the wire schema's words", () => {
    const built = buildTarget({
      ...EMPTY_DRAFT,
      endpoint: "https://user@minio.example",
      region: "not a region",
      bucket: "bad bucket!",
      prefix: "../up",
    });
    expect(built).toEqual({
      ok: false,
      problems: {
        endpoint: "An endpoint has no login or query.",
        region: "A region name.",
        bucket: "A bucket name.",
        prefix: "A path has no . or .. segment.",
        accessKeyId: "Required.",
        secretAccessKey: "Required.",
      },
    });
  });
});

describe("what the browser remembers", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("keeps where the backups live per server, and neither credential", () => {
    saveRemembered(ORIGIN, DRAFT);
    const stored = JSON.stringify({ ...window.localStorage });
    expect(stored).not.toContain("s3cret");
    expect(stored).not.toContain("AKIAEXAMPLE");
    expect(loadRemembered(ORIGIN)).toEqual({
      endpoint: "",
      region: " us-east-1 ",
      bucket: "bkt",
      prefix: "beacon/one",
      forcePathStyle: false,
    });
    expect(loadRemembered("https://bravo.example")).toBeUndefined();
  });

  it("carries on when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => saveRemembered(ORIGIN, DRAFT)).not.toThrow();
    expect(loadRemembered(ORIGIN)).toBeUndefined();
  });
});

describe("manifestFigures", () => {
  it("adds the tables' rows and bytes up to the database's size", () => {
    expect(manifestFigures(manifest())).toEqual({ tables: 2, rows: 15, databaseBytes: 3072 });
  });
});

describe("bootedAfter", () => {
  it("says so only for a server that started after the run did", () => {
    expect(bootedAfter("2026-11-08T10:05:00.000Z", run())).toBe(true);
    expect(bootedAfter("2026-11-08T09:00:00.000Z", run())).toBe(false);
  });

  it("uses when the run was created if it never recorded a start", () => {
    expect(bootedAfter("2026-11-08T10:00:00.500Z", run({ startedAt: undefined }))).toBe(true);
  });
});

describe("justRestored", () => {
  const now = Date.parse("2026-11-08T10:10:00.000Z");
  const restore = (over = {}) =>
    run({
      kind: "restore",
      status: "done",
      finishedAt: "2026-11-08T10:09:00.000Z",
      ...over,
    });

  it("finds the newest restore while it is recent", () => {
    expect(justRestored([run({ status: "done" }), restore()], now)?.kind).toBe("restore");
  });

  it("ignores one finished too long ago", () => {
    const stale = new Date(now - RESUME_RESTORE_MS - 1000).toISOString();
    expect(justRestored([restore({ finishedAt: stale })], now)).toBeUndefined();
  });

  it("ignores an older restore behind a newer one that failed", () => {
    const failed = restore({ status: "failed" });
    expect(justRestored([failed, restore()], now)).toBeUndefined();
  });

  it("is nothing for a list with no restore", () => {
    expect(justRestored([run({ status: "done" })], now)).toBeUndefined();
  });
});

describe("upsertRun", () => {
  it("replaces a run in place, and puts a new one first", () => {
    const other = run({ id: "01KA0000000000000000000001" });
    const list = [other, run({ status: "running" })];
    expect(upsertRun(list, run({ status: "done" })).map((r) => r.status)).toEqual([
      "running",
      "done",
    ]);
    expect(upsertRun([other], run()).map((r) => r.id)).toEqual([run().id, other.id]);
  });
});
