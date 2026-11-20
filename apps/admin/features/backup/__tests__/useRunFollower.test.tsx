import type { AdminStatus, BackupRun } from "@beaconsgg/protocol-types";
import { adminBackupRunsReadSchema, adminStatusReadSchema } from "@beaconsgg/protocol-types";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { SWRConfig, unstable_serialize, useSWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WALLET } from "@/features/servers/__tests__/fixtures";
import { ServerError } from "@beaconsgg/client-sdk";
import { ApiError, WRITE_LOCKED } from "@/lib/api";
import { adminStatusKey } from "@/features/servers";
import { HIDDEN_POLL_MS, LONG_RESTART_MS, RUN_POLL_MS, useRunFollower } from "../useRunFollower";
import { run, RUN_ID } from "./fixtures";

/*
 * The follower against stubbed wire calls and a fake clock, because the time between reads is the
 * behaviour being tested, above all across the restart a restore ends with.
 */

const wire = vi.hoisted(() => ({
  readRun: vi.fn(),
  fetchStatus: vi.fn(),
}));

vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  readRun: wire.readRun,
}));
vi.mock("@/features/servers/useAdminStatus", async (original) => ({
  ...(await original<typeof import("@/features/servers/useAdminStatus")>()),
  fetchAdminStatus: wire.fetchStatus,
}));
vi.mock("@/features/wallet", () => ({ useWallet: () => ({ wallet: WALLET }) }));

const ORIGIN = "https://alpha.example";
const wallet = WALLET as never;

const status = (startedAt: string, writeLocked?: boolean) =>
  ({ startedAt, ...(writeLocked === undefined ? {} : { writeLocked }) }) as unknown as AdminStatus;

const OLD_BOOT = "2026-11-08T09:00:00.000Z";
const NEW_BOOT = "2026-11-08T10:30:00.000Z";

const restore = (over: Partial<BackupRun> = {}) => run({ kind: "restore", ...over });
const down = () => Promise.reject(new TypeError("Failed to fetch"));

let cache: Map<string, never>;

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
);

const follow = async (seed: BackupRun = run()) => {
  const hook = renderHook(
    () => {
      const state = useRunFollower(ORIGIN, wallet, seed);
      const { cache: shared } = useSWRConfig();
      return { state, shared };
    },
    { wrapper },
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  return hook;
};

const tick = (ms = RUN_POLL_MS) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-08T10:10:00.000Z"));
  vi.clearAllMocks();
  cache = new Map<string, never>();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("following a backup", () => {
  it("reads the run by id until it ends, then stops", async () => {
    wire.readRun.mockResolvedValueOnce(run()).mockResolvedValue(run({ status: "done" }));
    const { result } = await follow();
    expect(result.current.state.phase).toBe("running");
    expect(wire.readRun).toHaveBeenCalledWith(ORIGIN, WALLET, RUN_ID);

    await tick();
    expect(result.current.state).toMatchObject({ phase: "finished", run: { status: "done" } });

    const reads = wire.readRun.mock.calls.length;
    await tick(RUN_POLL_MS * 3);
    expect(wire.readRun.mock.calls.length).toBe(reads);
  });

  it("keeps trying through a network error, and notes it", async () => {
    wire.readRun
      .mockResolvedValueOnce(run())
      .mockImplementationOnce(down)
      .mockResolvedValue(run({ status: "done" }));
    const { result } = await follow();
    await tick();
    expect(result.current.state.phase).toBe("reconnecting");
    await tick();
    expect(result.current.state.phase).toBe("finished");
  });

  it("stops and says so on a reply it cannot parse", async () => {
    // Thrown by the wire schema itself, as the real read would.
    wire.readRun.mockImplementation(async () => adminBackupRunsReadSchema.parse({ runs: "nope" }));
    const { result } = await follow();
    expect(result.current.state).toMatchObject({
      phase: "refused",
      problem: expect.stringMatching(/could not read this run/),
    });
    await tick(RUN_POLL_MS * 3);
    expect(wire.readRun).toHaveBeenCalledTimes(1);
  });
});

describe("how a read can end the follow", () => {
  /* The server's own refusals, a 404 among them: only a 404 page that is not the server's is a fault. */
  it.each([
    [403, "denied", /BEACON_ADMINS/],
    [400, "invalid", /400: bad/],
    [404, "unknownRoute", /cannot do backups yet/],
  ])("stops on a %i and shows the refusal", async (status, code, text) => {
    wire.readRun.mockRejectedValue(new ApiError(status, "bad", code));
    const { result } = await follow();
    expect(result.current.state).toMatchObject({
      phase: "refused",
      problem: expect.stringMatching(text),
    });
    await tick(RUN_POLL_MS * 3);
    expect(wire.readRun).toHaveBeenCalledTimes(1);
  });

  /* As the SDK delivers the lock: an `ApiError` with the code from every call, with `Retry-After` or without. */
  it.each([
    ["without Retry-After", new ApiError(503, "The server is locked.", "writeLocked")],
    ["with Retry-After", new ApiError(503, "locked", "writeLocked", 60)],
  ])("stops when the server says it is locked, which is an answer (%s)", async (_case, err) => {
    wire.readRun.mockRejectedValue(err);
    const { result } = await follow(restore());
    expect(result.current.state).toMatchObject({ phase: "refused", problem: WRITE_LOCKED });
  });

  it.each([
    ["a 503", new ServerError(503)],
    ["a 429", new ApiError(429, "slow down", "rateLimited")],
    ["a proxy's 404", new ServerError(404)],
    ["a CDN's 403 page", new ServerError(403)],
  ])("keeps trying through %s", async (_case, err) => {
    wire.readRun.mockRejectedValueOnce(err).mockResolvedValue(run({ status: "done" }));
    const { result } = await follow();
    expect(result.current.state.phase).toBe("reconnecting");
    await tick();
    expect(result.current.state.phase).toBe("finished");
  });

  it("ends plainly when a reply no longer lists the run", async () => {
    wire.readRun.mockResolvedValue(undefined);
    const { result } = await follow();
    expect(result.current.state).toMatchObject({ phase: "lost", run: { id: RUN_ID } });
    await tick(RUN_POLL_MS * 3);
    expect(wire.readRun).toHaveBeenCalledTimes(1);
  });

  it("stops on a status reply it cannot parse, rather than restarting forever", async () => {
    wire.readRun.mockResolvedValue(restore({ status: "done" }));
    wire.fetchStatus.mockImplementation(async () => adminStatusReadSchema.parse({ host: 1 }));
    const { result } = await follow(restore());
    expect(result.current.state).toMatchObject({
      phase: "refused",
      problem: expect.stringMatching(/could not read this run/),
    });
    await tick(RUN_POLL_MS * 3);
    expect(wire.fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("stops on a status read the server refuses", async () => {
    wire.readRun.mockResolvedValue(restore({ status: "done" }));
    wire.fetchStatus.mockRejectedValue(new ApiError(403, "denied"));
    const { result } = await follow(restore());
    expect(result.current.state).toMatchObject({
      phase: "refused",
      problem: expect.stringMatching(/BEACON_ADMINS/),
    });
  });

  it("calls a restore a restore from the run it was given, before any read lands", async () => {
    wire.readRun.mockReturnValue(new Promise(() => {}));
    const { result } = await follow(restore());
    expect(result.current.state).toMatchObject({ phase: "running", run: { kind: "restore" } });
  });

  it("keeps a restore's label when the very first read fails", async () => {
    wire.readRun.mockImplementation(down);
    const { result } = await follow(restore());
    expect(result.current.state).toMatchObject({ phase: "restarting", run: { kind: "restore" } });
  });
});

describe("following a restore through its restart", () => {
  it("rides out the outage and says it is back only once a new process answers", async () => {
    wire.readRun
      .mockResolvedValueOnce(restore())
      .mockResolvedValueOnce(restore({ status: "done" }));
    wire.fetchStatus
      .mockResolvedValueOnce(status(OLD_BOOT)) // done, but this is still the old process
      .mockImplementationOnce(down)
      .mockImplementationOnce(down)
      .mockResolvedValue(status(NEW_BOOT, true));

    const { result } = await follow(restore());
    expect(result.current.state.phase).toBe("running");

    await tick();
    expect(result.current.state.phase).toBe("restarting");
    await tick();
    expect(result.current.state.phase).toBe("restarting");
    await tick();
    expect(result.current.state.phase).toBe("restarting");

    await tick();
    expect(result.current.state).toMatchObject({ phase: "back", locked: true });
    // Once done it cannot change, so through the restart only the status was read.
    expect(wire.readRun).toHaveBeenCalledTimes(2);

    const reads = wire.fetchStatus.mock.calls.length;
    await tick(RUN_POLL_MS * 3);
    expect(wire.fetchStatus.mock.calls.length).toBe(reads);
  });

  /*
   * SWR does not poll a key whose last read failed, so the status poll is stuck on the outage's error
   * unless something clears it. Without that the Unlock banner would not appear until a reload.
   */
  it("clears the status poll's stuck error, so the lock banner can appear", async () => {
    const statusKey = unstable_serialize(adminStatusKey(ORIGIN, WALLET.account.did));
    wire.readRun.mockResolvedValue(restore({ status: "done" }));
    wire.fetchStatus.mockResolvedValue(status(NEW_BOOT, true));
    cache.set(statusKey, { error: new TypeError("Failed to fetch") } as never);

    const { result } = await follow(restore());
    expect(result.current.state.phase).toBe("back");
    const entry = result.current.shared.get(statusKey);
    expect(entry?.error).toBeUndefined();
    expect(entry?.data).toMatchObject({ writeLocked: true });
  });

  it("counts an outage while the run still reads as running as the restart", async () => {
    wire.readRun.mockResolvedValueOnce(restore()).mockImplementation(down);
    const { result } = await follow(restore());
    await tick();
    expect(result.current.state.phase).toBe("restarting");
    expect(wire.fetchStatus).not.toHaveBeenCalled();
  });

  it("says it is slow after a long wait, without calling it a failure", async () => {
    wire.readRun.mockResolvedValue(restore({ status: "done" }));
    wire.fetchStatus.mockImplementation(down);
    const { result } = await follow(restore());
    expect(result.current.state).toMatchObject({ phase: "restarting", slow: false });
    await tick(LONG_RESTART_MS + RUN_POLL_MS);
    expect(result.current.state).toMatchObject({ phase: "restarting", slow: true });
  });

  it("reads only the status for a restore already known to be done", async () => {
    wire.fetchStatus.mockResolvedValue(status(NEW_BOOT, false));
    const { result } = await follow(restore({ status: "done" }));
    expect(result.current.state).toMatchObject({ phase: "back", locked: false });
    expect(wire.readRun).not.toHaveBeenCalled();
  });

  it("reports a restore that failed, and stops", async () => {
    wire.readRun.mockResolvedValue(restore({ status: "failed", error: "No space left." }));
    const { result } = await follow(restore());
    expect(result.current.state).toMatchObject({ phase: "finished", run: { status: "failed" } });
    await tick(RUN_POLL_MS * 2);
    expect(wire.readRun).toHaveBeenCalledTimes(1);
    expect(wire.fetchStatus).not.toHaveBeenCalled();
  });
});

describe("a tab in the background", () => {
  const hide = (hidden: boolean) => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(hidden);
  };
  afterEach(() => vi.restoreAllMocks());

  it("polls slowly while hidden", async () => {
    hide(true);
    wire.readRun.mockResolvedValue(run());
    await follow();
    await tick(HIDDEN_POLL_MS - 1);
    expect(wire.readRun).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(wire.readRun).toHaveBeenCalledTimes(2);
  });

  it("reads at once on coming back, then goes on at the normal pace", async () => {
    hide(true);
    wire.readRun.mockResolvedValue(run());
    await follow();
    hide(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(wire.readRun).toHaveBeenCalledTimes(2);
    await tick();
    expect(wire.readRun).toHaveBeenCalledTimes(3);
  });

  it("does not read on coming back once the run has ended", async () => {
    wire.readRun.mockResolvedValue(run({ status: "done" }));
    await follow();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(wire.readRun).toHaveBeenCalledTimes(1);
  });
});

describe("leaving the page", () => {
  it("stops polling", async () => {
    wire.readRun.mockResolvedValue(run());
    const { unmount } = await follow();
    unmount();
    const reads = wire.readRun.mock.calls.length;
    await tick(RUN_POLL_MS * 3);
    expect(wire.readRun.mock.calls.length).toBe(reads);
  });
});
