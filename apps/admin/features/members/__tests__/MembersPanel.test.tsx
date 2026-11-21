import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { savedServer, WALLET } from "@/features/servers/__tests__/fixtures";

/*
 * The Members screen as an operator meets it: a request shows the requester's profile and note, and
 * approving one signs `admin.access.add` and refreshes the list. The signed calls, the status and
 * the profile read are stubbed; SWR and the gate run for real.
 */

const api = vi.hoisted(() => ({
  fetch: vi.fn(),
  add: vi.fn(),
  decline: vi.fn(),
  remove: vi.fn(),
  admitAll: vi.fn(),
}));
const status = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const servers = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("../api", () => ({
  accessFetch: api.fetch,
  accessAdd: api.add,
  accessDecline: api.decline,
  accessRemove: api.remove,
  accessAdmitAll: api.admitAll,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/servers/ServersProvider", () => ({
  ServersProvider: () => null,
  useServers: () => servers.value,
}));
vi.mock("@/features/servers/useAdminStatus", async (original) => ({
  ...(await original<typeof import("@/features/servers/useAdminStatus")>()),
  useAdminStatus: () => status.value,
}));
vi.mock("@/features/wallet", () => ({
  useWallet: () => ({ status: "unlocked", wallet: WALLET }),
}));
vi.mock("@/features/media/useProfile", () => ({
  useProfile: () => ({ data: { displayName: "Ana", avatar: "emoji:🦊", handles: ["@ana"] } }),
}));

const { MembersPanel } = await import("../MembersPanel");

const SERVER = savedServer("https://alpha.example", { capabilities: ["access:members"] });
const ANA = "did:key:z6MkAna";

function renderPanel(): void {
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MembersPanel />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  servers.value = {
    servers: [SERVER],
    activeServer: SERVER,
    targets: [SERVER],
    identityChanged: [],
    checking: [],
  };
  status.value = {
    data: {
      accessLevel: "request",
      capabilities: ["access:members"],
      counts: { accessPending: 1 },
    },
    mutate: vi.fn(),
  };
  api.fetch.mockResolvedValue([
    {
      did: ANA,
      status: "pending",
      note: "it's Ana from the park",
      requestedAt: "2026-11-15T00:00:00Z",
    },
  ]);
});

describe("MembersPanel", () => {
  it("shows a request with the requester's profile and note, and approves it", async () => {
    renderPanel();
    expect(await screen.findByText("Ana")).toBeTruthy();
    expect(screen.getByText("@ana")).toBeTruthy();
    // The avatar is drawn as its emoji, without the scheme it is published with.
    expect(screen.getByText("🦊")).toBeTruthy();
    expect(screen.queryByText(/emoji:/)).toBeNull();
    expect(screen.getByText("it's Ana from the park")).toBeTruthy();

    api.add.mockResolvedValue({ did: ANA, status: "member" });
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.add).toHaveBeenCalledWith(SERVER.origin, WALLET, ANA));
    // The list is read again, so the approved request moves to Members.
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
  });

  it("refuses a server that does not keep a member list, without asking it", async () => {
    const old = savedServer("https://old.example");
    servers.value = { ...servers.value, servers: [old], activeServer: old, targets: [old] };
    renderPanel();
    expect(
      await screen.findByText(/does not advertise the access:members capability/),
    ).toBeTruthy();
    expect(api.fetch).not.toHaveBeenCalled();
  });
});
