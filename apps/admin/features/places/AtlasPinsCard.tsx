"use client";

import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Did, ErrorText, Panel } from "@/components/primitives";
import { describeApiError } from "@/lib/api";
import { useWallet } from "@/features/wallet";
import { atlasPinsKey, fetchAtlasPins, unpinAtlas } from "./api";

/**
 * Every volume→publisher pin this server holds — the audit list revocation starts from.
 *
 * The import card can only offer an unpin from a *mismatch preview*, which requires possessing a
 * volume signed by the very key being distrusted. This list is the proactive path: see what is
 * trusted, and forget a binding on its own row ("that key leaked", "that publisher is gone") —
 * after which the volume's next import re-runs trust-on-first-use with a fresh confirm.
 */
export function AtlasPinsCard({ origin }: { origin: string }) {
  const { wallet } = useWallet();
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const pins = useSWR(
    wallet ? atlasPinsKey(origin, wallet.account.did) : null,
    () => fetchAtlasPins(origin, wallet!),
    { revalidateOnFocus: false },
  );

  const doUnpin = async (volume: string) => {
    setError(undefined);
    setBusy(volume);
    try {
      await unpinAtlas(origin, wallet!, volume);
      toast.success(`Unpinned ${volume} — its next import re-confirms the publisher`);
      await pins.mutate();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(undefined);
    }
  };

  // No pins is the common steady state for a server that never imported a volume — say so rather
  // than rendering an empty box that reads like a failed fetch.
  return (
    <Panel title="Atlas — pinned publishers">
      {pins.error ? (
        <ErrorText>{describeApiError(pins.error)}</ErrorText>
      ) : !pins.data ? (
        <p className="text-xs text-muted-foreground">loading…</p>
      ) : pins.data.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No pins yet — a volume's first import records who signed it.
        </p>
      ) : (
        <ul className="space-y-2">
          {pins.data.map((pin) => (
            <li key={pin.volume} className="flex items-center gap-2 text-sm">
              <span className="font-mono">{pin.volume}</span>
              <Did value={pin.publisher} />
              <span className="text-xs text-muted-foreground">
                pinned {new Date(pin.pinnedAt).toLocaleDateString()} by{" "}
              </span>
              <Did value={pin.pinnedBy} />
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto text-destructive"
                disabled={busy !== undefined}
                onClick={() => void doUnpin(pin.volume)}
              >
                {busy === pin.volume ? "unpinning…" : "Unpin"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ErrorText>{error}</ErrorText>
    </Panel>
  );
}
