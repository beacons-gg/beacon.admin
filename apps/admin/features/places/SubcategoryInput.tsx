"use client";

import type { PlaceCategory } from "@beaconsgg/protocol-types";
import { Field } from "@/components/primitives";
import { Input } from "@/components/ui/input";
import { subcategoriesFor } from "./logic";
import { useTaxonomy } from "./useTaxonomy";

/**
 * The subcategory input — free text with the server's own vocabulary as **suggestions**.
 *
 * Not a closed dropdown, on purpose. Player submissions are validated against the vocabulary, but
 * admin writes deliberately are not (the server's place proposals spec, beacon.server
 * `doc/spec/place-proposals.md` §4.2): an operator may legitimately be adding a slug ahead of the
 * tag map, and that's most likely on exactly the hand-authored places this console creates. So the
 * datalist offers what the connectors produce today while still accepting anything the slug regex
 * allows.
 *
 * Slugs are **namespaced per category**, so the suggestions follow `category` and a slug only means
 * something as a pair.
 */
export function SubcategoryInput({
  id,
  origin,
  category,
  value,
  onChange,
}: {
  /** Distinct per mount — a datalist is addressed by id, so two on a page must not share one. */
  id: string;
  origin: string;
  category: PlaceCategory | "";
  value: string;
  onChange: (v: string) => void;
}) {
  const taxonomy = useTaxonomy(origin);
  return (
    <Field label="Subcategory">
      <Input
        value={value}
        list={id}
        onChange={(e) => onChange(e.target.value)}
        placeholder={category ? "e.g. water" : "pick a category first"}
      />
      <datalist id={id}>
        {subcategoriesFor(taxonomy.data, category).map((slug) => (
          <option key={slug} value={slug} />
        ))}
      </datalist>
    </Field>
  );
}
