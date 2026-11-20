"use client";

import type { PlaceAtlasSurveyResult } from "@beaconsgg/protocol-types";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToneBadge } from "@/components/primitives";
import {
  NO_SUBCATEGORY,
  selectAllTypes,
  tallyBuckets,
  toggleCategory,
  toggleSubcategory,
  type AtlasContentFilters,
  type AtlasTally,
  type AtlasTypeRow,
  type AtlasTypeSelection,
} from "./atlasImportLogic";

const subKey = (category: string, sub: string) => `${category}\u0000${sub}`;

/**
 * The place-type half of step 4: one row per category, each expandable to its subcategories, with
 * the survey's counts under the current content filters. Without a survey (an older server, or the
 * operator skipped it) the same table runs without counts or subcategories.
 */
export function AtlasTypePicker({
  rows,
  selection,
  onChange,
  survey,
  filters,
}: {
  rows: AtlasTypeRow[];
  selection: AtlasTypeSelection;
  onChange: (next: AtlasTypeSelection) => void;
  survey: PlaceAtlasSurveyResult | undefined;
  filters: AtlasContentFilters;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  // One tally per category and per category+subcategory, under the filters but not the selection,
  // so a row shows what ticking it would add.
  const tallies = useMemo(() => {
    const out = new Map<string, AtlasTally>();
    if (!survey) return out;
    for (const row of rows) {
      const buckets = survey.buckets.filter((b) => b.category === row.category);
      out.set(row.category, tallyBuckets(buckets, filters));
      for (const sub of row.subcategories) {
        out.set(
          subKey(row.category, sub),
          tallyBuckets(
            buckets.filter((b) => (b.subcategory ?? NO_SUBCATEGORY) === sub),
            filters,
          ),
        );
      }
    }
    return out;
  }, [rows, survey, filters]);

  const counts = (key: string) => {
    if (!survey) return null;
    const t = tallies.get(key);
    return (
      <>
        <TableCell className="text-right tabular-nums">{t?.places.toLocaleString()}</TableCell>
        <TableCell className="text-right text-muted-foreground tabular-nums">
          {t?.withPhotos.toLocaleString()}
        </TableCell>
      </>
    );
  };

  const toggleOpen = (category: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        This volume does not list its place types, so every type it holds is imported.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="xs" onClick={() => onChange(selectAllTypes(rows))}>
          Select all
        </Button>
        <Button variant="outline" size="xs" onClick={() => onChange({})}>
          Select none
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Place type</TableHead>
            {survey ? (
              <>
                <TableHead className="text-right">Places</TableHead>
                <TableHead className="text-right">With photos</TableHead>
              </>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const ticked = selection[row.category];
            const all = ticked !== undefined && ticked.length === row.subcategories.length;
            const expandable = row.subcategories.length > 0 && row.supported;
            const isOpen = open.has(row.category);
            return (
              <Fragment key={row.category}>
                <TableRow className={row.supported ? undefined : "opacity-60"}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Import ${row.category}`}
                      disabled={!row.supported}
                      checked={all ? true : ticked ? "indeterminate" : false}
                      onCheckedChange={(on) =>
                        onChange(toggleCategory(selection, row, on === true))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {expandable ? (
                        <button
                          type="button"
                          className="flex items-center gap-1 font-mono"
                          aria-expanded={isOpen}
                          onClick={() => toggleOpen(row.category)}
                        >
                          {isOpen ? (
                            <ChevronDownIcon className="size-3.5" />
                          ) : (
                            <ChevronRightIcon className="size-3.5" />
                          )}
                          {row.category}
                        </button>
                      ) : (
                        <span className="font-mono">{row.category}</span>
                      )}
                      {ticked && !all ? (
                        <span className="text-xs text-muted-foreground">
                          {ticked.length} of {row.subcategories.length} subcategories
                        </span>
                      ) : null}
                      {row.supported ? null : (
                        <ToneBadge tone="warn">not supported by this server</ToneBadge>
                      )}
                    </div>
                  </TableCell>
                  {counts(row.category)}
                </TableRow>
                {expandable && isOpen
                  ? row.subcategories.map((sub) => (
                      <TableRow key={subKey(row.category, sub)}>
                        <TableCell />
                        <TableCell>
                          <label className="flex items-center gap-2 pl-5">
                            <Checkbox
                              checked={ticked?.includes(sub) ?? false}
                              onCheckedChange={(on) =>
                                onChange(toggleSubcategory(selection, row, sub, on === true))
                              }
                            />
                            {sub === NO_SUBCATEGORY ? (
                              <span className="text-muted-foreground italic">no subcategory</span>
                            ) : (
                              <span className="font-mono">{sub}</span>
                            )}
                          </label>
                        </TableCell>
                        {counts(subKey(row.category, sub))}
                      </TableRow>
                    ))
                  : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      {rows.some((r) => !r.supported) ? (
        <p className="text-xs text-muted-foreground">
          Types marked not supported come from a newer taxonomy than this server knows. Every import
          skips them; upgrading the server makes them importable.
        </p>
      ) : null}
    </div>
  );
}
