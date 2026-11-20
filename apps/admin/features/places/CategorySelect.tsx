"use client";

import { placeCategorySchema, type PlaceCategory } from "@beaconsgg/protocol-types";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Radix Select forbids an empty-string item value; a sentinel stands in for "no category filter".
const ALL = "__all__";

/** The one category dropdown (the browse filter and the editor share it) — enum-derived. */
export function CategorySelect({
  value,
  onChange,
  emptyLabel,
}: {
  value: PlaceCategory | "";
  onChange: (v: PlaceCategory | "") => void;
  emptyLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>Category</Label>
      <Select
        value={value || ALL}
        onValueChange={(v) => onChange(v === ALL ? "" : (v as PlaceCategory))}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{emptyLabel}</SelectItem>
          {placeCategorySchema.options.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
