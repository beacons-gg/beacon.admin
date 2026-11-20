/**
 * The operator profile and the identity of each saved server. The profile is read from and
 * published to only the servers checked this session under their pinned key. The prefill waits for
 * the first of them, and a check landing while the dialog is open doesn't refetch over what the
 * operator typed.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { savedServer, WALLET } from "@/features/servers/__tests__/fixtures";
import { ProfileDialog } from "../ProfileDialog";

const A = savedServer("https://a.example");
const B = savedServer("https://b.example");
const C = savedServer("https://c.example");

const known = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const api = vi.hoisted(() => ({
  loadOperatorFace: vi.fn(),
  publishOperatorProfile: vi.fn(),
}));

vi.mock("@/features/servers", () => ({
  useServers: () => known.value,
  useAnyServer: () => ({ ok: true, wallet: WALLET }),
  trustRefusal: (s: { origin: string }, k: { identityChanged: string[]; checking: string[] }) =>
    k.identityChanged.includes(s.origin) || k.checking.includes(s.origin) ? "untrusted" : undefined,
}));
vi.mock("@/features/wallet", () => ({ useWallet: () => ({ wallet: WALLET }) }));
vi.mock("@/features/wallet/profileApi", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function fleet(servers: unknown[], identityChanged: string[], checking: string[]) {
  known.value = { servers, identityChanged, checking };
}

const dialog = () => <ProfileDialog open onOpenChange={() => {}} />;

beforeEach(() => {
  api.loadOperatorFace.mockReset().mockResolvedValue({ displayName: "North", avatarEmoji: "" });
  api.publishOperatorProfile.mockReset().mockResolvedValue([]);
});

describe("ProfileDialog's servers", () => {
  it("reads from and publishes to only the servers checked under their pinned key", async () => {
    fleet([A, B, C], [A.origin], [C.origin]);
    await act(async () => {
      render(dialog());
    });
    expect(api.loadOperatorFace).toHaveBeenCalledWith([B.origin], WALLET.account.did);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    });
    expect(api.publishOperatorProfile.mock.calls[0]?.[0]).toEqual([B.origin]);
  });

  it("waits for the first check, then keeps what the operator typed as later ones land", async () => {
    fleet([A, B], [], [A.origin, B.origin]);
    const { rerender } = render(dialog());
    expect(api.loadOperatorFace).not.toHaveBeenCalled();
    expect(screen.getByText(/Waiting for a saved server's identity/)).toBeTruthy();

    fleet([A, B], [], [B.origin]);
    await act(async () => {
      rerender(dialog());
    });
    expect(api.loadOperatorFace).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByPlaceholderText("North Control"), { target: { value: "Typed" } });

    fleet([{ ...A }, B], [], []); // B's check lands, and A's row was refreshed
    await act(async () => {
      rerender(dialog());
    });
    expect(api.loadOperatorFace).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("Typed")).toBeTruthy();
  });

  it("refuses to publish when every saved server changed its key, and says how to fix it", async () => {
    fleet([A, B], [A.origin, B.origin], []);
    await act(async () => {
      render(dialog());
    });
    expect(screen.getByText(/Every saved server now signs with a different key/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
