import type { BeaconClient } from "@beaconsgg/client-sdk";
import type { Wallet } from "@beaconsgg/identity";
import {
  placeConflictReadSchema,
  placeDetailReadSchema,
  placeExportReadSchema,
  placeProposalReadSchema,
  placeAtlasPinReadSchema,
  placeAtlasPreviewReadSchema,
  placeAtlasSurveyReadSchema,
  type PlaceAtlasImportParams,
  type PlaceAtlasPin,
  type PlaceAtlasSurvey,
  type PlaceAtlasSurveyParams,
  placeSnapshotReadSchema,
  placesQueryResultSchema,
  readVariant,
  placeTaxonomyReadSchema,
  type Media,
  type PlaceCategory,
  type PlaceConflict,
  type PlaceDetail,
  type PlaceEditSet,
  type PlaceEditableField,
  type PlaceCreateParams,
  type PlaceExport,
  type PlaceProposal,
  type PlaceProposalReviewParams,
  type PlaceProposalsFetchParams,
  type PlaceAtlasPreview,
  type PlaceSnapshot,
  type PlacesQueryResult,
  type PlaceTaxonomy,
} from "@beaconsgg/protocol-types";
import { sha256Base64url } from "@beaconsgg/identity";
import { z } from "zod";
import { client, getJson, parseOrThrow, signedPost, signedUpload } from "@/lib/api";
import { withSession } from "@/lib/session";
import { preparePlacePhoto, toBase64, type PreparedVariant } from "./photo";

/**
 * Typed wrappers over the server's places routes (the server's places spec, beacon.server
 * `doc/spec/places.md` §5 and §6.3): public reads are plain GETs; everything admin rides a signed
 * envelope. Responses are **parsed against the wire schemas** (never cast), so console/server shape
 * drift surfaces as a loud error, not a broken screen. All calls target ONE server — curation is
 * per-dataset.
 */

/**
 * The operator's read of a places list: unknown keys dropped, but a place under a category this
 * console has never heard of fails the read rather than vanishing from the list, since an operator
 * cannot moderate what they cannot see. The player's list drops it instead.
 */
const placesBrowseSchema = readVariant(placesQueryResultSchema, { degrade: false });

export function queryPlaces(
  origin: string,
  cells: string[],
  categories: PlaceCategory[],
  opts: { spread?: boolean } = {},
): Promise<PlacesQueryResult> {
  const params = new URLSearchParams({ cells: cells.join(",") });
  if (categories.length > 0) params.set("categories", categories.join(","));
  // One page sampled evenly over the cells, for a map. A server from before `spread` ignores it.
  if (opts.spread) params.set("spread", "1");
  return getJson(origin, `/places?${params.toString()}`).then((r) => placesBrowseSchema.parse(r));
}

/**
 * One place's detail. Always asks for `contributors` — the console is the surface that reviews
 * contributions, so the operator deciding on one wants to see who is already credited on the place.
 * (Opt-in on the wire because `placeDetailSchema` was strict when it shipped; see the server route.
 * The console now parses the READ twin, which drops a field it does not know instead.)
 */
export function getPlace(origin: string, unique: string): Promise<PlaceDetail> {
  return getJson(origin, `/places/${unique}?contributors=1`).then((r) =>
    placeDetailReadSchema.parse(r),
  );
}

/**
 * The curated category → subcategory vocabulary (the server's place proposals spec, beacon.server
 * `doc/spec/place-proposals.md` §4.2). Public + unsigned, and it changes only when an operator
 * edits the server's tag map — so callers cache it hard.
 */
export function getTaxonomy(origin: string): Promise<PlaceTaxonomy> {
  return getJson(origin, "/places/taxonomy").then((r) => placeTaxonomyReadSchema.parse(r));
}

/**
 * The created place's id. `places.create` echoes the full canonical **record**, which is the store's
 * shape rather than a wire schema (it carries `status`/`createdAt`, not the read path's `hasGeometry`
 * /`sources`) — so this parses the one field the console acts on and lets the rest go. The caller
 * hands that id to the editor, which re-reads the place through `placeDetailReadSchema` properly.
 */
const createdResponse = z.object({ place: z.object({ unique: z.string().min(1) }) });

/** Author a place by hand — the one way to add one no connector produced. Lands as an `admin` source. */
export function createPlace(
  origin: string,
  wallet: Wallet,
  params: PlaceCreateParams,
): Promise<string> {
  return signedPost(origin, "/places/admin/create", wallet, "places.create", params).then(
    (r) => createdResponse.parse(r).place.unique,
  );
}

const proposalsResponse = z.object({ proposals: z.array(placeProposalReadSchema) });
const proposalResponse = z.object({ proposal: placeProposalReadSchema });

/** The contribution review queue — the whole queue, newest first (the admin scope of the op). */
export function fetchProposals(
  origin: string,
  wallet: Wallet,
  params: PlaceProposalsFetchParams = {},
): Promise<PlaceProposal[]> {
  return signedPost(
    origin,
    "/places/admin/proposals/fetch",
    wallet,
    "places.proposals.fetch",
    params,
  ).then((r) => proposalsResponse.parse(r).proposals);
}

/** Approve (optionally amending first) or reject one submission. */
export function reviewProposal(
  origin: string,
  wallet: Wallet,
  params: PlaceProposalReviewParams,
): Promise<PlaceProposal> {
  return signedPost(
    origin,
    "/places/admin/proposals/review",
    wallet,
    "places.proposals.review",
    params,
  ).then((r) => proposalResponse.parse(r).proposal);
}

const snapshotsResponse = z.object({ snapshots: z.array(placeSnapshotReadSchema) });
const snapshotResponse = z.object({ snapshot: placeSnapshotReadSchema });
const previewResponse = z.object({ preview: placeAtlasPreviewReadSchema });
const uploadPreviewResponse = z.object({
  staged: z.string(),
  preview: placeAtlasPreviewReadSchema,
});

/**
 * A volume's preview — who signed it, what it holds, how the pin stands. The target is a hosted
 * URL (a version, or the volume's root, which the server resolves through `latest.json` and reports
 * back as `versionUrl`), or a directory under the server's mounted volumes dir
 * (`BEACON_ATLAS_VOLUMES_DIR`).
 */
export function inspectAtlas(
  origin: string,
  wallet: Wallet,
  target: { url: string } | { path: string },
): Promise<PlaceAtlasPreview> {
  return signedPost(origin, "/places/admin/atlas/inspect", wallet, "places.atlas.inspect", {
    ...target,
  }).then((r) => previewResponse.parse(r).preview);
}

/**
 * Upload a volume archive (.zip) and get back its staged id + preview. The signed envelope rides
 * the `x-beacon-op` header — the body is the archive bytes themselves, hashed here first so the
 * envelope attests exactly what the server will re-hash while it streams to disk.
 */
export async function uploadAtlas(
  origin: string,
  wallet: Wallet,
  file: File,
): Promise<{ staged: string; preview: PlaceAtlasPreview }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256Base64url(bytes);
  // Signed through the client (same envelope; the console names no game, so none is attached);
  // sent here because the body is the archive's raw bytes, which the SDK's JSON transport does not
  // carry. Sent again under a new session, as the clients' calls are, when the old one ran out.
  return withSession(wallet, async (w) => {
    const envelope = client.sign(w, {
      op: "places.atlas.upload",
      params: { hash, size: bytes.length },
    });
    const res = await fetch(`${origin}/places/admin/atlas/upload`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        accept: "application/json",
        // Envelope JSON is ASCII by construction (dids, base64url signatures, a hash, a number).
        "x-beacon-op": btoa(JSON.stringify(envelope)),
      },
      body: bytes,
    });
    // A locked server's 503 throws an `ApiError` with the code `writeLocked`, as the SDK's calls do.
    return uploadPreviewResponse.parse(await parseOrThrow(res));
  });
}

/**
 * Import a previewed volume — `publisher` restates the did the operator just confirmed; `cells`
 * (coverage-style geohash prefixes) scopes the run to just those of the volume's cells, and
 * `categories` plus `options` narrow what it takes inside them.
 */
export function importAtlas(
  origin: string,
  wallet: Wallet,
  params: PlaceAtlasImportParams,
): Promise<PlaceSnapshot> {
  return signedPost(origin, "/places/admin/atlas/import", wallet, "places.atlas.import", {
    ...params,
  }).then((r) => snapshotResponse.parse(r).snapshot);
}

const surveyResponse = z.object({ survey: placeAtlasSurveyReadSchema });

/**
 * One poll of a volume survey: what the volume holds inside `cells`, by place type and content.
 * The server runs it in the background, so the first call starts it and the caller repeats the
 * same params until `status` is `done` or `failed`. A server older than the op answers 404.
 */
export function surveyAtlas(
  origin: string,
  wallet: Wallet,
  params: PlaceAtlasSurveyParams,
): Promise<PlaceAtlasSurvey> {
  return signedPost(origin, "/places/admin/atlas/survey", wallet, "places.atlas.survey", {
    ...params,
  }).then((r) => surveyResponse.parse(r).survey);
}

/** Forget a volume's publisher pin — the deliberate half of key rotation. */
export function unpinAtlas(origin: string, wallet: Wallet, volume: string): Promise<boolean> {
  return signedPost<{ ok: true; removed: boolean }>(
    origin,
    "/places/admin/atlas/unpin",
    wallet,
    "places.atlas.unpin",
    { volume },
  ).then((r) => r.removed);
}

const pinsResponse = z.object({ pins: z.array(placeAtlasPinReadSchema) });

/**
 * The pins card's SWR key — exported because the import card must revalidate it on actions that
 * change pins (import pins at confirm time; a mismatch unpin removes one), and a key spelled in
 * two files is a cache entry that quietly stops updating.
 */
export function atlasPinsKey(origin: string, did: string): [string, string, string] {
  return ["places.atlas.pins", origin, did];
}

/** The runs list's SWR key — same rule: starting an import must revalidate the list it lands in. */
export function snapshotsKey(origin: string, did: string): [string, string, string] {
  return ["places.snapshots", origin, did];
}

/** Signed read: every volume→publisher pin — the audit list revocation starts from. */
export function fetchAtlasPins(origin: string, wallet: Wallet): Promise<PlaceAtlasPin[]> {
  return signedPost(origin, "/places/admin/atlas/pins", wallet, "places.atlas.pins.fetch", {}).then(
    (r) => pinsResponse.parse(r).pins,
  );
}

export function listSnapshots(origin: string, wallet: Wallet): Promise<PlaceSnapshot[]> {
  return signedPost(
    origin,
    "/places/admin/snapshots/fetch",
    wallet,
    "places.snapshots.fetch",
    {},
  ).then((r) => snapshotsResponse.parse(r).snapshots);
}

/** Close out a queued/running run (a live run stops at its next chunk; an orphaned one just flips). */
export function cancelSnapshot(origin: string, wallet: Wallet, id: string): Promise<PlaceSnapshot> {
  return signedPost(origin, "/places/admin/snapshots/cancel", wallet, "places.snapshot.cancel", {
    id,
  }).then((r) => snapshotResponse.parse(r).snapshot);
}

/**
 * Close out a source that is no longer an input: every live record of
 * `source` goes gone, as a durable run the runs card tracks. The server refuses living inputs —
 * this exists for the residue a deleted connector left behind (`osm`, once Atlas has adopted it).
 */
export function retireSource(
  origin: string,
  wallet: Wallet,
  source: string,
): Promise<PlaceSnapshot> {
  return signedPost(origin, "/places/admin/sources/retire", wallet, "places.source.retire", {
    source,
  }).then((r) => snapshotResponse.parse(r).snapshot);
}

const conflictsResponse = z.object({ conflicts: z.array(placeConflictReadSchema) });

export function fetchConflicts(origin: string, wallet: Wallet): Promise<PlaceConflict[]> {
  return signedPost(
    origin,
    "/places/admin/conflicts/fetch",
    wallet,
    "places.conflicts.fetch",
    {},
  ).then((r) => conflictsResponse.parse(r).conflicts);
}

export function resolveConflicts(origin: string, wallet: Wallet, ids: string[]): Promise<number> {
  return signedPost<{ ok: true; resolved: number }>(
    origin,
    "/places/admin/conflicts/resolve",
    wallet,
    "places.conflicts.resolve",
    { ids },
  ).then((r) => r.resolved);
}

export function editPlace(
  origin: string,
  wallet: Wallet,
  unique: string,
  set: PlaceEditSet | undefined,
  clear: PlaceEditableField[],
): Promise<void> {
  return signedPost<{ ok: true }>(origin, "/places/admin/edit", wallet, "places.edit", {
    unique,
    ...(set && Object.keys(set).length > 0 ? { set } : {}),
    ...(clear.length > 0 ? { clear } : {}),
  }).then(() => undefined);
}

const uploadResponse = z.object({ ok: z.literal(true), id: z.string().min(1) });

/**
 * Upload one picked photo as the place-media thumb+full pair (media capability required): resize
 * + re-encode in the browser, content-address each variant (sha256), `media.put` both, and return
 * the two `Media` entries in the pairing order every consumer relies on — [thumb, full].
 */
export async function uploadPlacePhoto(
  origin: string,
  wallet: Wallet,
  file: File,
  // The client to sign with; the console's own by default.
  via: BeaconClient = client,
): Promise<Media[]> {
  const { thumb, full } = await preparePlacePhoto(file);
  const put = async (variant: PreparedVariant, role: "thumb" | "full"): Promise<Media> => {
    const hash = sha256Base64url(variant.bytes);
    const res = await signedUpload(
      origin,
      "/media",
      wallet,
      "media.put",
      { hash, type: variant.type, size: variant.bytes.length },
      toBase64(variant.bytes),
      via,
    );
    return { type: "image", role, hash, uris: [uploadResponse.parse(res).id] };
  };
  return [await put(thumb, "thumb"), await put(full, "full")];
}

const exportResponse = z.object({ collection: placeExportReadSchema });

export function exportPlaces(origin: string, wallet: Wallet): Promise<PlaceExport> {
  return signedPost(origin, "/places/admin/export", wallet, "places.export", {}).then(
    (r) => exportResponse.parse(r).collection,
  );
}

/**
 * The approved player contributions this server holds, as a `beacon-contrib/1` file — the export
 * half of the contribution round-trip. 404s unless `BEACON_PLACES_PROPOSALS_EXPORT` is set.
 */
export function exportContributions(origin: string, wallet: Wallet): Promise<PlaceExport> {
  return signedPost(
    origin,
    "/places/admin/contrib/export",
    wallet,
    "places.contrib.export",
    {},
  ).then((r) => exportResponse.parse(r).collection);
}

export function importPlaces(
  origin: string,
  wallet: Wallet,
  name: string,
  collection: PlaceExport,
): Promise<PlaceSnapshot> {
  return signedPost(origin, "/places/admin/import", wallet, "places.import", {
    name,
    collection,
  }).then((r) => snapshotResponse.parse(r).snapshot);
}
