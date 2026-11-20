"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorText, Panel } from "@/components/primitives";
import { describeApiError } from "@/lib/api";
import { downloadJson, exportFilename } from "@/lib/download";
import { useWallet } from "@/features/wallet";
import { exportContributions } from "./api";

/**
 * Share approved player contributions with a dataset builder: the export half of the contribution
 * round-trip.
 *
 * **The list below is the point of this card, not decoration.** This is the only direction in the
 * architecture where player-derived data flows toward a central party, and the design requires that
 * the operator be told plainly what is included before they do it. A button labelled "Export" would
 * not be telling them anything.
 */
export function ContribExportCard({ origin }: { origin: string }) {
  const { wallet } = useWallet();
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const run = async () => {
    if (!wallet) return;
    setError(undefined);
    setMessage(undefined);
    try {
      const collection = await exportContributions(origin, wallet);
      const named = collection.features.filter(
        (f) => (f.properties.contrib?.contributors?.length ?? 0) > 0,
      ).length;
      downloadJson(exportFilename("beacon-contrib", origin), collection);
      setMessage(
        collection.features.length === 0
          ? "Nothing to share yet — no approved contribution carries a licence grant."
          : `Exported ${collection.features.length} contributed place(s); ${named} name a contributor.`,
      );
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  return (
    <Panel title="Share contributions (beacon-contrib/1)">
      <p className="text-sm text-muted-foreground">
        Hands your approved player contributions to a dataset builder, which may republish them as
        open static files that anyone can mirror. Off by default: turn on Contribution export in
        Settings, or set <code>BEACON_PLACES_PROPOSALS_EXPORT</code> to <code>on</code>.
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-status-ok">Included</dt>
        <dd className="text-muted-foreground">
          The contributed fields themselves, the licence each contributor granted, and the DID of
          anyone who asked to be credited.
        </dd>
        <dt className="text-status-warn">Withheld</dt>
        <dd className="text-muted-foreground">
          Every other source&apos;s fields, the reviewer notes, the DID of anyone who did not ask to
          be credited, and any submission with no licence grant.
        </dd>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={!wallet} onClick={() => void run()}>
          Export contributions
        </Button>
        {message ? <span className="text-sm text-status-ok">{message}</span> : null}
      </div>
      <ErrorText>{error}</ErrorText>
    </Panel>
  );
}
