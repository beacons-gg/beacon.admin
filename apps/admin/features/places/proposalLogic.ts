import {
  canonicalJson,
  type PlaceDetail,
  type PlaceEditSet,
  type PlaceProposal,
} from "@beaconsgg/protocol-types";

/**
 * Pure review logic for the contribution queue (the server's place proposals spec, beacon.server
 * `doc/spec/place-proposals.md` §6), unit-tested so the component stays render-only.
 */

/** One field a submission proposes, paired with what the place holds there today. */
export interface ProposedChange {
  field: keyof PlaceEditSet;
  /** The live value, or `undefined` — for a new place, always `undefined`. */
  current: unknown;
  proposed: unknown;
  /** True when the place already holds a *different* value here — the reviewer's real decision. */
  overwrites: boolean;
}

/**
 * The submission as a field-by-field diff against the current place. This is what makes review a
 * judgement rather than a guess: a contribution that only fills holes (`overwrites` nowhere — the
 * common case, since OSM is thin exactly where contributions help) is safe to wave through, while
 * one that replaces a name someone else curated deserves a second look.
 *
 * `current` is absent for a new-place proposal, so every field reads as a fill.
 */
export function diffProposal(
  proposal: PlaceProposal,
  current: PlaceDetail | undefined,
): ProposedChange[] {
  // Every PlaceEditSet key is also a PlaceDetail key, so the lookup needs no cast.
  const fields = Object.keys(proposal.fields) as (keyof PlaceEditSet)[];
  return fields
    .filter((field) => proposal.fields[field] !== undefined)
    .map((field) => {
      const currentValue = current?.[field];
      const proposed = proposal.fields[field];
      return {
        field,
        current: currentValue,
        proposed,
        overwrites: currentValue !== undefined && !sameValue(currentValue, proposed),
      };
    });
}

/** Deep equality via canonical JSON — literally the rule the server's merge applies (`merge.ts`). */
function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** A short human line for a proposed value (the diff cells and the bulk confirmation share it). */
export function describeValue(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    // Media is the only array of objects a contribution can carry.
    return value.every((v) => typeof v === "string")
      ? (value as string[]).join(", ")
      : `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (typeof value === "object" && "lat" in (value as object)) {
    const p = value as { lat: number; lng: number };
    return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  }
  return JSON.stringify(value);
}

/**
 * The amendment to send with an approval: only fields the reviewer actually **changed** from what
 * was submitted. An untouched field must not join `edits` — resending the submitted value would be
 * indistinguishable from an amendment in the audit trail, and it would mark the reviewer as the
 * author of a value the contributor wrote.
 */
export function amendmentFor(
  proposal: PlaceProposal,
  drafts: Readonly<ProposalDrafts>,
): PlaceEditSet | undefined {
  const edits: Record<string, string> = {};
  for (const field of Object.keys(drafts) as AmendableField[]) {
    const draft = drafts[field];
    const submitted = proposal.fields[field];
    // Only the free-text fields are amendable — see AMENDABLE_FIELDS.
    if (draft === undefined || typeof submitted !== "string") continue;
    const trimmed = draft.trim();
    if (trimmed && trimmed !== submitted) edits[field] = trimmed;
  }
  return Object.keys(edits).length > 0 ? (edits as PlaceEditSet) : undefined;
}

/** Every media hash a submission carries — what "also remove its photos" acts on after a reject. */
export function proposalMediaHashes(proposal: PlaceProposal): string[] {
  return [...new Set((proposal.fields.media ?? []).map((m) => m.hash))];
}

/**
 * The fields a reviewer may amend inline. Deliberately **free text only**: `category` is a closed
 * enum the wire would 400 on a typo, and `subcategory` must be a curated pair the review op does
 * NOT re-validate (only `propose` does) — so a typed slug there would land an off-vocabulary value
 * the submit path would have rejected. Everything else is accept-or-reject as submitted.
 */
export const AMENDABLE_FIELDS = ["name", "description", "website"] as const;
export type AmendableField = (typeof AMENDABLE_FIELDS)[number];
export type ProposalDrafts = Partial<Record<AmendableField, string>>;

/** Whether a diff row can be edited in place before approval. */
export function isAmendable(field: keyof PlaceEditSet): field is AmendableField {
  return (AMENDABLE_FIELDS as readonly string[]).includes(field);
}
