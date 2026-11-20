"use client";

import type { PlaceProposal } from "@beaconsgg/protocol-types";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Did, ErrorText, Field, Panel, ToneBadge } from "@/components/primitives";
import { describeApiError } from "@/lib/api";
import { useWallet } from "@/features/wallet";
import { fetchProposals, getPlace, reviewProposal } from "./api";
import { ImageStrip } from "./ImageStrip";
import { placeImages } from "./logic";
import {
  amendmentFor,
  describeValue,
  diffProposal,
  isAmendable,
  proposalMediaHashes,
  type ProposalDrafts,
} from "./proposalLogic";

/**
 * The contribution review queue (the server's place proposals spec, beacon.server
 * `doc/spec/place-proposals.md` §6): the operator half of player contributions. Nothing a player
 * submitted is visible anywhere until a decision lands here.
 *
 * Each row shows the submission as a **diff against the live place**, because that's the actual
 * judgement: a contribution that only fills holes is safe to wave through, while one replacing a
 * curated value deserves a look. Free-text fields are editable inline, so the common "90% right"
 * submission is one tweak plus approve rather than a reject-and-ask.
 */
export function ProposalQueue({ origin }: { origin: string }) {
  const { wallet } = useWallet();
  // The queue is fetched with `status: "pending"` and the history separately, rather than one
  // unfiltered read split in memory. The wire pages at 50 newest-first, so on a server with more
  // than that many decided submissions an unfiltered fetch spends the entire page on history and
  // renders "the queue is clear" over real work no operator can then reach.
  const proposals = useSWR(
    wallet ? ["places.proposals", origin, wallet.account.did] : null,
    () => fetchProposals(origin, wallet!, { status: "pending" }),
    { revalidateOnFocus: false },
  );
  // History is a courtesy, so it stays one unfiltered page — a decided row scrolling off it costs
  // nothing, unlike a pending one.
  const history = useSWR(
    wallet ? ["places.proposals.decided", origin, wallet.account.did] : null,
    () => fetchProposals(origin, wallet!),
    { revalidateOnFocus: false },
  );

  // The wire already returns newest-first, so no further ordering is needed.
  const pending = proposals.data ?? [];
  const decided = (history.data ?? []).filter((p) => p.status !== "pending");

  return (
    <Panel title={`Contributions${pending.length > 0 ? ` (${pending.length} pending)` : ""}`}>
      {proposals.error ? <ErrorText>{describeApiError(proposals.error)}</ErrorText> : null}
      {pending.length === 0 && !proposals.error ? (
        <p className="text-sm text-muted-foreground">
          No submissions awaiting review — the queue is clear.
        </p>
      ) : null}

      <ul className="space-y-3">
        {pending.map((p) => (
          <ProposalCard
            key={p.id}
            origin={origin}
            proposal={p}
            onDecided={() => {
              // Both: the row leaves the queue and joins the history in the same moment.
              void proposals.mutate();
              void history.mutate();
            }}
          />
        ))}
      </ul>

      {decided.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {decided.length} already decided
          </summary>
          <ul className="mt-2 space-y-1">
            {decided.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-xs">
                <ToneBadge tone={p.status === "approved" ? "ok" : "warn"}>{p.status}</ToneBadge>
                <span className="text-muted-foreground">
                  {p.placeUnique ? "improvement" : "new place"} · {describeValue(p.fields.name)}
                </span>
                {p.reviewReason ? (
                  <span className="text-muted-foreground">— {p.reviewReason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}

/** One pending submission: its diff, its photos, and the decision an operator makes on it. */
function ProposalCard({
  origin,
  proposal,
  onDecided,
}: {
  origin: string;
  proposal: PlaceProposal;
  onDecided: () => void;
}) {
  const { wallet } = useWallet();
  const { mutate } = useSWRConfig();
  const [drafts, setDrafts] = useState<ProposalDrafts>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // The live place an improvement targets — the other half of the diff. New places have none.
  const current = useSWR(
    proposal.placeUnique ? ["places.detail", origin, proposal.placeUnique] : null,
    () => getPlace(origin, proposal.placeUnique!),
    { revalidateOnFocus: false },
  );

  const changes = diffProposal(proposal, current.data);
  const overwrites = changes.filter((c) => c.overwrites);
  const photos = placeImages(proposal.fields.media);
  // Without the live record every field reads as a hole-fill and the "replaces N" badge can't
  // appear — so an improvement isn't judgeable until it loads. A 404 here means the place was
  // retired since submission, and approving would silently revive it.
  const blocked = proposal.placeUnique !== undefined && current.data === undefined;

  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    try {
      const edits = decision === "approve" ? amendmentFor(proposal, drafts) : undefined;
      const decided = await reviewProposal(origin, wallet!, {
        id: proposal.id,
        decision,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(edits ? { edits } : {}),
      });
      // The server returns the row UNCHANGED when someone already decided it — the stamp is
      // conditional on `pending`. Claiming success there would be a lie, and after a reject it
      // would point at photos that are by now live on an approved place.
      const wanted = decision === "approve" ? "approved" : "rejected";
      if (decided.status !== wanted) {
        toast.warning(
          `Already ${decided.status} by another operator — your decision didn't apply.`,
        );
      } else {
        toast.success(decision === "approve" ? "Approved — it's live" : "Rejected");
        if (decision === "approve" && proposal.placeUnique) {
          // The place just changed: any other card diffing against it — and the editor — is stale.
          void mutate(["places.detail", origin, proposal.placeUnique]);
        }
        if (decision === "reject" && proposalMediaHashes(proposal).length > 0) {
          // Deliberately NOT a one-click delete. Media is content-addressed and deduped by hash, so
          // the same bytes may be referenced by another place, another pending proposal, or a
          // connector-ingested image — the Media panel is the reclaim surface that can show that.
          toast.info("Its photos are still stored — reclaim them from the Media panel if unused.");
        }
      }
      onDecided();
    } catch (err) {
      toast.error(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded border border-border p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <ToneBadge tone={proposal.placeUnique ? "neutral" : "ok"}>
          {proposal.placeUnique ? "improvement" : "new place"}
        </ToneBadge>
        {overwrites.length > 0 ? (
          <ToneBadge tone="warn">replaces {overwrites.length} existing</ToneBadge>
        ) : null}
        {proposal.credit ? <ToneBadge tone="neutral">wants credit</ToneBadge> : null}
        <Did value={proposal.proposedBy} />
        {proposal.placeUnique ? (
          <span className="font-mono text-xs text-muted-foreground">{proposal.placeUnique}</span>
        ) : null}
      </div>

      {proposal.note ? (
        <p className="mb-2 rounded bg-muted p-2 text-xs italic">“{proposal.note}”</p>
      ) : null}

      {current.error ? (
        <ErrorText>
          Can&apos;t load the target place ({describeApiError(current.error)}) — it may have been
          retired since this was submitted, in which case approving would revive it.
        </ErrorText>
      ) : null}

      <div className="space-y-1.5">
        {changes.map((c) => (
          <div key={c.field} className="grid items-center gap-2 md:grid-cols-[8rem_1fr_1fr]">
            <span className="text-xs text-muted-foreground">{c.field}</span>
            <span className="truncate text-xs text-muted-foreground">
              {c.current === undefined ? (
                <em>{blocked ? "unknown" : "empty"}</em>
              ) : (
                <s className={c.overwrites ? "text-destructive" : ""}>{describeValue(c.current)}</s>
              )}
            </span>
            {isAmendable(c.field) && typeof c.proposed === "string" ? (
              <Input
                value={drafts[c.field] ?? c.proposed}
                onChange={(e) => setDrafts((d) => ({ ...d, [c.field]: e.target.value }))}
                className="h-8 text-xs"
              />
            ) : (
              <span className="text-xs">{describeValue(c.proposed)}</span>
            )}
          </div>
        ))}
      </div>

      {photos.length > 0 ? <ImageStrip images={photos} size="sm" className="mt-2 gap-2" /> : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="grow">
          <Field label="Reason (recorded on the decision, shown to the contributor)">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. that's a private residence"
              className="h-8 text-xs"
            />
          </Field>
        </div>
        <Button disabled={busy || blocked} onClick={() => void decide("approve")}>
          {blocked ? "Loading place…" : "Approve"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void decide("reject")}>
          Reject
        </Button>
      </div>
    </li>
  );
}
