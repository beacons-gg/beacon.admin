"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorText, Panel } from "@/components/primitives";
import { describeApiError } from "@/lib/api";
import { useWallet } from "@/features/wallet";
import { retireSource, snapshotsKey } from "./api";

/**
 * The `places.source.retire` surface: close out a source that is no longer an input, marking every
 * live record it left behind gone and re-merging or retiring each affected place, as a durable run
 * the runs card above tracks. It exists for connector residue — `osm`, once an Atlas volume has
 * adopted its places — and the server refuses the living inputs (`admin`, `contrib`, `list:*`,
 * `atlas:*`), which each retire through their own lifecycle.
 *
 * Dataset-scale and not undoable, so it confirms — with `window.confirm`, the same idiom the
 * sibling RecentRunsCard uses for its destructive cancel.
 */
export function RetireSourceCard({ origin }: { origin: string }) {
  const { wallet } = useWallet();
  const { mutate } = useSWRConfig();
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const target = source.trim();

  const doRetire = async () => {
    if (!window.confirm(`Really retire every live "${target}" record?`)) return;
    setError(undefined);
    setBusy(true);
    try {
      const run = await retireSource(origin, wallet!, target);
      toast.success(`Retiring ${target} — run ${run.id} is underway`);
      setSource("");
      void mutate(snapshotsKey(origin, wallet!.account.did));
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Retire a source">
      <p className="text-xs text-muted-foreground">
        Close out a source that is no longer an input: every live record it left goes gone, and each
        affected place re-merges or retires, as a run tracked above. For connector residue (e.g.{" "}
        <code>osm</code> after an Atlas volume adopts its places) — living inputs are refused.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Input
          value={source}
          placeholder="source id, e.g. osm"
          className="max-w-48 font-mono"
          onChange={(e) => setSource(e.target.value)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!wallet || busy || target === ""}
          onClick={() => void doRetire()}
        >
          {busy ? "retiring…" : "Retire"}
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </Panel>
  );
}
