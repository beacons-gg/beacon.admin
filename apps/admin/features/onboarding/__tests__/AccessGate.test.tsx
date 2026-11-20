/**
 * The console's front door: nothing behind it shows without an unlocked wallet, a browser with no
 * wallet gets the welcome, and the welcome stays up through the unlock it causes until it is done.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccessGate } from "../AccessGate";

const w = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/features/wallet", () => ({
  useWallet: () => w.value,
  describeWalletError: (e: unknown) => String(e),
}));
vi.mock("../Welcome", () => ({
  Welcome: ({ onDone }: { onDone: () => void }) => (
    <button type="button" onClick={onDone}>
      welcome
    </button>
  ),
}));
vi.mock("../UnlockScreen", () => ({ UnlockScreen: () => <p>unlock screen</p> }));

const console = <p>the console</p>;

describe("AccessGate", () => {
  it("shows nothing until the browser's storage has been read", () => {
    w.value = { ready: false, status: "none" };
    render(<AccessGate>{console}</AccessGate>);
    expect(screen.queryByText("the console")).toBeNull();
    expect(screen.queryByText("welcome")).toBeNull();
    expect(screen.queryByText("unlock screen")).toBeNull();
  });

  it("greets a browser with no wallet with the welcome", () => {
    w.value = { ready: true, status: "none" };
    render(<AccessGate>{console}</AccessGate>);
    expect(screen.getByText("welcome")).toBeTruthy();
    expect(screen.queryByText("the console")).toBeNull();
  });

  it("asks a locked wallet for its passphrase, and shows nothing else", () => {
    w.value = { ready: true, status: "locked" };
    render(<AccessGate>{console}</AccessGate>);
    expect(screen.getByText("unlock screen")).toBeTruthy();
    expect(screen.queryByText("the console")).toBeNull();
  });

  it("opens the console for an unlocked wallet", () => {
    w.value = { ready: true, status: "unlocked" };
    render(<AccessGate>{console}</AccessGate>);
    expect(screen.getByText("the console")).toBeTruthy();
  });

  it("keeps the welcome up through the unlock it causes, until the operator finishes", () => {
    w.value = { ready: true, status: "none" };
    const { rerender } = render(<AccessGate>{console}</AccessGate>);
    w.value = { ready: true, status: "unlocked" }; // the identity was just created
    rerender(<AccessGate>{console}</AccessGate>);
    expect(screen.getByText("welcome")).toBeTruthy();
    fireEvent.click(screen.getByText("welcome"));
    expect(screen.getByText("the console")).toBeTruthy();
  });
});
