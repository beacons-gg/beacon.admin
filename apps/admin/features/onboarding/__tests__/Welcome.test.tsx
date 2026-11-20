/**
 * The first run, walked end to end: create or restore an identity, back the phrase up, see the DID,
 * and add a first server or skip it.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Welcome } from "../Welcome";

const MNEMONIC =
  "abandon ability able about above absent absorb abstract absurd abuse access accident";
const DID = "did:key:z6MkOperatorWelcome";

const w = vi.hoisted(() => ({
  create: vi.fn(),
  importPhrase: vi.fn(),
  wallet: undefined as unknown,
}));
vi.mock("@/features/wallet", () => ({
  useWallet: () => w,
  describeWalletError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock("@/features/servers", () => ({
  AddServerForm: () => <p>add server form</p>,
  serverLabel: (s: { origin: string }) => s.origin,
  useServers: () => ({ preview: undefined }),
}));
vi.mock("@/components/shell/Mark", () => ({ Mark: () => null }));

async function passphrase(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.type(screen.getByLabelText("Passphrase"), value);
  await user.type(screen.getByLabelText("Confirm the passphrase"), value);
}

describe("Welcome", () => {
  it("creates an identity and walks through the phrase, the DID and a first server", async () => {
    w.create.mockImplementation(async () => {
      w.wallet = { account: { did: DID } };
      return MNEMONIC;
    });
    const done = vi.fn();
    const user = userEvent.setup();
    render(<Welcome onDone={done} />);

    await user.click(screen.getByRole("button", { name: /Create a new identity/ }));
    const submit = screen.getByRole("button", { name: /Create identity/ });
    await passphrase(user, "short");
    expect((submit as HTMLButtonElement).disabled).toBe(true); // under the floor
    await user.clear(screen.getByLabelText("Passphrase"));
    await user.clear(screen.getByLabelText("Confirm the passphrase"));
    await passphrase(user, "a long passphrase");
    await user.click(submit);
    expect(w.create).toHaveBeenCalledWith("a long passphrase");

    expect(await screen.findByText("Save your recovery phrase")).toBeTruthy();
    expect(screen.getByText("accident")).toBeTruthy();
    const next = screen.getByRole("button", { name: /Continue/ });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox"));
    await user.click(next);

    expect(screen.getByText(DID)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Continue/ }));

    expect(screen.getByText("add server form")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(done).toHaveBeenCalled();
  });

  it("restores from a recovery phrase and skips the backup step", async () => {
    w.importPhrase.mockImplementation(async () => {
      w.wallet = { account: { did: DID } };
    });
    const user = userEvent.setup();
    render(<Welcome onDone={() => {}} />);

    await user.click(screen.getByRole("button", { name: /Restore with a recovery phrase/ }));
    await user.type(screen.getByLabelText("Recovery phrase"), `  ${MNEMONIC.toUpperCase()} `);
    await passphrase(user, "a long passphrase");
    await user.click(screen.getByRole("button", { name: /Restore identity/ }));

    expect(w.importPhrase).toHaveBeenCalledWith(MNEMONIC, "a long passphrase");
    expect(await screen.findByText("This is your operator DID")).toBeTruthy();
  });

  it("says why an identity could not be made, and stays on the step", async () => {
    w.importPhrase.mockRejectedValueOnce(new Error("That is not a valid recovery phrase."));
    const user = userEvent.setup();
    render(<Welcome onDone={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Restore with a recovery phrase/ }));
    await user.type(screen.getByLabelText("Recovery phrase"), MNEMONIC);
    await passphrase(user, "a long passphrase");
    await user.click(screen.getByRole("button", { name: /Restore identity/ }));
    expect(await screen.findByText("That is not a valid recovery phrase.")).toBeTruthy();
    expect(screen.getByLabelText("Recovery phrase")).toBeTruthy();
  });
});
