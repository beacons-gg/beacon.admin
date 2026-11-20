import type { AdminStatus, BackupRun } from "@beaconsgg/protocol-types";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { savedServer, WALLET } from "@/features/servers/__tests__/fixtures";
import { DID, manifest, run } from "./fixtures";

/*
 * The screen as an operator meets it, with SWR running for real and the wire stubbed where the feature
 * calls it. The cases are the ones that would hurt: a secret that leaks, and a restore that starts
 * from something the operator did not see.
 */

const wire = vi.hoisted(() => ({ post: vi.fn() }));
const servers = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const registry = vi.hoisted(() => ({ add: vi.fn(), setActive: vi.fn(), expectKey: vi.fn() }));

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  signedPost: wire.post,
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/features/servers/ServersProvider", () => ({
  ServersProvider: () => null,
  useServers: () => servers.value,
}));
vi.mock("@/features/wallet", () => ({
  useWallet: () => ({ status: "unlocked", wallet: WALLET }),
}));

const { BackupPanel } = await import("..");
const { RUNS_REFRESH_MS } = await import("../BackupPanel");

const ALPHA = savedServer("https://alpha.example", { name: "Alpha" });
const BRAVO = savedServer("https://bravo.example", { name: "Bravo" });
const SECRET = "s3cret-value";
const ACCESS = "AKIAEXAMPLE";

let writeLocked: boolean | undefined;
let bootedAt: string;
let answers: Record<string, () => unknown>;

const select = (server: typeof ALPHA) => {
  servers.value = {
    servers: [ALPHA, BRAVO],
    active: server.origin,
    activeServer: server,
    setActive: registry.setActive,
    add: registry.add,
    expectKey: registry.expectKey,
    targets: [server],
    identityChanged: [],
    checking: [],
  };
};

let cache: Map<string, never>;
const screenWith = () => (
  <SWRConfig value={{ provider: () => cache }}>
    <BackupPanel />
  </SWRConfig>
);

const field = (name: RegExp | string) => screen.getByLabelText(name);

const fillForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(field("Region"), "us-east-1");
  await user.type(field("Bucket"), "bkt");
  await user.type(field("Prefix"), "beacon/one");
  await user.type(field("Access key"), ACCESS);
  await user.type(field("Secret"), SECRET);
};

const inspect = async (user: ReturnType<typeof userEvent.setup>) => {
  await fillForm(user);
  await user.click(screen.getByRole("button", { name: "Inspect backup" }));
};

const calls = (path: string) => wire.post.mock.calls.filter(([, p]) => p === path);
const listReads = () => calls("/admin/backup/runs").filter(([, , , , params]) => !params.id);

/** A promise the test settles itself, to hold a request open. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  cache = new Map<string, never>();
  select(ALPHA);
  writeLocked = false;
  bootedAt = "2026-11-08T00:00:00.000Z";
  answers = {
    "/admin/backup/start": () => ({ ok: true, run: run() }),
    "/admin/restore/start": () => ({ ok: true, run: run({ kind: "restore" }) }),
    "/admin/restore/inspect": () => ({ ok: true, manifest: manifest() }),
    "/admin/backup/runs": () => ({ ok: true, runs: [] }),
  };
  wire.post.mockImplementation((_origin: string, path: string, ...rest: unknown[]) => {
    const { id } = rest[2] as { id?: string };
    if (path === "/admin/backup/runs" && id) {
      const listed = (answers[path]!() as { runs: BackupRun[] }).runs.find((r) => r.id === id);
      return Promise.resolve({ ok: true, runs: [listed ?? run({ id })] });
    }
    if (path === "/admin/status") {
      return Promise.resolve({
        ok: true,
        status: {
          host: "h.example",
          name: "Alpha",
          version: "1.0.0",
          startedAt: bootedAt,
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
          ...(writeLocked === undefined ? {} : { writeLocked }),
        } satisfies AdminStatus,
      });
    }
    const answer = answers[path];
    return answer ? Promise.resolve(answer()) : Promise.reject(new ApiError(404, "no route"));
  });
});

describe("arriving from a hosting link", () => {
  const SLUG = "https://ada.us1.example.test";
  const NEW = savedServer(SLUG, { name: "Ada", host: "ada.example.org" });
  const linked = () => (
    <SWRConfig value={{ provider: () => cache }}>
      <BackupPanel addAddress={SLUG} />
    </SWRConfig>
  );
  const unselected = () => {
    servers.value = {
      servers: [],
      active: undefined,
      activeServer: undefined,
      setActive: registry.setActive,
      add: registry.add,
      targets: [],
      identityChanged: [],
      checking: [],
    };
  };

  beforeEach(() => {
    unselected();
    registry.add.mockResolvedValue({ server: NEW, preview: false });
  });

  it("seeds the address, sends nothing until Add, and hides the no-servers notice", async () => {
    render(linked());
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(SLUG);
    expect(registry.add).not.toHaveBeenCalled();
    expect(screen.queryByText(/Add a server on the Servers page/)).toBeNull();
  });

  it("adds the address as given and selects what the console saved", async () => {
    const user = userEvent.setup();
    render(linked());
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(registry.setActive).toHaveBeenCalledWith(SLUG));
    expect(registry.add).toHaveBeenCalledWith(SLUG, WALLET);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Add" })).toBeNull());
  });

  it("shows why an address could not be added, and offers it again", async () => {
    registry.add.mockRejectedValueOnce(new Error("Could not verify that server."));
    const user = userEvent.setup();
    render(linked());
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Could not verify that server.")).toBeTruthy();
    expect(registry.setActive).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });

  it("offers nothing once that server is the selected one", async () => {
    select(savedServer(SLUG, { name: "Ada" }));
    render(linked());
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(await screen.findByRole("button", { name: "Start backup" })).toBeTruthy();
  });
});

describe("the form", () => {
  it("shows the wire schema's complaints and sends nothing", async () => {
    const user = userEvent.setup();
    render(screenWith());
    await user.type(field("Region"), "not a region");
    await user.click(screen.getByRole("button", { name: "Start backup" }));

    expect(await screen.findByText("A region name.")).toBeTruthy();
    expect(screen.getAllByText("Required.").length).toBe(2);
    expect(calls("/admin/backup/start")).toEqual([]);
  });

  it("remembers where backups live per server, and keeps the credentials out of the browser", async () => {
    const user = userEvent.setup();
    const { unmount } = render(screenWith());
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Start backup" }));
    await waitFor(() => expect(calls("/admin/backup/start").length).toBe(1));

    const stored = JSON.stringify({ ...window.localStorage });
    expect(stored).toContain("bkt");
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain(ACCESS);
    unmount();

    render(screenWith());
    await waitFor(() => expect((field("Bucket") as HTMLInputElement).value).toBe("bkt"));
    expect((field("Secret") as HTMLInputElement).value).toBe("");
  });

  it("forgets typed credentials when the operator moves to another server", async () => {
    const user = userEvent.setup();
    const { rerender } = render(screenWith());
    await user.type(field("Secret"), SECRET);

    select(BRAVO);
    rerender(screenWith());
    await waitFor(() => expect((field("Secret") as HTMLInputElement).value).toBe(""));
  });

  it("keeps the secret out of every SWR key and toast", async () => {
    const user = userEvent.setup();
    render(screenWith());
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Start backup" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());

    expect(JSON.stringify([...cache.keys()])).not.toContain(SECRET);
    expect(JSON.stringify(toast.success.mock.calls)).not.toContain(SECRET);
    await waitFor(() => expect((field("Secret") as HTMLInputElement).value).toBe(""));
  });

  it("sends the secret in the signed body, to the address typed", async () => {
    const user = userEvent.setup();
    render(screenWith());
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Start backup" }));
    await waitFor(() => expect(calls("/admin/backup/start").length).toBe(1));
    const [origin, , , op, params] = calls("/admin/backup/start")[0]!;
    expect(origin).toBe(ALPHA.origin);
    expect(op).toBe("admin.backup.start");
    expect(params).toMatchObject({
      includeIdentity: true,
      target: { secretAccessKey: SECRET, accessKeyId: ACCESS },
    });
  });
});

describe("backing up", () => {
  it("includes the server key by default and says to treat the bucket like a password", async () => {
    render(screenWith());
    const box = screen.getByRole("checkbox", { name: "Include server key" });
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("note").textContent).toContain("Treat this bucket like a password");
  });

  it("sends includeIdentity off when unticked", async () => {
    const user = userEvent.setup();
    render(screenWith());
    await fillForm(user);
    await user.click(screen.getByRole("checkbox", { name: "Include server key" }));
    await user.click(screen.getByRole("button", { name: "Start backup" }));
    await waitFor(() => expect(calls("/admin/backup/start").length).toBe(1));
    expect(calls("/admin/backup/start")[0]![4]).toMatchObject({ includeIdentity: false });
  });

  it.each([
    [true, "This will be a locked backup"],
    [false, "This will not be a locked backup"],
  ])("from the status poll, locked=%s reads as such", async (locked, text) => {
    writeLocked = locked;
    render(screenWith());
    expect(await screen.findByText(new RegExp(text))).toBeTruthy();
  });
});

describe("restoring", () => {
  it("shows the manifest before Start, with the figures added up", async () => {
    const user = userEvent.setup();
    render(screenWith());
    await inspect(user);
    expect(await screen.findByRole("button", { name: "Start restore" })).toBeTruthy();
    const body = document.body.textContent;
    expect(body).toContain("game.example");
    expect(body).toContain("2 tables, 15 rows, 3 KB");
    expect(body).toContain("5 files, 1.0 MB");
    expect(calls("/admin/restore/start")).toEqual([]);
  });

  it("shows a refusal in the server's words and offers no Start", async () => {
    answers["/admin/restore/inspect"] = () => ({
      ok: true,
      manifest: manifest(),
      refusal: "This backup is from another server.",
    });
    const user = userEvent.setup();
    render(screenWith());
    await inspect(user);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "This backup is from another server.",
    );
    expect(screen.queryByRole("button", { name: "Start restore" })).toBeNull();
  });

  it("says the server becomes the backup's, and expects its key once started", async () => {
    answers["/admin/restore/inspect"] = () => ({
      ok: true,
      manifest: manifest({ host: "old.example" }),
    });
    const user = userEvent.setup();
    render(screenWith());
    await inspect(user);
    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "it takes the name old.example and the backup's key",
      ),
    );
    await user.click(await screen.findByRole("button", { name: "Start restore" }));
    await user.click(await screen.findByRole("button", { name: "Restore server" }));
    await waitFor(() => expect(registry.expectKey).toHaveBeenCalledWith(ALPHA.origin, DID));
  });

  it("says nothing of becoming another server when the backup is this one", async () => {
    answers["/admin/restore/inspect"] = () => ({
      ok: true,
      manifest: manifest({ host: "h.example", did: ALPHA.key }),
    });
    const user = userEvent.setup();
    render(screenWith());
    await inspect(user);
    await user.click(await screen.findByRole("button", { name: "Start restore" }));
    expect(document.body.textContent).not.toContain("takes the name");
    await user.click(await screen.findByRole("button", { name: "Restore server" }));
    await waitFor(() => expect(calls("/admin/restore/start")).toHaveLength(1));
    expect(registry.expectKey).not.toHaveBeenCalled();
  });

  it("warns that an unlocked backup rewinds the game", async () => {
    answers["/admin/restore/inspect"] = () => ({
      ok: true,
      manifest: manifest({ locked: false }),
    });
    const user = userEvent.setup();
    render(screenWith());
    await inspect(user);
    expect((await screen.findByRole("alert")).textContent).toMatch(/rewinds the game/);
  });

  it("names missing files from the manifest's count", async () => {
    answers["/admin/restore/inspect"] = () => ({
      ok: true,
      manifest: manifest({ media: { count: 5, bytes: 10, missing: 2 } }),
    });
    const user = userEvent.setup();
    render(screenWith());
    await inspect(user);
    expect(await screen.findByText(/2 missing or corrupt/)).toBeTruthy();
  });

  it("starts only after confirming, with the target it inspected", async () => {
    const user = userEvent.setup();
    render(screenWith());
    await inspect(user);
    await user.click(await screen.findByRole("button", { name: "Start restore" }));
    await screen.findByRole("alertdialog");
    expect(calls("/admin/restore/start")).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Restore server" }));
    await waitFor(() => expect(calls("/admin/restore/start").length).toBe(1));
    expect(calls("/admin/restore/start")[0]![4]).toMatchObject({
      target: { bucket: "bkt", secretAccessKey: SECRET },
    });
    expect(calls("/admin/restore/start")[0]![0]).toBe(ALPHA.origin);
  });

  it("names the storage it will load, endpoint included, in the confirmation", async () => {
    const user = userEvent.setup();
    render(screenWith());
    await user.type(field(/^Endpoint/), "https://minio.example:9000");
    await inspect(user);
    await user.click(await screen.findByRole("button", { name: "Start restore" }));
    expect((await screen.findByRole("alertdialog")).textContent).toContain(
      "bkt/beacon/one from https://minio.example:9000",
    );
  });

  it("says AWS in the confirmation when the endpoint is blank", async () => {
    const user = userEvent.setup();
    render(screenWith());
    await inspect(user);
    await user.click(await screen.findByRole("button", { name: "Start restore" }));
    expect((await screen.findByRole("alertdialog")).textContent).toContain("from AWS");
  });

  it("drops an inspect the form was edited under", async () => {
    const slow = deferred<unknown>();
    answers["/admin/restore/inspect"] = () => slow.promise;
    const user = userEvent.setup();
    render(screenWith());
    await inspect(user);
    await user.type(field("Bucket"), "2");

    await act(async () => slow.resolve({ ok: true, manifest: manifest() }));
    expect(screen.queryByRole("button", { name: "Start restore" })).toBeNull();
    expect(document.body.textContent).not.toContain("game.example");
  });

  it("drops an inspect overtaken by a run starting", async () => {
    const slow = deferred<unknown>();
    answers["/admin/restore/inspect"] = () => slow.promise;
    const user = userEvent.setup();
    render(screenWith());
    await inspect(user);
    await user.click(screen.getByRole("button", { name: "Start backup" }));
    await waitFor(() => expect(calls("/admin/backup/start").length).toBe(1));

    await act(async () => slow.resolve({ ok: true, manifest: manifest() }));
    expect(screen.queryByRole("button", { name: "Start restore" })).toBeNull();
  });

  it("drops the error of an inspect that was overtaken", async () => {
    let refuse!: (err: unknown) => void;
    answers["/admin/restore/inspect"] = () => new Promise((_, reject) => (refuse = reject));
    const user = userEvent.setup();
    render(screenWith());
    await inspect(user);
    await user.type(field("Bucket"), "2");

    await act(async () => refuse(new ApiError(400, "Could not read that bucket.")));
    expect(document.body.textContent).not.toContain("Could not read that bucket");
  });

  it("does not start when cancelled", async () => {
    const user = userEvent.setup();
    render(screenWith());
    await inspect(user);
    await user.click(await screen.findByRole("button", { name: "Start restore" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(calls("/admin/restore/start")).toEqual([]);
  });

  it("discards the manifest when the storage changes", async () => {
    const user = userEvent.setup();
    render(screenWith());
    await inspect(user);
    await screen.findByRole("button", { name: "Start restore" });
    await user.type(field("Prefix"), "x");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Start restore" })).toBeNull());
  });
});

describe("runs", () => {
  const finished: BackupRun = run({
    status: "done",
    locked: false,
    finishedAt: "2026-11-08T10:00:19.000Z",
    stats: {
      tablesDone: 2,
      tablesTotal: 2,
      rows: 15,
      mediaDone: 5,
      mediaTotal: 5,
      mediaBytes: 2048,
      mediaSkipped: 1,
      mediaMissing: 2,
    },
    warnings: ["media/ab/abc is missing"],
  });

  it("lists past runs with their warnings and missing files", async () => {
    answers["/admin/backup/runs"] = () => ({ ok: true, runs: [finished] });
    render(screenWith());
    expect(await screen.findByText("media/ab/abc is missing")).toBeTruthy();
    expect(screen.getByText(/2 media files were missing/)).toBeTruthy();
    expect(screen.getByText(/1 already there/)).toBeTruthy();
  });

  it("draws a running row's progress on a track that shows against the row", async () => {
    answers["/admin/backup/runs"] = () => ({
      ok: true,
      runs: [
        run({
          stats: {
            tablesDone: 1,
            tablesTotal: 2,
            rows: 1,
            mediaDone: 1,
            mediaTotal: 2,
            mediaBytes: 1,
            mediaSkipped: 0,
            mediaMissing: 0,
          },
        }),
      ],
    });
    render(screenWith());
    await waitFor(() => expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0));
    const row = screen.getAllByRole("listitem").find((li) => li.className.includes("bg-muted"))!;
    for (const bar of row.querySelectorAll('[role="progressbar"]')) {
      expect(bar.className).toContain("bg-background");
      expect(bar.className).not.toContain("bg-muted");
    }
  });

  it("picks up a run already going when the page opens, and blocks a second", async () => {
    const active = run({ status: "running" });
    answers["/admin/backup/runs"] = () => ({ ok: true, runs: [active] });
    render(screenWith());
    expect(await screen.findByText("Current run")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start backup" }).hasAttribute("disabled")).toBe(
        true,
      ),
    );
  });

  it("stops expecting the backup's key when the followed restore fails", async () => {
    select({ ...ALPHA, expecting: { key: DID, until: "2999-01-01T00:00:00.000Z" } });
    const failed = run({ kind: "restore", status: "failed", error: "the bucket went away" });
    answers["/admin/restore/start"] = () => ({ ok: true, run: run({ kind: "restore" }) });
    const user = userEvent.setup();
    render(screenWith());
    await inspect(user);
    answers["/admin/backup/runs"] = () => ({ ok: true, runs: [failed] });
    await user.click(await screen.findByRole("button", { name: "Start restore" }));
    await user.click(await screen.findByRole("button", { name: "Restore server" }));
    await waitFor(() => expect(registry.expectKey).toHaveBeenCalledWith(ALPHA.origin, undefined));
  });

  describe("a page opened just after a restore", () => {
    const finishedAgo = (ms: number) =>
      run({
        kind: "restore",
        status: "done",
        startedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
        finishedAt: new Date(Date.now() - ms).toISOString(),
      });

    it("still shows the restart", async () => {
      answers["/admin/backup/runs"] = () => ({ ok: true, runs: [finishedAgo(60_000)] });
      render(screenWith());
      expect(await screen.findByText(/Alpha is restarting/)).toBeTruthy();
    });

    it("still points at Unlock once the server is back", async () => {
      writeLocked = true;
      bootedAt = new Date().toISOString();
      answers["/admin/backup/runs"] = () => ({ ok: true, runs: [finishedAgo(60_000)] });
      render(screenWith());
      expect((await screen.findByRole("status")).textContent).toContain("use Unlock");
    });

    it("leaves an old restore in the history", async () => {
      answers["/admin/backup/runs"] = () => ({ ok: true, runs: [finishedAgo(60 * 60_000)] });
      render(screenWith());
      await waitFor(() => expect(listReads().length).toBe(1));
      // The Restore card's title and the row in the history.
      await waitFor(() => expect(screen.getAllByText("Restore").length).toBe(2));
      expect(screen.queryByText("Current run")).toBeNull();
    });
  });

  describe("refreshing the list", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

    it("notices a run started from another tab", async () => {
      render(screenWith());
      await advance(0);
      expect(screen.queryByText("Current run")).toBeNull();

      answers["/admin/backup/runs"] = () => ({ ok: true, runs: [run()] });
      await advance(RUNS_REFRESH_MS);
      expect(screen.getByText("Current run")).toBeTruthy();
    });

    it("stops while a run is followed", async () => {
      answers["/admin/backup/runs"] = () => ({ ok: true, runs: [run()] });
      render(screenWith());
      await advance(0);
      expect(screen.getByText("Current run")).toBeTruthy();
      const reads = listReads().length;
      await advance(RUNS_REFRESH_MS * 3);
      expect(listReads().length).toBe(reads);
    });
  });

  it("says when the server has no backup ops", async () => {
    answers["/admin/backup/runs"] = () => {
      throw new ApiError(404, "no route");
    };
    render(screenWith());
    expect(await screen.findByText(/may need updating/)).toBeTruthy();
  });
});
