"use client";

import type { SettingValue } from "@beaconsgg/protocol-types";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ResolvedEntry } from "./catalog";
import { parseList, type DraftValue } from "./logic";

/**
 * The editor for one setting, chosen by its catalog kind.
 *
 * **Nothing here refuses a value.** The server's schemas are the authority on what each setting
 * accepts, they are stricter than anything worth restating in a control, and a write is refused with
 * a message naming the field. So an empty number field sends the empty string and comes back with
 * "expected number", which is a sentence the operator can act on. The alternative, silently dropping
 * keystrokes that do not parse, loses their work to make the UI look tidy.
 */
export function SettingControl({
  id,
  entry,
  value,
  disabled,
  onChange,
}: {
  id: string;
  entry: ResolvedEntry;
  value: DraftValue | undefined;
  disabled: boolean;
  onChange: (next: SettingValue) => void;
}) {
  if (entry.kind === "boolean") {
    return (
      <Switch
        id={id}
        checked={value === true}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next)}
      />
    );
  }

  if (entry.kind === "select") {
    /*
     * A select is the one control here that CAN refuse a value, by not offering it, and a Radix
     * trigger with no matching item renders blank. So a value the catalog's list does not contain is
     * added to the list rather than dropped: the server owns the vocabulary, `geocodeProvider`'s
     * lives in a module the console cannot import, and a row that quietly shows nothing is the worst
     * of the available outcomes.
     */
    const current = typeof value === "string" ? value : "";
    const options = entry.options ?? [];
    const shown = current !== "" && !options.includes(current) ? [current, ...options] : options;
    return (
      <Select value={current} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger id={id} size="sm" className="min-w-[12rem]">
          <SelectValue placeholder="Not set" />
        </SelectTrigger>
        <SelectContent>
          {shown.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (entry.kind === "textarea") {
    const text = value === null || value === undefined ? "" : String(value);
    const box = (
      <Textarea
        id={id}
        rows={entry.rows ?? 3}
        value={text}
        disabled={disabled}
        className={entry.mono ? "font-mono text-xs" : undefined}
        aria-describedby={entry.maxLength ? `${id}-count` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    );
    if (!entry.maxLength) return box;
    const over = text.length > entry.maxLength;
    return (
      <div className="flex w-full flex-col gap-1">
        {box}
        <span
          id={`${id}-count`}
          className={`self-end font-mono text-xs ${over ? "text-destructive" : "text-muted-foreground"}`}
        >
          {text.length} / {entry.maxLength}
        </span>
      </div>
    );
  }

  if (entry.kind === "list") {
    return (
      <ListInput
        id={id}
        value={value}
        emptyValue={entry.emptyValue}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  const text = value === null || value === undefined ? "" : String(value);
  return (
    <Input
      id={id}
      type={entry.kind === "number" ? "number" : "text"}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(entry.kind === "number" && raw !== "" ? Number(raw) : raw);
      }}
    />
  );
}

/**
 * The comma-separated list editor, which holds the operator's raw text rather than re-deriving it.
 *
 * Deriving the box's contents from the parsed array looks equivalent and is not: typing `a,` parses
 * to `["a", ""]`, which joins back to `"a, "`, and the space it inserts cannot be deleted, because
 * backspacing re-splits and re-joins it straight back in. So the text is state, the array is what it
 * emits, and the box only re-syncs when the value changes from somewhere else (a save, a reset, a
 * discard). `PlaceEditor` reaches the same place from the other side: it holds only the text and
 * parses once at submit.
 *
 * **Empty entries are dropped, and what an empty box means is the setting's business.** An earlier
 * version kept them, on the grounds that an empty `coverage` box has to produce `[""]` to mean
 * "everywhere". That is true of `coverage` and of nothing else: `csv()` drops empties for every
 * variable, only `coverage` is floored from `[]` to `[""]`, and `gameSlugSchema` refuses `""`. So
 * keeping them made `games: []`, the documented "open to every game" default, unreachable
 * from this screen: an operator could close a server to one game and never reopen it. `emptyValue`
 * carries the exception on the one setting that has it.
 */
function ListInput({
  id,
  value,
  emptyValue,
  disabled,
  onChange,
}: {
  id: string;
  value: DraftValue | undefined;
  emptyValue: SettingValue | undefined;
  disabled: boolean;
  onChange: (next: SettingValue) => void;
}) {
  const incoming = Array.isArray(value) ? value.join(", ") : "";
  const [text, setText] = useState(incoming);
  const [emitted, setEmitted] = useState(incoming);
  if (incoming !== emitted) {
    setEmitted(incoming);
    setText(incoming);
  }
  return (
    <Input
      id={id}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value;
        const out = parseList(next, emptyValue);
        setText(next);
        setEmitted(Array.isArray(out) ? out.join(", ") : String(out));
        onChange(out);
      }}
    />
  );
}
