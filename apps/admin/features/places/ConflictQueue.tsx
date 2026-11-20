"use client";

import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { ErrorText, Panel, ToneBadge } from "@/components/primitives";
import { describeApiError } from "@/lib/api";
import { useWallet } from "@/features/wallet";
import { editPlace, fetchConflicts, resolveConflicts } from "./api";

/**
 * The approval queue (the server's places spec, beacon.server `doc/spec/places.md` §3.1): connector
 * data that collided with an admin-held field.
 * **Keep mine** marks the row reviewed (the admin value stays). **Accept incoming** clears the
 * admin override — the connector value flows back on the recompute, and the edit auto-resolves
 * every conflict touching that field.
 */
export function ConflictQueue({ origin }: { origin: string }) {
  const { wallet } = useWallet();
  const conflicts = useSWR(
    wallet ? ["places.conflicts", origin, wallet.account.did] : null,
    () => fetchConflicts(origin, wallet!),
    { revalidateOnFocus: false },
  );

  const pending = (conflicts.data ?? []).filter((c) => c.resolvedAt === undefined);

  const act = async (fn: () => Promise<unknown>) => {
    await fn();
    await conflicts.mutate();
  };

  return (
    <Panel title={`Conflicts${pending.length > 0 ? ` (${pending.length} pending)` : ""}`}>
      {conflicts.error ? <ErrorText>{describeApiError(conflicts.error)}</ErrorText> : null}
      {pending.length === 0 && !conflicts.error ? (
        <p className="text-sm text-muted-foreground">No pending conflicts — the queue is clear.</p>
      ) : null}
      <ul className="space-y-2">
        {pending.map((c) => (
          <li key={c.id} className="rounded border border-border p-2 text-sm">
            <div className="mb-1 flex items-center gap-2">
              <ToneBadge tone="warn">{c.field}</ToneBadge>
              <span className="font-mono text-xs text-muted-foreground">{c.placeUnique}</span>
              <span className="text-xs text-muted-foreground">from {c.source}</span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded bg-muted p-2">
                <p className="text-xs text-muted-foreground">current (admin-held)</p>
                <code className="text-xs">{JSON.stringify(c.currentValue) ?? "—"}</code>
              </div>
              <div className="rounded bg-muted p-2">
                <p className="text-xs text-muted-foreground">incoming ({c.source})</p>
                <code className="text-xs">{JSON.stringify(c.incomingValue)}</code>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                variant="ghost"
                onClick={() => void act(() => resolveConflicts(origin, wallet!, [c.id]))}
              >
                Keep mine
              </Button>
              <Button
                onClick={() =>
                  void act(() => editPlace(origin, wallet!, c.placeUnique, undefined, [c.field]))
                }
              >
                Accept incoming
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
