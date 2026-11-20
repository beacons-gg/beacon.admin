import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boundedClient } from "@/lib/api";
import { WALLET } from "./fixtures";

/*
 * With SWR running for real and a fake clock: SWR's interval skips a key whose last read failed, so
 * whether a reader recovers from an outage on its own is the behaviour being tested.
 */

const wire = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  signedPost: wire.post,
}));
vi.mock("@/features/wallet", () => ({ useWallet: () => ({ wallet: WALLET }) }));

const { useAdminStatus } = await import("../useAdminStatus");

const ORIGIN = "https://alpha.example";
const INTERVAL = 30_000;
const up = {
  ok: true,
  status: {
    host: "h.example",
    name: "Alpha",
    version: "1.0.0",
    startedAt: "2026-11-08T00:00:00.000Z",
    accessLevel: "open",
    coverage: [""],
    capabilities: [],
    counts: {
      rooms: 0,
      profiles: 0,
      places: 0,
      placesRetired: 0,
      conflictsPending: 0,
      snapshots: 0,
      mediaObjects: 0,
      mediaBytes: 0,
      mediaUnreviewed: 0,
    },
  },
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
);
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("useAdminStatus", () => {
  it("recovers from an outage on its own, at the normal pace", async () => {
    wire.post.mockResolvedValueOnce(up);
    // Read during render: SWR re-renders only for the fields a render has touched.
    const { result } = renderHook(
      () => {
        const { data, error } = useAdminStatus(ORIGIN);
        return { data, error };
      },
      { wrapper },
    );
    await advance(0);
    expect(result.current.data?.host).toBe("h.example");

    wire.post.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await advance(INTERVAL);
    expect(result.current.error).toBeInstanceOf(TypeError);
    const failed = wire.post.mock.calls.length;

    await advance(INTERVAL - 1);
    expect(wire.post.mock.calls.length).toBe(failed);

    wire.post.mockResolvedValue(up);
    await advance(1);
    expect(result.current.error).toBeUndefined();

    const recovered = wire.post.mock.calls.length;
    await advance(INTERVAL);
    expect(wire.post.mock.calls.length).toBe(recovered + 1);
  });

  it("keeps trying through a long outage, one read per interval", async () => {
    wire.post.mockRejectedValue(new TypeError("Failed to fetch"));
    renderHook(() => useAdminStatus(ORIGIN), { wrapper });
    await advance(0);
    await advance(INTERVAL * 3);
    expect(wire.post).toHaveBeenCalledTimes(4);
  });

  it("asks with a time limit", async () => {
    wire.post.mockResolvedValue(up);
    renderHook(() => useAdminStatus(ORIGIN), { wrapper });
    await advance(0);
    expect(wire.post.mock.calls[0]![5]).toBe(boundedClient);
  });
});
