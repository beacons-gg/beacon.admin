/**
 * A signed call whose wallet session ran out: a server refuses it with `badsig`, the console asks for
 * the passphrase (the renewer `WalletProvider` registers), and sends the request once more under the
 * new session. Every console client renews: the console's own strict calls and a plugin's
 * game-facing ones, which return the refusal rather than throw it.
 */
import { createWallet, type Wallet } from "@beaconsgg/identity";
import { opEnvelopeSchema } from "@beaconsgg/protocol-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, clientFor, signedPost } from "../api";
import { SessionEnded, sessionExpired, setSessionRenewer } from "../session";
import { stubReplies } from "./fetchStub";
import { BADSIG, BADSIG_BODY, DAY, SESSION_MS, sessionWallet } from "./sessionFixtures";

const expiredWallet = () => sessionWallet(-DAY);
const liveWallet = () => sessionWallet(SESSION_MS - DAY);

/** The device each request was signed by. */
const devices = (sent: () => { body: unknown }[]) =>
  sent().map(({ body }) => opEnvelopeSchema.parse(body).device);

let unregister: (() => void) | undefined;
/** Register a renewer for the test, recording what it was asked. */
function renewWith(answer: (expired: Wallet) => Promise<Wallet>) {
  const renew = vi.fn(answer);
  unregister = setSessionRenewer(renew);
  return renew;
}

afterEach(() => {
  unregister?.();
  unregister = undefined;
  vi.unstubAllGlobals();
});

const post = (wallet: Wallet) =>
  signedPost<{ ok: true }>("https://s.example", "/admin/status", wallet, "admin.status", {});

describe("sessionExpired", () => {
  it("reads a badsig after the session's expiry as the session ending", () => {
    expect(sessionExpired(expiredWallet(), BADSIG)).toBe(true);
    expect(sessionExpired(expiredWallet(), BADSIG_BODY)).toBe(true);
  });

  it("allows for a server clock a little ahead of this one", () => {
    expect(sessionExpired(sessionWallet(60_000), BADSIG)).toBe(true);
  });

  it("leaves a badsig well inside the session, another code, or a wallet with no expiry alone", () => {
    expect(sessionExpired(liveWallet(), BADSIG)).toBe(false);
    expect(sessionExpired(expiredWallet(), new ApiError(403, "denied", "denied"))).toBe(false);
    expect(sessionExpired(expiredWallet(), { ok: true })).toBe(false);
    expect(sessionExpired(expiredWallet(), new Error("network"))).toBe(false);
    expect(sessionExpired(createWallet(), BADSIG)).toBe(false);
  });
});

describe("a signed request after the session ran out", () => {
  it("asks for the passphrase and sends the request once more, signed by the new session", async () => {
    const expired = expiredWallet();
    const fresh = liveWallet();
    const sent = stubReplies([[BADSIG_BODY, 401]]);
    const renew = renewWith(() => Promise.resolve(fresh));

    await expect(post(expired)).resolves.toEqual({ ok: true });
    expect(renew).toHaveBeenCalledTimes(1);
    expect(renew).toHaveBeenCalledWith(expired);
    expect(devices(sent)).toEqual([expired.device.did, fresh.device.did]);
  });

  it("does the same for a plugin's game-facing write, whose refusal is its answer", async () => {
    const expired = expiredWallet();
    const fresh = liveWallet();
    const sent = stubReplies([[BADSIG_BODY, 401]]);
    renewWith(() => Promise.resolve(fresh));

    const intent = { op: "x", params: {} };
    await expect(
      clientFor("game-a").postSigned("https://s.example", "/rooms", expired, intent),
    ).resolves.toEqual({ ok: true });
    expect(devices(sent)).toEqual([expired.device.did, fresh.device.did]);
  });

  it("leaves a call that takes no wallet, or answers at once, as it is", () => {
    renewWith(() => Promise.reject(new Error("never asked")));
    const wallet = expiredWallet();
    const env = clientFor("game-a").sign(wallet, { op: "x", params: {} });
    expect(env.device).toBe(wallet.device.did);
  });

  it("sends the request again only once", async () => {
    const sent = stubReplies([
      [BADSIG_BODY, 401],
      [BADSIG_BODY, 401],
    ]);
    renewWith(() => Promise.resolve(expiredWallet()));
    await expect(post(expiredWallet())).rejects.toMatchObject({ status: 401, code: "badsig" });
    expect(sent()).toHaveLength(2);
  });

  it("fails as the operator chose when the unlock is closed instead", async () => {
    const sent = stubReplies([[BADSIG_BODY, 401]]);
    renewWith(() => Promise.reject(new SessionEnded()));
    await expect(post(expiredWallet())).rejects.toBeInstanceOf(SessionEnded);
    expect(sent()).toHaveLength(1);
  });

  it("does not ask while the session is still good: that badsig is the server's answer", async () => {
    stubReplies([[BADSIG_BODY, 401]]);
    const renew = renewWith(() => Promise.resolve(liveWallet()));
    await expect(post(liveWallet())).rejects.toMatchObject({ code: "badsig" });
    expect(renew).not.toHaveBeenCalled();
  });

  it("passes the refusal on when nothing can ask", async () => {
    stubReplies([[BADSIG_BODY, 401]]);
    await expect(post(expiredWallet())).rejects.toMatchObject({ code: "badsig" });
  });
});
