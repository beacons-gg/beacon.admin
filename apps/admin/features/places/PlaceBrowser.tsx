"use client";

import type { PlaceCategory } from "@beaconsgg/protocol-types";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorText, Field, Panel, ToneBadge } from "@/components/primitives";
import { describeApiError } from "@/lib/api";
import { queryPlaces } from "./api";
import { CategorySelect } from "./CategorySelect";
import { categoryLabel, parseCells, placeImages } from "./logic";
import { NewPlaceForm } from "./NewPlaceForm";
import { PlaceEditor } from "./PlaceEditor";

/**
 * Browse the dataset by geohash cells (public reads); selecting a row (or a pasted id) opens the
 * {@link PlaceEditor} for full per-field curation. Queries fire on submit (not per keystroke) and
 * the SWR key carries the NORMALIZED cell list, so aliases of the same query share one cache
 * entry.
 */
export function PlaceBrowser({ origin }: { origin: string }) {
  const [cells, setCells] = useState("");
  const [category, setCategory] = useState<PlaceCategory | "">("");
  const [query, setQuery] = useState<{ cells: string[]; category: PlaceCategory | "" }>();
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [lookupId, setLookupId] = useState("");

  const submit = () => {
    const parsed = parseCells(cells);
    setQuery(parsed.length > 0 ? { cells: parsed, category } : undefined);
  };

  const lookup = () => {
    const id = lookupId.trim();
    if (id) setSelected(id); // the editor fetches the detail; an unknown id surfaces its 404 there
  };

  const results = useSWR(
    query ? ["places.query", origin, query.cells.join(","), query.category] : null,
    () => queryPlaces(origin, query!.cells, query!.category ? [query!.category] : []),
    { revalidateOnFocus: false },
  );

  return (
    <div className="space-y-4">
      <Panel title="Browse & edit">
        <div className="flex items-end gap-2">
          <div className="grow">
            <Field label="Geohash cells (CSV — e.g. c23nb,c23nc)">
              <Input
                value={cells}
                onChange={(e) => setCells(e.target.value)}
                placeholder="c23nb"
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
            </Field>
          </div>
          <CategorySelect value={category} onChange={setCategory} emptyLabel="all" />
          <Button disabled={parseCells(cells).length === 0} onClick={submit}>
            Search
          </Button>
        </div>
        <div className="mt-2 flex items-end gap-2">
          <div className="grow">
            <Field label="Or open a place by id (unique)">
              <Input
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
                placeholder="01J…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") lookup();
                }}
              />
            </Field>
          </div>
          <Button variant="ghost" disabled={!lookupId.trim()} onClick={lookup}>
            Open
          </Button>
        </div>
        {results.error ? <ErrorText>{describeApiError(results.error)}</ErrorText> : null}
        {results.data ? (
          <>
            <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto text-sm">
              {results.data.places.map((p) => (
                <li key={p.unique}>
                  <button
                    className={`w-full rounded px-2 py-1 text-left hover:bg-muted ${
                      selected === p.unique ? "bg-muted" : ""
                    }`}
                    onClick={() => setSelected(p.unique)}
                  >
                    <ToneBadge>{categoryLabel(p)}</ToneBadge>{" "}
                    {placeImages(p.media).length > 0 ? (
                      <ToneBadge tone="ok">photo</ToneBadge>
                    ) : null}{" "}
                    <span className="font-medium">{p.name ?? "(unnamed)"}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      {p.point.lat.toFixed(4)},{p.point.lng.toFixed(4)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">
              {results.data.places.length} places{results.data.truncated ? " (truncated)" : ""} ·{" "}
              {results.data.attribution.join(" · ")}
            </p>
          </>
        ) : null}
        {selected ? <PlaceEditor origin={origin} unique={selected} /> : null}
      </Panel>
      {/* Create hands its new id straight to the editor above — create, then curate. */}
      <NewPlaceForm origin={origin} onCreated={setSelected} />
    </div>
  );
}
