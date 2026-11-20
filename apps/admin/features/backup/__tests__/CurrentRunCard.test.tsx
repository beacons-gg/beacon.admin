import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { savedServer } from "@/features/servers/__tests__/fixtures";
import { CurrentRunCard } from "../CurrentRunCard";
import type { FollowState } from "../useRunFollower";
import { run } from "./fixtures";

vi.mock("@/features/servers/ServersProvider", () => ({
  ServersProvider: () => null,
  useServers: () => ({}),
}));

const ALPHA = savedServer("https://alpha.example", { name: "Alpha" });
const restore = run({ kind: "restore", status: "done" });

const card = (follow: FollowState) => render(<CurrentRunCard server={ALPHA} follow={follow} />);

describe("the current run's note", () => {
  it("is absent until something is followed", () => {
    const { container } = card({ phase: "idle" });
    expect(container.textContent).toBe("");
  });

  it("calls a restart expected, with no alert", () => {
    card({ phase: "restarting", run: restore, slow: false });
    expect(document.body.textContent).toContain("Alpha is restarting");
    expect(document.body.textContent).toContain("which is expected");
    expect(document.body.textContent).not.toContain("longer than usual");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("mentions a long restart without calling it a failure", () => {
    card({ phase: "restarting", run: restore, slow: true });
    expect(document.body.textContent).toContain("longer than usual");
    expect(document.body.textContent).not.toMatch(/failed/i);
  });

  it("points a server that came back locked at Unlock", () => {
    card({ phase: "back", run: restore, locked: true });
    const note = screen.getByRole("status").textContent;
    expect(note).toContain("Alpha is back.");
    expect(note).toContain("use Unlock");
  });

  it("says when a server came back unlocked", () => {
    card({ phase: "back", run: restore, locked: false });
    const note = screen.getByRole("status").textContent;
    expect(note).toContain("came back unlocked");
    expect(note).not.toContain("use Unlock");
  });

  it("shows why a restore failed", () => {
    card({
      phase: "finished",
      run: run({ kind: "restore", status: "failed", error: "No space." }),
    });
    expect(document.body.textContent).toContain("The restore failed.");
    expect(document.body.textContent).toContain("No space.");
  });

  it.each([
    [true, "can be used for a move"],
    [false, "a move needs a locked one"],
  ])("says what a finished backup is good for, locked=%s", (locked, text) => {
    card({ phase: "finished", run: run({ status: "done", locked }) });
    expect(document.body.textContent).toContain(text);
  });

  it("shows a refusal as it was given", () => {
    card({ phase: "refused", run: run(), problem: "Denied by the server." });
    expect(document.body.textContent).toContain("Denied by the server.");
  });

  it("says plainly when a run is no longer listed", () => {
    card({ phase: "lost", run: run({ kind: "restore" }) });
    expect(document.body.textContent).toContain("no longer lists this restore");
  });

  it("uses one badge tone per status", () => {
    card({ phase: "running", run: run({ status: "queued" }) });
    expect(screen.getByText("queued").className).toContain("text-muted-foreground");
  });

  it("notes a backup it cannot reach, without calling it failed", () => {
    card({ phase: "reconnecting", run: run() });
    expect(document.body.textContent).toContain("carries on there");
  });
});
