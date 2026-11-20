"use client";

import { KICKER } from "@/components/primitives";
import { placeCategorySchema, type PlaceCategory } from "@beaconsgg/protocol-types";
import { useMemo } from "react";
import { ChevronDownIcon, ImageIcon, SearchIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, toggled } from "@/lib/utils";
import {
  KIND_COLORS,
  MAP_KINDS,
  ROOM_GROUPS,
  type Facets,
  type MapHidden,
  type PointFeature,
  type RoomGroup,
} from "@/features/map";

/** The place taxonomy (the query vocabulary) — the source of truth for the place-type filter. */
const ALL_CATEGORIES: readonly PlaceCategory[] = placeCategorySchema.options;
const CATEGORY_ITEMS = ALL_CATEGORIES.map((c) => ({ key: c, label: c }));
const GROUP_TITLES: Record<RoomGroup, string> = { game: "Games", type: "Room types" };

export interface ResultsColumnProps {
  /** The features passing the filters; search narrows them further here. */
  features: PointFeature[];
  hidden: MapHidden;
  onHiddenChange: (next: MapHidden) => void;
  /** The games and room types in view, for the room filters and their colours. */
  facets: Facets;
  colorBy: RoomGroup;
  onColorByChange: (next: RoomGroup) => void;
  categories: ReadonlySet<PlaceCategory>;
  onToggleCategory: (c: PlaceCategory) => void;
  onSetCategories: (next: Set<PlaceCategory>) => void;
  query: string;
  onQueryChange: (q: string) => void;
  selectedId: string | undefined;
  onSelect: (inspect: PointFeature["properties"]) => void;
  originName: (origin: string) => string;
}

/**
 * The Explore results rail: search + filters that drive both this list and the map, over the same
 * fan-out data the map renders. Rooms filter by the games and room types actually in view, so any
 * game's rooms can be told apart with no plugin for it. Selecting a row is the jumping-off point —
 * it flies the map to the item and opens its inspector.
 */
export function ResultsColumn({
  features,
  hidden,
  onHiddenChange,
  facets,
  colorBy,
  onColorByChange,
  categories,
  onToggleCategory,
  onSetCategories,
  query,
  onQueryChange,
  selectedId,
  onSelect,
  originName,
}: ResultsColumnProps) {
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      q
        ? features.filter(({ properties: p }) =>
            [p.title, p.subtitle, p.id, p.roomType ?? ""].some((s) => s.toLowerCase().includes(q)),
          )
        : features,
    [features, q],
  );

  return (
    <div className="hidden w-full flex-col overflow-hidden border-r bg-card/40 md:flex md:w-80 lg:w-96">
      <div className="flex flex-col gap-3 border-b p-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search places, rooms, games, DIDs…"
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MAP_KINDS.map((k) => {
            const on = !hidden.kinds.has(k.key);
            const color = KIND_COLORS[k.key];
            return (
              <button
                key={k.key}
                type="button"
                onClick={() => onHiddenChange({ ...hidden, kinds: toggled(hidden.kinds, k.key) })}
                aria-pressed={on}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  on
                    ? "border-transparent text-foreground"
                    : "border-border text-muted-foreground opacity-70 hover:opacity-100",
                )}
                style={
                  on ? { background: `color-mix(in srgb, ${color} 16%, transparent)` } : undefined
                }
              >
                <span className="size-2 rounded-full" style={{ background: color }} />
                {k.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterPopover
            title="Place types"
            dot={KIND_COLORS.place}
            items={CATEGORY_ITEMS}
            capitalize
            isOn={(c) => categories.has(c as PlaceCategory)}
            onToggle={(c) => onToggleCategory(c as PlaceCategory)}
            onAll={() => onSetCategories(new Set(ALL_CATEGORIES))}
            onNone={() => onSetCategories(new Set())}
          />
          {ROOM_GROUPS.map((by) => (
            <FilterPopover
              key={by}
              title={GROUP_TITLES[by]}
              dot={KIND_COLORS.room}
              items={facets[by]}
              isOn={(key) => !hidden[by].has(key)}
              onToggle={(key) => onHiddenChange({ ...hidden, [by]: toggled(hidden[by], key) })}
              onAll={() => onHiddenChange({ ...hidden, [by]: new Set() })}
              onNone={() =>
                onHiddenChange({ ...hidden, [by]: new Set(facets[by].map((f) => f.key)) })
              }
            />
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Colour rooms by
          <div className="inline-flex rounded-full border p-0.5" role="group">
            {(["type", "game"] as const).map((by) => (
              <button
                key={by}
                type="button"
                aria-pressed={colorBy === by}
                onClick={() => onColorByChange(by)}
                className={cn(
                  "rounded-full px-2 py-0.5 capitalize transition-colors",
                  colorBy === by ? "bg-accent text-foreground" : "hover:text-foreground",
                )}
              >
                {by}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`px-3 py-2 ${KICKER}`}>{shown.length} in view</div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {shown.map((f) => {
          const p = f.properties;
          const selected = p.id === selectedId;
          return (
            <button
              key={`${p.origin}:${p.id}`}
              type="button"
              onClick={() => onSelect(p)}
              className={cn(
                "grid w-full grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
                selected ? "border-gold/50 bg-gold/8" : "border-transparent hover:bg-accent",
              )}
            >
              {/* Echoes the map marker: its fill + server-color ring. */}
              <span
                className="size-3 justify-self-center rounded-full border-2"
                style={{
                  background: p.color,
                  borderColor: p.originColor || "transparent",
                }}
              />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-medium">{p.title}</span>
                <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <span className="truncate">
                    <span className="capitalize">{p.kind}</span>
                    {p.subtitle ? ` · ${p.subtitle}` : ""}
                  </span>
                  {p.hasPhoto ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-[4px] border border-line-2 px-1.5 py-px font-mono text-[10px] font-medium text-muted-foreground">
                      <ImageIcon className="size-2.5" />
                      photo
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="max-w-24 truncate text-[10.5px] text-muted-foreground">
                {originName(p.origin)}
              </span>
            </button>
          );
        })}
        {shown.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">
            Nothing in view. Pan the map, add a server, or clear filters.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A filter as a popover checklist: the place types (sent to the server, so it narrows before the
 * page cap) or the games and room types in view. `All` and `None` set every entry at once.
 */
function FilterPopover({
  title,
  dot,
  items,
  capitalize = false,
  isOn,
  onToggle,
  onAll,
  onNone,
}: {
  title: string;
  dot: string;
  items: readonly { key: string; label: string; color?: string; count?: number }[];
  capitalize?: boolean;
  isOn: (key: string) => boolean;
  onToggle: (key: string) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  const on = items.filter((i) => isOn(i.key)).length;
  const summary = on === items.length ? "All" : on === 0 ? "None" : on;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="size-2 rounded-full" style={{ background: dot }} />
          {title} · <span className="text-foreground">{summary}</span>
          <ChevronDownIcon className="size-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className={KICKER}>{title}</span>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              className="underline underline-offset-2 hover:text-muted-foreground"
              onClick={onAll}
            >
              All
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:underline"
              onClick={onNone}
            >
              None
            </button>
          </div>
        </div>
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {items.map((i) => (
            <label
              key={i.key}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-accent"
            >
              <Checkbox checked={isOn(i.key)} onCheckedChange={() => onToggle(i.key)} />
              {i.color ? (
                <span className="size-2 shrink-0 rounded-full" style={{ background: i.color }} />
              ) : null}
              <span className={cn("grow truncate text-sm", capitalize && "capitalize")}>
                {i.label}
              </span>
              {i.count !== undefined ? (
                <span className="text-xs text-muted-foreground tabular-nums">{i.count}</span>
              ) : null}
            </label>
          ))}
          {items.length === 0 ? (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">None in view.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
