import { createWallet } from "@beaconsgg/identity";
import { opEnvelopeSchema } from "@beaconsgg/protocol-types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savedServer } from "@/features/servers/__tests__/fixtures";
import { directoryReplies, HOSTED, NONCE } from "./fixtures";

/*
 * The card as an operator meets it on the settings screen. Only `fetch` and the wallet's role are
 * stubbed: the directory calls, the signing and SWR run for real, so the requests asserted here are
 * the ones a directory would get.
 */

const role = vi.hoisted(() => ({ value: "admin" as string }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast }));
vi.mock("@/features/servers/roles", () => ({
  ServerRolesProvider: () => null,
  useServerRoles: () => ({
    roleOf: () => role.value,
    mayAdmin: () => role.value !== "notAdmin",
    notAdmin: [],
  }),
}));

const { DirectoryCard } = await import("..");

const SERVER = savedServer("https://alpha.example", { host: "Alpha.Example" });
const WALLET = createWallet();
const BASE = "https://beacons.gg/api/v1/servers/alpha.example";
const CHALLENGE: [unknown, number] = [
  { ok: true, nonce: NONCE, expiresAt: "2026-11-17T12:10:00.000Z" },
  201,
];

function renderCard(): void {
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <DirectoryCard server={SERVER} wallet={WALLET} />
    </SWRConfig>,
  );
}

/** Open the dialog from the card and confirm it, returning the dialog's title. */
async function confirmRemoval(): Promise<string> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Remove listing" }));
  const title = (await screen.findByRole("alertdialog")).querySelector("h2")?.textContent ?? "";
  await user.click(screen.getByRole("button", { name: "Remove listing" }));
  return title;
}

beforeEach(() => {
  vi.clearAllMocks();
  role.value = "admin";
  window.localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("who sees the card", () => {
  it.each(["notAdmin", "unknown"])("shows nothing and asks nothing when the role is %s", (r) => {
    role.value = r;
    const sent = directoryReplies([]);
    renderCard();
    expect(screen.queryByText("Server directory")).toBeNull();
    expect(sent()).toHaveLength(0);
  });
});

describe("the listing", () => {
  it("says the server is listed, with a link to its page", async () => {
    directoryReplies([[{ ok: true }, 200]]);
    renderCard();
    expect(await screen.findByText("listed")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open the listing on beacons.gg" });
    expect(link.getAttribute("href")).toBe("https://beacons.gg/servers/alpha.example");
  });

  it("says the server is not listed", async () => {
    directoryReplies([[{ ok: false, error: "notFound" }, 404]]);
    renderCard();
    expect(await screen.findByText("not listed")).toBeTruthy();
  });

  it("says the directory could not be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    renderCard();
    expect(await screen.findByText("unreachable")).toBeTruthy();
    expect(screen.getByText(/could not reach the directory at beacons\.gg/)).toBeTruthy();
  });

  it("asks the directory this browser saved", async () => {
    window.localStorage.setItem("beacon-admin.directory", JSON.stringify("https://dir.example"));
    const sent = directoryReplies([[{ ok: true }, 200]]);
    renderCard();
    await screen.findByText("listed");
    expect(sent()[0]?.url).toBe("https://dir.example/api/v1/servers/alpha.example");
  });

  it("changes the directory and remembers it in this browser", async () => {
    const user = userEvent.setup();
    const sent = directoryReplies([
      [{ ok: true }, 200],
      [{ ok: false, error: "notFound" }, 404],
    ]);
    renderCard();
    await screen.findByText("listed");

    await user.click(screen.getByRole("button", { name: "Change directory" }));
    const field = screen.getByLabelText("Directory address");
    await user.clear(field);
    await user.type(field, "not an address");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/starts with https:\/\//)).toBeTruthy();

    await user.clear(field);
    await user.type(field, "https://dir.example/");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("not listed")).toBeTruthy();
    expect(sent()[1]?.url).toBe("https://dir.example/api/v1/servers/alpha.example");
    expect(window.localStorage.getItem("beacon-admin.directory")).toBe('"https://dir.example"');
  });
});

describe("Remove listing", () => {
  it("confirms naming the server, then challenges, signs with the nonce and removes", async () => {
    const sent = directoryReplies([
      [{ ok: true }, 200],
      CHALLENGE,
      [{ ok: true, removed: true }, 200],
      [{ ok: false, error: "notFound" }, 404],
    ]);
    renderCard();
    await screen.findByText("listed");

    const title = await confirmRemoval();
    expect(title).toBe("Remove alpha.example from the directory on beacons.gg?");

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "alpha.example is no longer listed on beacons.gg.",
      ),
    );
    expect(await screen.findByText("not listed")).toBeTruthy();

    const [, challenge, remove] = sent();
    expect(challenge).toMatchObject({ url: `${BASE}/challenge`, method: "POST" });
    expect(remove).toMatchObject({ url: `${BASE}/remove`, method: "POST" });
    const env = opEnvelopeSchema.parse((remove?.body as { envelope: unknown }).envelope);
    expect([env.op, env.nonce, env.params]).toEqual(["admin.status", NONCE, {}]);
  });

  it("shows the hosted refusal's message and keeps the listing", async () => {
    const sent = directoryReplies([
      [{ ok: true }, 200],
      [HOSTED, 409],
    ]);
    renderCard();
    await screen.findByText("listed");
    await confirmRemoval();

    expect(await screen.findByText(HOSTED.message)).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
    expect(sent().some((r) => r.url.endsWith("/remove"))).toBe(false);
  });

  it("shows the denial in words", async () => {
    const message = "The server says this identity is not one of its admins.";
    directoryReplies([
      [{ ok: true }, 200],
      CHALLENGE,
      [{ ok: false, error: "denied", message }, 403],
    ]);
    renderCard();
    await screen.findByText("listed");
    await confirmRemoval();
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("says when the directory can't be reached to remove the listing", async () => {
    directoryReplies([[{ ok: true }, 200]]);
    renderCard();
    await screen.findByText("listed");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await confirmRemoval();
    expect(
      (await screen.findAllByText(/could not reach the directory at beacons\.gg/)).length,
    ).toBeGreaterThan(0);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
