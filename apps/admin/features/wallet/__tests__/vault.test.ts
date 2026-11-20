/**
 * The console's vault binding: the SDK's passphrase vault over this browser's storage, under the
 * key the console has always used. The vault itself is tested in `@beaconsgg/client-sdk`; this holds
 * that a wallet an operator saved before the SDK still unlocks.
 */
import { VAULT_SESSION_TTL_SEC, WrongPassphraseError } from "@beaconsgg/client-sdk";
import { walletFromMnemonic } from "@beaconsgg/identity";
import { afterEach, describe, expect, it } from "vitest";
import { describeWalletError, operatorVault, WRONG_PASSPHRASE } from "../vault";

const PHRASE = "test test test test test test test test test test test junk";
const KEY = "beacon-admin.wallet";

/**
 * An envelope made by the console's own `crypto.ts` before the SDK (PHRASE under "pw"), frozen here
 * so a change to the format on both sides at once still fails this test.
 */
const LEGACY =
  '{"v":1,"salt":"q1Q2EDRM+2PBQQQYfoZ4+A==","iv":"HQmtFVbyByuX/diJ","data":"OXqatYb8HTEtzKvEpK4UNijUuGThkOcyLz3UhbDG2eXjavYw8W0SgJtOip5hKAVR54vHeHPWpKDyxqtK6bZfggVZnPr98YxePQXi","iterations":210000}';

afterEach(() => window.localStorage.clear());

describe("the operator vault", () => {
  it("unlocks an envelope the console saved before the SDK", async () => {
    window.localStorage.setItem(KEY, LEGACY);
    await expect(operatorVault.hasSaved()).resolves.toBe(true);
    const wallet = await operatorVault.unlock("pw");
    expect(wallet.account.did).toBe(walletFromMnemonic(PHRASE).account.did);
  });

  /* The renewal dialog tells the operator an unlock lasts 7 days. */
  it("unlocks a session that ends, after 7 days", async () => {
    await operatorVault.importPhrase(PHRASE, "pw");
    const { auth } = await operatorVault.unlock("pw");
    expect(auth.expires).toBeDefined();
    expect(VAULT_SESSION_TTL_SEC).toBe(7 * 24 * 60 * 60);
  });

  it("words a wrong passphrase for the wallet dialog", async () => {
    await operatorVault.importPhrase(PHRASE, "pw");
    const err = await operatorVault.unlock("not pw").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WrongPassphraseError);
    expect(describeWalletError(err)).toBe(WRONG_PASSPHRASE);
    expect(describeWalletError(new Error("storage full"))).toBe("storage full");
  });

  it("saves under that key, and forgets it", async () => {
    await operatorVault.importPhrase(PHRASE, "pw");
    expect(window.localStorage.getItem(KEY)).toContain('"v":1');
    await operatorVault.forget();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    await expect(operatorVault.hasSaved()).resolves.toBe(false);
  });
});
