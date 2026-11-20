import type { AdminSetting, SettingValue } from "@beaconsgg/protocol-types";
import type { FieldIssue } from "@/lib/api";
import { entryFor, GROUPS, OTHER, type ResolvedEntry } from "./catalog";

/**
 * The pure half of the settings screen: what each row says about itself, what a Save would send, and
 * where a refusal belongs.
 *
 * The one shape worth stating up front is the **baseline**, which is what an edit is measured
 * against and what a control starts on. It is `storedValue ?? value`, not `value`: when the server
 * held an override back (a dormant capability, a clamped ceiling) the operator's stated intent is
 * `storedValue`, and starting the control on the in-force number instead would quietly offer to
 * overwrite a choice they made and still hold. The badge explains the divergence; the control edits
 * the intent.
 */

/** A value the operator is trying to store. `null` clears a setting to no value, which is not a reset. */
export type DraftValue = SettingValue | null;
export type Draft = Record<string, DraftValue>;

export function sameValue(a: DraftValue | undefined, b: DraftValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  return a === b;
}

/** What a control starts on, and what an edit is compared against. See the module docblock. */
export function baselineOf(setting: AdminSetting): SettingValue | undefined {
  return setting.storedValue ?? setting.value;
}

/**
 * The keys a Save would actually send: draft entries that differ from their baseline.
 *
 * Editing a field back to where it started removes it, so the pending count is a count of changes
 * rather than of controls touched, and a Save never names a key it is not changing. A draft entry
 * for a key the server did not send is dropped: it cannot be measured against anything, and the
 * server would refuse it anyway.
 */
export function pendingChanges(settings: readonly AdminSetting[], draft: Draft): Draft {
  const pending: Draft = {};
  for (const setting of settings) {
    if (!(setting.key in draft)) continue;
    const next = draft[setting.key];
    if (next === undefined) continue;
    const base = baselineOf(setting);
    // `null` means "clear it", which is a change exactly when the setting has a value now.
    if (next === null ? base !== undefined : !sameValue(next, base)) pending[setting.key] = next;
  }
  return pending;
}

/**
 * Pending edits that are an empty number box.
 *
 * The control keeps the empty string rather than dropping keystrokes, and the server would refuse it
 * with a readable message. But `setMany` validates the whole patch and throws before storing any of
 * it, so one blank box costs nine good edits a signed round trip to learn something the console
 * already knows: the field is a number and the box is empty. Catching it here restates no server
 * rule, because "this box is blank" is not a value judgment.
 *
 * It answers with labels as well as keys for the same reason it exists at all: on a 69-row page,
 * "two number fields are empty" sends an operator hunting for something the console can name.
 */
export function blankNumbers(
  settings: readonly AdminSetting[],
  pending: Draft,
): { key: string; label: string }[] {
  return settings.flatMap((s) => {
    const entry = entryFor(s);
    return pending[s.key] === "" && entry.kind === "number"
      ? [{ key: s.key, label: entry.label }]
      : [];
  });
}

/**
 * What a comma-separated list box means, given what an empty one means for this setting.
 *
 * Entries are trimmed and empty ones dropped, matching `csv()` in the server's `loadConfig`, which
 * is what every list setting is seeded from. The exception is carried per setting rather than
 * globally: only `coverage` is floored from `[]` to `[""]`, so only `coverage` can spell "everywhere"
 * as a list holding the empty prefix. Keeping empties everywhere made `games: []`, the documented
 * "open to every game" default, unreachable from the screen, since `gameSlugSchema` refuses
 * `""` and an operator who had closed a server to one game could never reopen it.
 */
export function parseList(text: string, emptyValue: SettingValue | undefined): SettingValue {
  const parsed = text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  return parsed.length === 0 && emptyValue !== undefined ? emptyValue : parsed;
}

export function formatValue(value: SettingValue | undefined): string {
  if (value === undefined) return "not set";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (Array.isArray(value)) return value.length === 0 ? "empty" : value.join(", ");
  if (value === "") return "empty";
  return String(value);
}

export interface RowStatus {
  tone: "neutral" | "ok" | "warn";
  /** The badge. */
  label: string;
  /** One sentence naming what is true and, where there is one, the remedy. */
  detail: string;
  /** The operator behind an override, kept out of `detail` so a DID can render as a chip. */
  actor?: string | undefined;
}

/**
 * What a row says about where its value came from.
 *
 * The two `storedReason` cases come first and are deliberately different sentences: they leave an
 * identical shape and want opposite things, so a shared "not in force" badge would tell an operator
 * nothing they can act on. `prerequisite` wants a capability switched back on, `ceiling` wants an
 * environment variable raised and a restart.
 */
export function rowStatus(setting: AdminSetting): RowStatus {
  const inForce = formatValue(setting.value);
  if (setting.storedReason === "prerequisite") {
    return {
      tone: "warn",
      label: "Waiting on a capability",
      detail: `You set ${formatValue(setting.storedValue)}. ${inForce} is in force until the capability it depends on is back on, and your choice applies again by itself.`,
      actor: setting.updatedBy,
    };
  }
  if (setting.storedReason === "ceiling") {
    return {
      tone: "warn",
      label: "Above the boot ceiling",
      detail: `You set ${formatValue(setting.storedValue)}. ${inForce} is in force. Raise ${setting.env} and restart to lift the ceiling.`,
      actor: setting.updatedBy,
    };
  }
  if (setting.provenance === "admin") {
    const when = setting.updatedAt?.slice(0, 10);
    const differs =
      setting.envValue !== undefined && !sameValue(setting.envValue, setting.value)
        ? ` ${setting.env} says ${formatValue(setting.envValue)}, and a reset would restore it.`
        : "";
    return {
      tone: "ok",
      label: "Changed here",
      detail: `Set by an operator${when ? ` on ${when}` : ""}.${differs}`,
      actor: setting.updatedBy,
    };
  }
  // The restart clause finishes this sentence rather than being appended by the component, so the
  // whole of what a row says about itself is written, and tested, in one place.
  const restart = setting.editable ? "" : " A restart is the only way to change it.";
  return setting.configured
    ? {
        tone: "neutral",
        label: "From the environment",
        detail: `${setting.env} supplies this.${restart}`,
      }
    : {
        tone: "neutral",
        label: "Built-in default",
        detail: `${setting.env} is not set in this server's environment.${restart}`,
      };
}

/**
 * Refusals split into the rows that will render them, and the ones no row will.
 *
 * The second half is the point. A refusal naming a key the server did not report has nowhere to
 * land, and silently dropping it would leave an operator staring at a save that failed with nothing
 * on screen to say why. It lives here rather than in the panel body because that is the difference
 * between a rule with a test and a rule with a comment.
 */
export function issuesByRow(
  issues: readonly FieldIssue[],
  settings: readonly AdminSetting[],
): { byKey: Map<string, FieldIssue[]>; orphaned: FieldIssue[] } {
  const keys = new Set(settings.map((s) => s.key));
  const byKey = new Map<string, FieldIssue[]>();
  const orphaned: FieldIssue[] = [];
  for (const issue of issues) {
    if (!keys.has(issue.key)) {
      orphaned.push(issue);
      continue;
    }
    const list = byKey.get(issue.key);
    if (list) list.push(issue);
    else byKey.set(issue.key, [issue]);
  }
  return { byKey, orphaned };
}

export interface SettingRow {
  setting: AdminSetting;
  entry: ResolvedEntry;
}
export interface SettingSection {
  group: string;
  rows: SettingRow[];
}

/**
 * The rows in the order they render, split into sections.
 *
 * Sections follow {@link GROUPS}; within a section the server's own order is kept, which is the
 * registry's grouped declaration order. A group nobody's rows landed in is dropped rather than
 * rendered empty, so a server that does not report a field simply has a shorter page.
 *
 * **A group name the catalog invents falls into {@link OTHER} rather than off the page.** Rendering
 * only the declared list is what puts the sections in a sensible order, and it would also make one
 * mistyped group name in a 69-entry table delete a setting from the screen silently. Bucketing the
 * stragglers costs a lookup and turns that class of typo into a visibly misfiled row.
 */
export function sections(settings: readonly AdminSetting[]): SettingSection[] {
  const unlisted: SettingRow[] = [];
  const byGroup = new Map<string, SettingRow[]>(
    GROUPS.map((group) => [group, group === OTHER ? unlisted : []]),
  );
  for (const setting of settings) {
    const entry = entryFor(setting);
    (byGroup.get(entry.group) ?? unlisted).push({ setting, entry });
  }
  return [...byGroup]
    .filter(([, rows]) => rows.length > 0)
    .map(([group, rows]) => ({ group, rows }));
}
