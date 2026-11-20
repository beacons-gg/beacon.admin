"use client";

import type { PlaceCategory, PlaceCreateParams } from "@beaconsgg/protocol-types";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Panel } from "@/components/primitives";
import { describeApiError } from "@/lib/api";
import { useWallet } from "@/features/wallet";
import { createPlace } from "./api";
import { CategorySelect } from "./CategorySelect";
import { parsePoint } from "./logic";
import { SubcategoryInput } from "./SubcategoryInput";

/**
 * Author a place by hand (the server's place proposals spec, beacon.server
 * `doc/spec/place-proposals.md` §7): the one way to add a place no connector produced, and the
 * operator counterpart to a player's submission.
 *
 * Deliberately the **minimum** a place needs to be servable (`category` + `point`, plus a name worth
 * having): the record lands as an `admin` source and the full {@link PlaceEditor} takes it from
 * there, so this form doesn't reimplement per-field curation, photo management, or geometry.
 */
export function NewPlaceForm({
  origin,
  onCreated,
}: {
  origin: string;
  onCreated: (unique: string) => void;
}) {
  const { wallet } = useWallet();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<PlaceCategory | "">("");
  const [subcategory, setSubcategory] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [busy, setBusy] = useState(false);

  const point = parsePoint(lat, lng);
  const ready = category !== "" && point !== undefined && !busy;

  const submit = async () => {
    if (!wallet || category === "" || point === undefined || busy) return;
    setBusy(true);
    try {
      const params: PlaceCreateParams = {
        category,
        point,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(subcategory ? { subcategory } : {}),
      };
      const unique = await createPlace(origin, wallet, params);
      toast.success("Place created — opening the editor for the rest");
      setName("");
      setLat("");
      setLng("");
      onCreated(unique);
    } catch (err) {
      toast.error(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="New place">
      <p className="mb-3 text-xs text-muted-foreground">
        Adds a place the connectors never produced. It lands as an <code>admin</code> source — it
        wins every merge and never auto-retires. Everything else (photos, descriptors, geometry) is
        editable straight after.
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pocket Park" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Latitude">
            <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="47.61" />
          </Field>
          <Field label="Longitude">
            <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-122.33" />
          </Field>
        </div>
        <CategorySelect
          value={category}
          onChange={(v) => {
            setCategory(v);
            setSubcategory(""); // slugs are namespaced per category — the old one may not exist here
          }}
          emptyLabel="pick one"
        />
        <SubcategoryInput
          id="new-place-subcategory"
          origin={origin}
          category={category}
          value={subcategory}
          onChange={setSubcategory}
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button disabled={!ready} onClick={() => void submit()}>
          Create
        </Button>
        {category === "" ? (
          <span className="text-xs text-muted-foreground">A category is required.</span>
        ) : point === undefined ? (
          <span className="text-xs text-muted-foreground">
            A valid latitude and longitude are required.
          </span>
        ) : null}
      </div>
    </Panel>
  );
}
