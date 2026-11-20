/**
 * `ServersProvider` and the identity of each saved server. Every saved server starts the
 * session unchecked; its launch refresh lands on its own, and one answering under a different key is
 * flagged and the operator told once. One that can't be reached stays unchecked and is tried again. A re-add or remove the operator makes while a check is still in
 * flight is newer than that check, so its late result doesn't undo it.
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedServer } from "../registry";
import { RECHECK_MS, ServersProvider, useServers } from "../ServersProvider";
import { savedServer } from "./fixtures";

const A = savedServer("https://a.example", { name: "Alpha" });
const B = savedServer("https://b.example", { name: "Bravo" });

const toastWarning = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { warning: toastWarning } }));

/** Each refresh waits until the test settles it, so the test controls the order things land in. */
const pending = vi.hoisted(
  () => new Map<string, { resolve: (s: unknown) => void; reject: (e: unknown) => void }>(),
);
const saved = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock("../registry", async (original) => {
  const actual = await original<typeof import("../registry")>();
  return {
    ...actual,
    loadServers: () => [A, B],
    saveServers: (list: unknown[]) => {
      saved.list = list;
    },
    refreshServer: (s: SavedServer) =>
      new Promise((resolve, reject) => pending.set(s.origin, { resolve, reject })),
    probeServer: (address: string) =>
      Promise.resolve({ ...A, origin: address, key: "did:key:zNew" }),
  };
});

const role = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock("../role", () => ({ probeRole: role.probe }));

const { ServerIdentityChanged } = await import("../registry");

const wrapper = ({ children }: { children: ReactNode }) => (
  <ServersProvider>{children}</ServersProvider>
);

/** Settle one server's launch check. */
async function land(origin: string, outcome: "same" | "changed" | "unreachable") {
  const p = pending.get(origin)!;
  await act(async () => {
    if (outcome === "same") p.resolve(origin === A.origin ? A : B);
    else p.reject(outcome === "changed" ? new ServerIdentityChanged(origin) : new Error("down"));
  });
}

beforeEach(() => {
  role.probe.mockReset();
  toastWarning.mockReset();
  pending.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Let the retry clock run out, so a server that couldn't be reached is checked again. */
async function waitOutRetry() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RECHECK_MS);
  });
}

describe("each saved server's identity this session", () => {
  it("starts unchecked, and is flagged only when its own check finds another key", async () => {
    const { result } = renderHook(() => useServers(), { wrapper });
    expect(result.current.checking).toEqual([A.origin, B.origin]);

    await land(B.origin, "same");
    expect(result.current.checking).toEqual([A.origin]);
    expect(result.current.identityChanged).toEqual([]);

    await land(A.origin, "changed");
    expect(result.current.checking).toEqual([]);
    expect(result.current.identityChanged).toEqual([A.origin]);
  });

  it("keeps a server it couldn't reach unchecked, and checks it again", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useServers(), { wrapper });
    await land(B.origin, "unreachable"); // not a changed identity, and not a confirmed one either
    expect(result.current.checking).toEqual([A.origin, B.origin]);
    expect(result.current.identityChanged).toEqual([]);

    pending.delete(B.origin);
    await waitOutRetry();
    await land(B.origin, "changed"); // back up, under another key
    expect(result.current.checking).toEqual([A.origin]);
    expect(result.current.identityChanged).toEqual([B.origin]);
  });

  it("stops checking a server the operator removes while it can't be reached", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useServers(), { wrapper });
    await land(B.origin, "unreachable");
    pending.delete(B.origin);
    act(() => result.current.remove(B.origin));
    await waitOutRetry();
    expect(pending.has(B.origin)).toBe(false);
  });

  it("still flags a server whose check lands after another's refreshed the list", async () => {
    const { result } = renderHook(() => useServers(), { wrapper });
    await land(A.origin, "same"); // rewrites the stored list
    await land(B.origin, "changed");
    expect(result.current.identityChanged).toEqual([B.origin]);
    expect(toastWarning).toHaveBeenCalledTimes(1);
  });

  it("tells the operator once, naming the server", async () => {
    const { result, rerender } = renderHook(() => useServers(), { wrapper });
    await land(A.origin, "changed");
    await land(B.origin, "same");
    rerender();
    await act(async () => {
      await result.current.add(B.origin);
    });
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastWarning.mock.calls[0]?.[0]).toContain("Alpha is now signing with a different key");
  });

  it("is trusted again once the operator adds its origin again, or removed", async () => {
    const { result } = renderHook(() => useServers(), { wrapper });
    await land(A.origin, "changed");
    await land(B.origin, "changed");
    await act(async () => {
      await result.current.add(A.origin);
    });
    act(() => result.current.remove(B.origin));
    expect(result.current.identityChanged).toEqual([]);
  });

  it("keeps a re-add made while the check was still in flight", async () => {
    const { result } = renderHook(() => useServers(), { wrapper });
    await act(async () => {
      await result.current.add(A.origin); // the operator re-approves before A's check lands
    });
    expect(result.current.checking).toEqual([B.origin]);
    await land(A.origin, "changed"); // the stale check finds the old pin no longer matches
    expect(result.current.identityChanged).toEqual([]);
    expect(result.current.servers.find((s) => s.origin === A.origin)?.key).toBe("did:key:zNew");
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("keeps a re-add over a stale check that still finds the old key at that origin", async () => {
    // Two parties answering one origin mid-flight (a split DNS, or someone else taking over the
    // origin): the re-add's probe met the new key, the stale check the old one. The operator's
    // record stands.
    const { result } = renderHook(() => useServers(), { wrapper });
    await act(async () => {
      await result.current.add(A.origin);
    });
    await land(A.origin, "same");
    expect(result.current.servers.find((s) => s.origin === A.origin)?.key).toBe("did:key:zNew");
    expect(saved.list).toContainEqual(expect.objectContaining({ key: "did:key:zNew" }));
  });

  it("keeps a removal made while the check was still in flight", async () => {
    const { result } = renderHook(() => useServers(), { wrapper });
    act(() => result.current.remove(A.origin));
    await land(A.origin, "same"); // a refreshed copy of a server the operator has removed
    expect(result.current.servers.map((s) => s.origin)).toEqual([B.origin]);
    expect(saved.list).toHaveLength(1);
  });
});

describe("adding a server the wallet is not an admin of", () => {
  const C = "https://c.example";
  const W = { account: { did: "did:key:z6MkOperator" } } as never;

  it("opens it as a quick view, selectable for this session and never saved", async () => {
    role.probe.mockResolvedValueOnce("notAdmin");
    const { result } = renderHook(() => useServers(), { wrapper });
    await land(A.origin, "same"); // rewrites the stored list once, before the add
    let added: Awaited<ReturnType<typeof result.current.add>> | undefined;
    await act(async () => {
      added = await result.current.add(C, W);
    });
    expect(added?.preview).toBe(true);
    expect(role.probe).toHaveBeenCalledWith(C, W);
    expect(result.current.preview).toBe(C);
    expect(result.current.servers.map((s) => s.origin)).toContain(C);
    expect(saved.list.map((s) => (s as SavedServer).origin)).not.toContain(C);

    act(() => result.current.setActive(C));
    expect(result.current.targets.map((s) => s.origin)).toEqual([C]);

    act(() => result.current.remove(C)); // closing it
    expect(result.current.preview).toBeUndefined();
    expect(result.current.servers.map((s) => s.origin)).not.toContain(C);
  });

  it("saves a server whose admin list holds the wallet, or that could not say", async () => {
    const { result } = renderHook(() => useServers(), { wrapper });
    role.probe.mockResolvedValueOnce("admin");
    await act(async () => {
      await result.current.add(C, W);
    });
    role.probe.mockResolvedValueOnce("unknown");
    await act(async () => {
      await result.current.add("https://d.example", W);
    });
    expect(result.current.preview).toBeUndefined();
    expect(saved.list.map((s) => (s as SavedServer).origin)).toEqual(
      expect.arrayContaining([C, "https://d.example"]),
    );
  });

  it("keeps a server already saved, rather than dropping it to a quick view", async () => {
    const { result } = renderHook(() => useServers(), { wrapper });
    await act(async () => {
      await result.current.add(A.origin, W);
    });
    expect(role.probe).not.toHaveBeenCalled();
    expect(result.current.preview).toBeUndefined();
  });
});
