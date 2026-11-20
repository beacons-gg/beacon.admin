/**
 * `WalletProvider`'s "is a wallet saved?" answer. It reads storage after mount, asynchronously, so an
 * operator can create or forget a wallet before that read lands. The operator's action decides; a
 * late read must not overwrite it.
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { WalletProvider, useWallet } from "../WalletProvider";

let resolveSaved: (has: boolean) => void = () => {};
vi.mock("../vault", () => ({
  operatorVault: {
    hasSaved: () => new Promise<boolean>((resolve) => (resolveSaved = resolve)),
    create: vi.fn(async () => ({ mnemonic: "m", wallet: { account: { did: "did:key:zOp" } } })),
    importPhrase: vi.fn(async () => ({ account: { did: "did:key:zOp" } })),
    forget: vi.fn(async () => undefined),
  },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <WalletProvider>{children}</WalletProvider>
);

describe("WalletProvider's saved answer", () => {
  it("takes the stored answer when nothing happened first", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    await act(async () => resolveSaved(true));
    expect(result.current.status).toBe("locked");
  });

  it("keeps a create that finished before the mount-time read landed", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    await act(async () => {
      await result.current.create("pw");
    });
    act(() => result.current.lock());
    await act(async () => resolveSaved(false)); // the stale read: nothing was saved at mount
    expect(result.current.status).toBe("locked");
  });

  it("keeps an import that finished before it landed", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    await act(async () => {
      await result.current.importPhrase("a phrase", "pw");
    });
    act(() => result.current.lock());
    await act(async () => resolveSaved(false));
    expect(result.current.status).toBe("locked");
  });

  it("keeps a forget that happened before it landed", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    act(() => result.current.forget());
    await act(async () => resolveSaved(true));
    expect(result.current.status).toBe("none");
  });
});
