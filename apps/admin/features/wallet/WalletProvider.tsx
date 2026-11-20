"use client";

import type { Wallet } from "@beaconsgg/identity";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { SessionEnded, setSessionRenewer } from "@/lib/session";
import { operatorVault } from "./vault";

/** `none` = no wallet saved; `locked` = envelope present, session not unlocked. */
export type WalletStatus = "none" | "locked" | "unlocked";

export interface WalletContextValue {
  status: WalletStatus;
  /**
   * Whether `status` is known yet. The saved wallet is read from browser storage after mount, so
   * until then `status` says `none` for a browser that has one; a screen that would greet a new
   * operator waits for this.
   */
  ready: boolean;
  /** The session wallet — present only while unlocked. */
  wallet: Wallet | undefined;
  /**
   * A server refused a signed request because the wallet session ran out (`lib/session.ts`), and the
   * request waits for the operator to unlock again. The expired wallet stays in place meanwhile, so
   * the screens behind the dialog keep their state and see the request's outcome.
   */
  renewing: boolean;
  /** Give up on the renewal: the wallet locks, and the waiting requests fail with `SessionEnded`. */
  cancelRenewal(): void;
  /** Create a fresh identity; returns the mnemonic ONCE for the operator to back up. */
  create(passphrase: string): Promise<string>;
  /** Import an existing recovery phrase. */
  importPhrase(mnemonic: string, passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<void>;
  lock(): void;
  /** Forget the saved wallet entirely (the encrypted envelope is removed). */
  forget(): void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

/** The requests waiting for the operator to unlock a session that ran out. */
interface Renewal {
  account: string;
  promise: Promise<Wallet>;
  resolve(wallet: Wallet): void;
  reject(err: Error): void;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWalletState] = useState<Wallet | undefined>(undefined);
  // The wallet as of now, for the renewer, which runs outside a render.
  const current = useRef<Wallet | undefined>(undefined);
  const setWallet = (next: Wallet | undefined) => {
    current.current = next;
    setWalletState(next);
  };
  const renewal = useRef<Renewal | undefined>(undefined);
  const [renewing, setRenewing] = useState(false);
  /** Settle the waiting requests, if any: with the new session's wallet, or with an error. */
  const endRenewal = (outcome: Wallet | Error) => {
    const pending = renewal.current;
    if (!pending) return;
    renewal.current = undefined;
    setRenewing(false);
    if (outcome instanceof Error) pending.reject(outcome);
    else if (outcome.account.did === pending.account) pending.resolve(outcome);
    // Another account unlocked: the waiting requests were signed for the old one.
    else pending.reject(new SessionEnded());
  };
  /** Take a new session's wallet, which also answers any requests waiting on a renewal. */
  const adopt = (fresh: Wallet) => {
    setWallet(fresh);
    endRenewal(fresh);
  };
  // Whether a wallet is saved in this browser; `undefined` until storage has been read.
  const [saved, setSaved] = useState<boolean | undefined>(undefined);
  // Set once the operator creates, imports or forgets: from then on this session knows the answer,
  // and the mount-time read below must not overwrite it however late it lands.
  const decided = useRef(false);
  const settle = (next: boolean) => {
    decided.current = true;
    setSaved(next);
  };
  // localStorage is browser-only: resolve the saved-envelope state after mount (SSR renders "none").
  useEffect(() => {
    let alive = true;
    void operatorVault
      .hasSaved()
      // A read that failed is not "no wallet": the welcome's create would write over one. The
      // unlock screen says what is wrong and offers to forget the saved wallet.
      .catch(() => true)
      .then((has) => {
        if (alive && !decided.current) setSaved(has);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const unregister = setSessionRenewer((expired) => {
      if (renewal.current) return renewal.current.promise;
      const now = current.current;
      // Another request already brought a new session, or the operator already locked or left.
      if (now !== expired) {
        return now?.account.did === expired.account.did
          ? Promise.resolve(now)
          : Promise.reject(new SessionEnded());
      }
      let resolve: (wallet: Wallet) => void = () => {};
      let reject: (err: Error) => void = () => {};
      const promise = new Promise<Wallet>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      renewal.current = { account: expired.account.did, promise, resolve, reject };
      setRenewing(true);
      return promise;
    });
    return () => {
      unregister();
      // Nothing can answer a renewal any more, so its requests must not wait for one.
      renewal.current?.reject(new SessionEnded());
      renewal.current = undefined;
    };
  }, []);

  const value: WalletContextValue = {
    status: wallet ? "unlocked" : saved ? "locked" : "none",
    ready: saved !== undefined,
    wallet,
    renewing,
    cancelRenewal() {
      if (!renewal.current) return;
      // The session can no longer sign: lock rather than leave it to be refused again.
      setWallet(undefined);
      endRenewal(new SessionEnded());
    },
    async create(passphrase) {
      const { mnemonic, wallet: fresh } = await operatorVault.create(passphrase);
      settle(true);
      adopt(fresh);
      return mnemonic;
    },
    async importPhrase(mnemonic, passphrase) {
      adopt(await operatorVault.importPhrase(mnemonic, passphrase));
      settle(true);
    },
    async unlock(passphrase) {
      adopt(await operatorVault.unlock(passphrase));
    },
    lock() {
      setWallet(undefined);
    },
    forget() {
      void operatorVault.forget();
      setWallet(undefined);
      settle(false);
      endRenewal(new SessionEnded());
    },
  };
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet outside WalletProvider");
  return ctx;
}
