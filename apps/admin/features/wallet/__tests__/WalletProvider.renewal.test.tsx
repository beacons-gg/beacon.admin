/**
 * A wallet session that ran out (the vault's 7 days): a server refuses a signed request with
 * `badsig`, the provider opens the unlock dialog, and once the operator unlocks, the waiting requests
 * go out again under the new session. The expired wallet stays in place until then, so the screens
 * behind the dialog keep their state. Closing the dialog locks the wallet and fails the requests.
 */
import type { Wallet } from "@beaconsgg/identity";
import { act, fireEvent, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionRenewalDialog } from "@/features/onboarding/SessionRenewalDialog";
import { BADSIG, DAY, SESSION_MS, sessionWallet } from "@/lib/__tests__/sessionFixtures";
import { SessionEnded, withSession } from "@/lib/session";
import { useWallet, WalletProvider } from "../WalletProvider";

const OTHER = "legal winner thank year wave sausage worth useful legal winner thank yellow";

/** What the next `unlock` and `importPhrase` return. */
const vault = vi.hoisted(() => ({ next: [] as Wallet[] }));
vi.mock("../vault", () => ({
  operatorVault: {
    hasSaved: () => Promise.resolve(true),
    unlock: vi.fn(() => Promise.resolve(vault.next.shift())),
    importPhrase: vi.fn(() => Promise.resolve(vault.next.shift())),
    forget: vi.fn(() => Promise.resolve()),
  },
}));

/** A signed call that the server refuses for the expired session and accepts from any other. */
function call(expired: Wallet) {
  return vi.fn((wallet: Wallet) =>
    wallet === expired ? Promise.reject(BADSIG) : Promise.resolve(wallet.device.did),
  );
}

/** The provider, with the shell's renewal dialog mounted beside the hook. */
const wrapper = ({ children }: { children: ReactNode }) => (
  <WalletProvider>
    {children}
    <SessionRenewalDialog />
  </WalletProvider>
);

/** The provider, unlocked with a session that has already run out. */
async function unlockedExpired() {
  const expired = sessionWallet(-DAY);
  vault.next = [expired];
  const hook = renderHook(() => useWallet(), { wrapper });
  await act(async () => {
    await hook.result.current.unlock("pw");
  });
  return { ...hook, expired };
}

/**
 * Start `withSession(expired, refused)` and let its refusal reach the provider. The outcome comes in
 * an object, so awaiting this does not wait for the renewal too.
 */
async function refuse<T>(expired: Wallet, refused: (wallet: Wallet) => Promise<T>) {
  let outcome: Promise<T | unknown> = Promise.resolve();
  await act(async () => {
    outcome = withSession(expired, refused).catch((err: unknown) => err);
    await Promise.resolve();
  });
  return { outcome };
}

beforeEach(() => {
  vault.next = [];
});
afterEach(() => vi.clearAllMocks());

describe("a wallet session that ran out", () => {
  it("asks once for several refused requests, and sends each again", async () => {
    const { result, expired } = await unlockedExpired();
    const first = call(expired);
    const second = call(expired);
    const outcomes = Promise.all([
      (await refuse(expired, first)).outcome,
      (await refuse(expired, second)).outcome,
    ]);
    // Still unlocked with the expired wallet, so a gated screen stays mounted behind the dialog.
    expect(result.current).toMatchObject({ status: "unlocked", renewing: true, wallet: expired });

    const fresh = sessionWallet(SESSION_MS);
    vault.next = [fresh];
    await act(async () => {
      await result.current.unlock("pw");
    });
    await expect(outcomes).resolves.toEqual([fresh.device.did, fresh.device.did]);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ status: "unlocked", renewing: false, wallet: fresh });
  });

  it("locks the wallet and fails the waiting requests when the operator closes the dialog", async () => {
    const { result, expired } = await unlockedExpired();
    const { outcome } = await refuse(expired, call(expired));
    act(() => result.current.cancelRenewal());
    await expect(outcome).resolves.toBeInstanceOf(SessionEnded);
    expect(result.current).toMatchObject({ status: "locked", renewing: false, wallet: undefined });
    // A request refused after that does not ask again.
    await expect(withSession(expired, call(expired))).rejects.toBeInstanceOf(SessionEnded);
    expect(result.current.renewing).toBe(false);
  });

  it("fails the waiting requests when the provider goes away", async () => {
    const { unmount, expired } = await unlockedExpired();
    const { outcome } = await refuse(expired, call(expired));
    unmount();
    await expect(outcome).resolves.toBeInstanceOf(SessionEnded);
  });

  it("does not send a request signed for one account as another", async () => {
    const { result, expired } = await unlockedExpired();
    const refused = call(expired);
    const { outcome } = await refuse(expired, refused);
    vault.next = [sessionWallet(SESSION_MS, OTHER)];
    await act(async () => {
      await result.current.importPhrase(OTHER, "pw");
    });
    await expect(outcome).resolves.toBeInstanceOf(SessionEnded);
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("sends a late refusal under the session already renewed, without asking again", async () => {
    const { result, expired } = await unlockedExpired();
    await refuse(expired, call(expired));
    const fresh = sessionWallet(SESSION_MS);
    vault.next = [fresh];
    await act(async () => {
      await result.current.unlock("pw");
    });

    await expect(withSession(expired, call(expired))).resolves.toBe(fresh.device.did);
    expect(result.current.renewing).toBe(false);
  });
});

describe("the renewal dialog", () => {
  it("asks only for the passphrase, and the refused request goes out once it is given", async () => {
    const { expired } = await unlockedExpired();
    expect(screen.queryByText("Wallet session ended")).toBeNull();

    const { outcome } = await refuse(expired, call(expired));
    expect(screen.getByText("Wallet session ended")).toBeTruthy();
    expect(screen.queryByLabelText("Or import a recovery phrase")).toBeNull();
    expect(screen.queryByText(/Forget the saved wallet/)).toBeNull();

    const fresh = sessionWallet(SESSION_MS);
    vault.next = [fresh];
    fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: "pw" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    });
    await expect(outcome).resolves.toBe(fresh.device.did);
    expect(screen.queryByText("Wallet session ended")).toBeNull();
  });
});
