import { createWallet, verifyOp } from "@beaconsgg/identity";
import { opEnvelopeSchema } from "@beaconsgg/protocol-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { stubFetch } from "@/lib/__tests__/fetchStub";
import {
  describeBackupError,
  inspectRestore,
  listRuns,
  readRun,
  startBackup,
  startRestore,
} from "../api";
import { manifest, run, RUN_ID } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

const ORIGIN = "https://s.example";
const wallet = createWallet();
const target = {
  region: "us-east-1",
  bucket: "bkt",
  prefix: "beacon/one",
  accessKeyId: "AKIA",
  secretAccessKey: "s3cret",
  forcePathStyle: false,
};

const expectSigned = (
  sent: { url: string; body: unknown },
  path: string,
  op: string,
  params: unknown,
) => {
  expect(sent.url).toBe(`${ORIGIN}${path}`);
  const env = opEnvelopeSchema.parse(sent.body);
  expect(env.op).toBe(op);
  expect(env.params).toEqual(params);
  expect(verifyOp(env, Date.now()).ok).toBe(true);
};

describe("backup feature api", () => {
  it("signs admin.backup.start with the target, and parses the run", async () => {
    const sent = stubFetch({ ok: true, run: { ...run(), fromANewerServer: true } });
    const started = await startBackup(ORIGIN, wallet, { target, includeIdentity: true });
    expect(started).toEqual(run());
    expectSigned(sent(), "/admin/backup/start", "admin.backup.start", {
      target,
      includeIdentity: true,
    });
  });

  it("signs admin.restore.start with the target, and parses the run", async () => {
    const sent = stubFetch({ ok: true, run: run({ kind: "restore" }) });
    await expect(startRestore(ORIGIN, wallet, { target })).resolves.toMatchObject({
      kind: "restore",
    });
    expectSigned(sent(), "/admin/restore/start", "admin.restore.start", { target });
  });

  it("reads a manifest and the server's refusal", async () => {
    const sent = stubFetch({ ok: true, manifest: manifest(), refusal: "Wrong host." });
    await expect(inspectRestore(ORIGIN, wallet, { target })).resolves.toEqual({
      manifest: manifest(),
      refusal: "Wrong host.",
    });
    expectSigned(sent(), "/admin/restore/inspect", "admin.restore.inspect", { target });
  });

  it("fails loudly on a manifest it cannot read", async () => {
    stubFetch({ ok: true, manifest: { ...manifest(), media: { count: 1 } } });
    await expect(inspectRestore(ORIGIN, wallet, { target })).rejects.toThrow();
  });

  it("lists runs with no params, and reads one by id", async () => {
    const list = stubFetch({ ok: true, runs: [run()] });
    await expect(listRuns(ORIGIN, wallet)).resolves.toEqual([run()]);
    expectSigned(list(), "/admin/backup/runs", "admin.backup.runs", {});

    const one = stubFetch({ ok: true, runs: [run()] });
    await expect(readRun(ORIGIN, wallet, RUN_ID)).resolves.toEqual(run());
    expectSigned(one(), "/admin/backup/runs", "admin.backup.runs", { id: RUN_ID });
  });

  it("answers undefined for a run the server does not list", async () => {
    stubFetch({ ok: true, runs: [] });
    await expect(readRun(ORIGIN, wallet, RUN_ID)).resolves.toBeUndefined();
  });
});

describe("describeBackupError", () => {
  it("says a 404 may be a server that needs updating", () => {
    expect(describeBackupError(new ApiError(404, "nope"))).toMatch(/may need updating/);
  });

  it("keeps the server's words for a refused field", () => {
    const refusal = new ApiError(400, JSON.stringify([{ path: ["target"], message: "Bad key." }]));
    expect(describeBackupError(refusal)).toBe("Bad key.");
  });
});
