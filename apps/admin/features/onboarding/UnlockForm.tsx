"use client";

import { useState } from "react";
import { LockKeyholeOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeWalletError, useWallet } from "@/features/wallet";

/**
 * The passphrase form that unlocks the saved wallet: the unlock screen's, and the renewal dialog's
 * when a session runs out. A wrong passphrase says so and keeps what was typed.
 */
export function UnlockForm({ id, large = false }: { id: string; large?: boolean }) {
  const w = useWallet();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const unlock = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await w.unlock(passphrase);
      setPassphrase("");
    } catch (err) {
      setError(describeWalletError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (passphrase && !busy) void unlock();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={id}>Passphrase</Label>
        <Input
          id={id}
          type="password"
          autoComplete="current-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoFocus
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size={large ? "lg" : "default"} disabled={!passphrase || busy}>
        <LockKeyholeOpenIcon className="size-4" />
        {busy ? "Unlocking…" : "Unlock"}
      </Button>
    </form>
  );
}
