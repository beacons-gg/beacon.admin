"use client";

import {
  MAX_PLACE_MEDIA,
  mediaPairs,
  placeEditSetSchema,
  type Media,
  type PlaceCategory,
  type PlaceDetail,
  type PlaceEditSet,
  type PlaceEditableField,
} from "@beaconsgg/protocol-types";
import { useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Did, ErrorText, Field, ToneBadge } from "@/components/primitives";
import { Textarea } from "@/components/ui/textarea";
import { describeApiError } from "@/lib/api";
import { useServers } from "@/features/servers";
import { useWallet } from "@/features/wallet";
import { editPlace, getPlace, uploadPlacePhoto } from "./api";
import { CategorySelect } from "./CategorySelect";
import { SubcategoryInput } from "./SubcategoryInput";
import { ImageStrip } from "./ImageStrip";
import { PlaceDescriptor } from "./PlaceDescriptor";
import { categoryLabel, placeImages } from "./logic";

/** A photo is a [thumb, full] entry pair, so the wire's media cap halves into a pair cap. */
const MAX_PHOTO_PAIRS = Math.floor(MAX_PLACE_MEDIA / 2);

/** Every override the fields form can release (photos have their own revert in their section). */
const CLEARABLE: PlaceEditableField[] = [
  "name",
  "category",
  "subcategory",
  "description",
  "website",
  "wikipedia",
  "altNames",
  "point",
  "geometry",
];

/** The comma-separated "also known as" input, parsed (empties dropped; the schema caps sizes). */
function parseAltNames(text: string): string[] {
  return text
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

/** The form's touch-tracked field keys (point covers the lat+lng pair). */
type FormField =
  | "name"
  | "category"
  | "subcategory"
  | "description"
  | "website"
  | "wikipedia"
  | "altNames"
  | "point";

/**
 * Full per-field curation for one place (the server's places spec, beacon.server
 * `doc/spec/places.md` §3.1): the form is **prefilled with the record; fields you TOUCH become
 * admin-held on save** — untouched fields never join the signed `set`, so opening the editor can't
 * freeze them against connector updates, while re-typing the current value deliberately PINS it
 * (the way to protect a good connector value). Field edits and staged photo edits land together in
 * ONE `places.edit` op — there's a single save, so neither staging area can wipe the other. Clear
 * releases an override so the connector value flows back.
 */
export function PlaceEditor({ origin, unique }: { origin: string; unique: string }) {
  const detail = useSWR(["places.detail", origin, unique], () => getPlace(origin, unique), {
    revalidateOnFocus: false,
  });

  if (detail.error) {
    // An unknown id (404) or an unreachable server — say so instead of loading forever.
    return (
      <div className="mt-3 rounded border border-border p-3">
        <ErrorText>{describeApiError(detail.error)}</ErrorText>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded border border-border p-3">
      {detail.data ? (
        <EditorForm
          // The form seeds its state from the record ONCE — the key remounts it whenever a save
          // lands (updatedAt moves), so it re-seeds with fresh values and no effect is needed.
          // Cross-staging loss is prevented by the single save, not by the key: a landed save
          // carried EVERYTHING dirty, so the remount never discards work.
          key={`${detail.data.unique}:${detail.data.updatedAt}`}
          origin={origin}
          place={detail.data}
          refresh={async () => {
            await detail.mutate();
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}

function EditorForm({
  origin,
  place: p,
  refresh,
}: {
  origin: string;
  place: PlaceDetail;
  refresh: () => Promise<void>;
}) {
  const { wallet } = useWallet();
  const { servers } = useServers();

  // Prefilled from the record; `touched` — not value comparison — decides what a save sets, so
  // re-typing the current value pins it as admin-held (see the component doc).
  const [name, setName] = useState(p.name ?? "");
  const [category, setCategory] = useState<PlaceCategory | "">(p.category);
  const [subcategory, setSubcategory] = useState(p.subcategory ?? "");
  const [description, setDescription] = useState(p.description ?? "");
  const [website, setWebsite] = useState(p.website ?? "");
  const [wikipedia, setWikipedia] = useState(p.wikipedia ?? "");
  const [altNamesText, setAltNamesText] = useState((p.altNames ?? []).join(", "));
  const [lat, setLat] = useState(String(p.point.lat));
  const [lng, setLng] = useState(String(p.point.lng));
  const [touched, setTouched] = useState<ReadonlySet<FormField>>(new Set());
  const [error, setError] = useState<string | undefined>(undefined);

  const touch = (field: FormField) => setTouched((t) => new Set(t).add(field));

  // Photo edits build on a working copy of the [thumb, full] pairs; `undefined` = not editing
  // (render straight from the record). Lazily seeded on the first mutation — no effects.
  const [pendingPairs, setPendingPairs] = useState<Media[][] | undefined>(undefined);
  const [photoError, setPhotoError] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Uploads need the media capability; the registry pinned the descriptor's list at add time.
  const hasMediaCap =
    servers.find((s) => s.origin === origin)?.capabilities.includes("media") ?? false;

  const currentPairs = mediaPairs(p.media);
  const pairs = pendingPairs ?? currentPairs;
  const photosDirty = pendingPairs !== undefined;
  const imgs = placeImages(pairs.flat());

  // A touched field emptied out is NOT a set (the wire forbids empty values) — that's what the
  // per-field Clear buttons are for; it just drops out of the staged set.
  const altNames = parseAltNames(altNamesText);
  const stagedFields: Record<string, unknown> = {
    ...(touched.has("name") && name ? { name } : {}),
    ...(touched.has("category") && category ? { category } : {}),
    ...(touched.has("subcategory") && subcategory ? { subcategory } : {}),
    ...(touched.has("description") && description ? { description } : {}),
    ...(touched.has("website") && website ? { website } : {}),
    ...(touched.has("wikipedia") && wikipedia ? { wikipedia } : {}),
    ...(touched.has("altNames") && altNames.length > 0 ? { altNames } : {}),
  };
  const fieldsDirty = Object.keys(stagedFields).length > 0 || touched.has("point");
  const anyDirty = fieldsDirty || photosDirty;

  const submit = async (
    set: PlaceEditSet | undefined,
    clear: PlaceEditableField[] = [],
  ): Promise<void> => {
    if (!wallet) return;
    setError(undefined);
    try {
      await editPlace(origin, wallet, p.unique, set, clear);
      toast.success("Place updated");
      await refresh(); // a landed edit moves updatedAt → the keyed form remounts, re-seeded
    } catch (err) {
      setError(describeApiError(err)); // no refresh → no remount → all staged work survives
    }
  };

  const saveChanges = async () => {
    const set: Record<string, unknown> = { ...stagedFields };
    if (touched.has("point")) {
      const point = { lat: Number(lat), lng: Number(lng) };
      if (!lat || !lng || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
        setError("Point needs both a numeric lat and lng.");
        return;
      }
      set["point"] = point;
    }
    if (photosDirty) set["media"] = pairs.flat();
    // The wire schema is the validator (bounds, URL shape, slug alphabet) — reject locally with
    // the same rules the server enforces, so a typo never costs a signed round-trip.
    const parsed = placeEditSetSchema.safeParse(set);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "invalid edit");
      return;
    }
    await submit(parsed.data);
  };

  const addPhoto = async (file: File) => {
    if (!wallet) return;
    setPhotoError(undefined);
    setUploading(true);
    try {
      const pair = await uploadPlacePhoto(origin, wallet, file);
      setPendingPairs([...pairs, pair]);
    } catch (err) {
      setPhotoError(describeApiError(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <ToneBadge>{categoryLabel(p)}</ToneBadge>
        <span className="font-medium">{p.name ?? "(unnamed)"}</span>
        <span className="font-mono text-xs text-muted-foreground">{p.unique}</span>
        {p.hasGeometry ? <ToneBadge tone="ok">geometry</ToneBadge> : null}
        <span className="text-xs text-muted-foreground">
          {/* Per-place provenance rides the detail route: source + its license line. */}
          {p.sources
            .map((s) => (s.attribution ? `${s.source} — ${s.attribution}` : s.source))
            .join(" · ")}
        </span>
      </div>

      {p.contributors && p.contributors.length > 0 ? (
        // Players who asked to be credited and whose contribution was approved. Shown here because
        // this is where an operator judges the next one — and because it's the only place the
        // credit they opted into is currently honoured at all.
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Credited</span>
          {p.contributors.map((did) => (
            <Did key={did} value={did} />
          ))}
        </div>
      ) : null}
      <PlaceDescriptor
        description={p.description}
        descriptionCredit={p.descriptionCredit}
        website={p.website}
        descriptionClassName="mb-2"
        websiteClassName="mb-2"
      />

      <div className="mb-3 rounded border border-border p-2">
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          Photos
          {photosDirty ? <ToneBadge>unsaved</ToneBadge> : null}
          {!hasMediaCap ? (
            <span className="text-muted-foreground">
              (server has no media capability — no uploads)
            </span>
          ) : null}
        </div>
        {imgs.length > 0 ? (
          <ImageStrip
            images={imgs}
            className="mb-2 gap-3"
            {...(wallet
              ? { onRemove: (i: number) => setPendingPairs(pairs.filter((_, x) => x !== i)) }
              : {})}
          />
        ) : (
          <p className="mb-2 text-xs text-muted-foreground">No photos.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // re-picking the same file must fire onChange again
              if (file) void addPhoto(file);
            }}
          />
          <Button
            disabled={!wallet || !hasMediaCap || uploading || pairs.length >= MAX_PHOTO_PAIRS}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? "Uploading…" : "Add photo…"}
          </Button>
          {photosDirty ? (
            <Button variant="ghost" onClick={() => setPendingPairs(undefined)}>
              Cancel photo edits
            </Button>
          ) : (
            <Button
              variant="ghost"
              disabled={!wallet || fieldsDirty}
              onClick={() => void submit(undefined, ["media"])}
            >
              Revert to source photos
            </Button>
          )}
          {pairs.length >= MAX_PHOTO_PAIRS ? (
            <span className="text-xs text-muted-foreground">max {MAX_PHOTO_PAIRS} photos</span>
          ) : null}
        </div>
        <ErrorText>{photoError}</ErrorText>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              touch("name");
            }}
          />
        </Field>
        <CategorySelect
          value={category}
          onChange={(v) => {
            setCategory(v);
            touch("category");
          }}
          emptyLabel="—"
        />
        <SubcategoryInput
          id="edit-place-subcategory"
          origin={origin}
          category={category}
          value={subcategory}
          onChange={(v) => {
            setSubcategory(v);
            touch("subcategory");
          }}
        />
        <Field label="Website">
          <Input
            value={website}
            onChange={(e) => {
              setWebsite(e.target.value);
              touch("website");
            }}
            placeholder="https://…"
          />
        </Field>
        <Field label="Wikipedia (en)">
          <Input
            value={wikipedia}
            onChange={(e) => {
              setWikipedia(e.target.value);
              touch("wikipedia");
            }}
            placeholder="https://en.wikipedia.org/wiki/…"
          />
        </Field>
        <Field label="Also known as (comma-separated)">
          <Input
            value={altNamesText}
            onChange={(e) => {
              setAltNamesText(e.target.value);
              touch("altNames");
            }}
            placeholder="T-Mobile Park, The Safe"
          />
        </Field>
        <Field label="Lat">
          <Input
            value={lat}
            onChange={(e) => {
              setLat(e.target.value);
              touch("point");
            }}
          />
        </Field>
        <Field label="Lng">
          <Input
            value={lng}
            onChange={(e) => {
              setLng(e.target.value);
              touch("point");
            }}
          />
        </Field>
      </div>
      <div className="mt-2">
        <Field label="Description">
          <Textarea
            rows={2}
            maxLength={500}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              touch("description");
            }}
            placeholder="Free text, up to 500 characters"
          />
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button disabled={!wallet || !anyDirty} onClick={() => void saveChanges()}>
          Save changes
        </Button>
        <span className="text-xs text-muted-foreground">Clear override:</span>
        {CLEARABLE.map((field) => (
          <Button
            key={field}
            variant="ghost"
            // Clears land immediately and remount the form — locked while anything is staged so
            // they can never silently discard unsaved work.
            disabled={!wallet || anyDirty}
            onClick={() => void submit(undefined, [field])}
          >
            {field}
          </Button>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        The form shows the current record. Fields you edit are set on save (admin-held: wins every
        merge, conflict-protected) — re-typing the current value pins it. Photo edits save in the
        same op. Clear = the connector value flows back.
      </p>
      <ErrorText>{error}</ErrorText>
    </>
  );
}
