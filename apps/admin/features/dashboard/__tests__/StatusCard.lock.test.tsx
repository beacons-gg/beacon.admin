/**
 * The status card's lock badge and control. The control itself is tested with the banner in
 * `features/lock`; what matters here is which servers get one, since a server too old to report the
 * lock has none to set.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { savedServer } from "../../servers/__tests__/fixtures";

const status = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/features/servers/useAdminStatus", () => ({
  useAdminStatus: () => status.value,
  adminStatusKey: () => [],
}));
vi.mock("@/features/lock", () => ({
  LockControl: ({ locked }: { locked: boolean }) => <button>{locked ? "Unlock" : "Lock"}</button>,
}));

const { StatusCard } = await import("../StatusCard");

const data = (writeLocked?: boolean) => ({
  version: "1.0.0",
  accessLevel: "open",
  capabilities: [],
  coverage: [""],
  startedAt: "2026-11-08T00:00:00.000Z",
  counts: { conflictsPending: 0, mediaUnreviewed: 0, mediaBytes: 0 },
  ...(writeLocked === undefined ? {} : { writeLocked }),
});

beforeEach(() => {
  status.value = { data: data(false) };
});

const renderCard = () => render(<StatusCard server={savedServer("https://a.example")} />);

describe("the lock on a status card", () => {
  it("offers Lock on an unlocked server and says nothing about it", () => {
    renderCard();
    expect(screen.getByRole("button", { name: "Lock" })).toBeTruthy();
    expect(screen.queryByText("locked")).toBeNull();
  });

  it("marks a locked server and offers Unlock", () => {
    status.value = { data: data(true) };
    renderCard();
    expect(screen.getByText("locked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy();
  });

  it("offers nothing on a server too old to report the lock", () => {
    status.value = { data: data(undefined) };
    renderCard();
    expect(screen.queryByRole("button")).toBeNull();
  });

  /* SWR keeps the last good data through a failed refresh, and that is no basis for a lock. */
  it("offers nothing on a server that stopped answering", () => {
    status.value = { data: data(false), error: new Error("down") };
    renderCard();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
