"use client";

import type { Wallet } from "@beaconsgg/identity";
import type { AdminSetting, SettingValue } from "@beaconsgg/protocol-types";
import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Did, ToneBadge, KICKER } from "@/components/primitives";
import { DirectoryCard } from "@/features/directory";
import { describeApiError, fieldIssues, type FieldIssue } from "@/lib/api";
import {
  ActiveServerLine,
  adminStatusKey,
  GateNotice,
  useSingleServer,
  type SavedServer,
} from "@/features/servers";
import { settingsReset, settingsSet } from "./api";
import type { ResolvedEntry } from "./catalog";
import {
  baselineOf,
  blankNumbers,
  formatValue,
  issuesByRow,
  pendingChanges,
  rowStatus,
  sections,
  type Draft,
  type DraftValue,
} from "./logic";
import { SettingControl } from "./SettingControl";
import { useSettings } from "./useSettings";

/**
 * The server configuration screen (the server's runtime settings spec, beacon.server
 * `doc/spec/runtime-settings.md` §5): the 42 editable settings with their provenance, and the 28
 * deploy-time fields read-only beside them, so one page answers both "what is this set to" and "why
 * can I not change it here". Below them, for the server's admins, the server's listing in the
 * directory.
 */
export function SettingsPanel() {
  const gate = useSingleServer({
    server: "a configuration belongs to one server",
    wallet: "reading and changing settings are signed admin ops",
  });
  if (!gate.ok) return <GateNotice>{gate.refusal}</GateNotice>;
  return (
    <div className="space-y-6">
      <Editor server={gate.server} wallet={gate.wallet} />
      <DirectoryCard server={gate.server} wallet={gate.wallet} />
    </div>
  );
}

function Editor({ server, wallet }: { server: SavedServer; wallet: Wallet }) {
  const { data, error, isLoading, mutate } = useSettings(server.origin, wallet);
  const { mutate: mutateAny } = useSWRConfig();
  const [draft, setDraft] = useState<Draft>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  /*
   * A write fails one way or the other, never both: either the server named the offending settings
   * or it did not. One slot makes that unrepresentable rather than merely true, which matters
   * because two slots means every clear site has to remember both, and the Discard button did not.
   */
  const [failure, setFailure] = useState<FieldIssue[] | string | undefined>(undefined);

  const settings = data ?? [];
  const pending = pendingChanges(settings, draft);
  const pendingKeys = Object.keys(pending);
  const blank = blankNumbers(settings, pending);

  /*
   * Both writes answer with the whole configuration, so the response replaces the cache outright and
   * nothing re-reads. That is not a saving: a write can move a field it was never sent, since
   * turning a capability off forces its dependants off with it, and a page that refreshed only the
   * rows it submitted would leave those dependants showing their old value.
   *
   * `settle` is per-op because the two ops settle differently. A save consumed the whole buffer; a
   * reset consumed one row, and clearing the buffer for it would throw away every other pending edit
   * on the screen whose entire argument is that edits collect in a buffer.
   */
  const run = async (apply: () => Promise<AdminSetting[]>, done: string, settle: () => void) => {
    // A write can move `writeLocked`, and the banner on every page reads it from the status, which
    // this screen's reply does not touch.
    const readStatus = () => void mutateAny(adminStatusKey(server.origin, wallet.account.did));
    setBusy(true);
    setFailure(undefined);
    try {
      await mutate(await apply(), false);
      settle();
      toast.success(done);
      readStatus();
    } catch (err) {
      const issues = fieldIssues(err);
      setFailure(issues ?? describeApiError(err));
      /*
       * A 400 is `setMany` refusing the whole patch before storing any of it, so the cache is still
       * true and a refetch would only cost a round trip. Anything else can have left a **partial**
       * write: the multi-key op is deliberately not atomic (beacon.server
       * `doc/spec/runtime-settings.md` §5), so a store error on key 3 of 5 leaves two rows
       * overridden with no response to show for it. Rendering the pre-write values then is the one
       * failure this screen exists to prevent.
       */
      if (!issues) {
        void mutate();
        readStatus();
      }
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(
      () => settingsSet(server.origin, wallet, pending, reason || undefined),
      `Saved ${pendingKeys.length} setting${pendingKeys.length === 1 ? "" : "s"}.`,
      () => {
        setDraft({});
        // The reason described the edits that just went. Keeping it would label the next write with
        // a sentence somebody wrote about a different one, and `reason` is the seed of an audit
        // trail the server may keep later, so a wrong one is worse than none.
        setReason("");
      },
    );

  /*
   * No reason: the field lives in the save bar, which is only on screen while there are pending
   * changes, so a reset would either carry nothing or carry a sentence about a different op. The
   * server logs the op and the key either way.
   */
  const reset = (key: string) =>
    run(
      () => settingsReset(server.origin, wallet, [key]),
      "Reset to the environment.",
      () => setDraft(({ [key]: _dropped, ...rest }) => rest),
    );

  if (error) return <p className="text-sm text-destructive">{describeApiError(error)}</p>;
  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  /*
   * Blanks ride the same per-row path as a server refusal, because they are the same thing to an
   * operator: a named field that is not ready to send. They are not merged into `failure`, which is
   * about a write that already happened.
   */
  const { byKey, orphaned } = issuesByRow(
    [
      ...(typeof failure === "string" || failure === undefined ? [] : failure),
      ...blank.map(({ key }) => ({ key, path: "", message: "This field needs a number." })),
    ],
    settings,
  );

  return (
    <div className="space-y-4">
      <ActiveServerLine server={server}>Configuring</ActiveServerLine>

      {typeof failure === "string" ? <p className="text-sm text-destructive">{failure}</p> : null}
      {orphaned.length > 0 ? (
        <p className="text-sm text-destructive">
          {orphaned.map((issue) => `${issue.key}: ${issue.message}`).join(" · ")}
        </p>
      ) : null}

      {sections(settings).map((section) => (
        <section key={section.group} className="space-y-1">
          <h2 className={`pt-2 ${KICKER}`}>{section.group}</h2>
          <Separator />
          {section.rows.map(({ setting, entry }) => (
            <Row
              key={setting.key}
              setting={setting}
              entry={entry}
              draftValue={draft[setting.key]}
              issues={byKey.get(setting.key) ?? []}
              busy={busy}
              onEdit={(next) => setDraft((d) => ({ ...d, [setting.key]: next }))}
              onRevert={() => setDraft(({ [setting.key]: _dropped, ...rest }) => rest)}
              onReset={() => void reset(setting.key)}
            />
          ))}
        </section>
      ))}

      <SaveBar
        count={pendingKeys.length}
        blocked={
          blank.length > 0
            ? `${blank.length} number field${blank.length === 1 ? " is" : "s are"} empty.`
            : undefined
        }
        busy={busy}
        reason={reason}
        onReason={setReason}
        onDiscard={() => {
          setDraft({});
          setFailure(undefined);
        }}
        onSave={() => void save()}
      />
    </div>
  );
}

function Row({
  setting,
  entry,
  draftValue,
  issues,
  busy,
  onEdit,
  onRevert,
  onReset,
}: {
  setting: AdminSetting;
  entry: ResolvedEntry;
  /** This row's pending edit, or absent when the operator has not touched it. */
  draftValue: DraftValue | undefined;
  issues: FieldIssue[];
  busy: boolean;
  onEdit: (next: SettingValue | null) => void;
  onRevert: () => void;
  onReset: () => void;
}) {
  const id = `setting-${setting.key}`;
  const status = rowStatus(setting);
  const baseline = baselineOf(setting);
  const edited = draftValue !== undefined;
  const value = edited ? draftValue : baseline;
  /*
   * `null` is the wire's "store no value", which is not a reset: the override stands and the
   * environment stays out of it. Only the free-text kinds offer it, because it is the only way to
   * empty an optional string, and a list or a number has no meaningful empty an operator would want.
   */
  /*
   * Offered while an edit is in flight too: emptying a text box by hand yields an override of `""`,
   * not of no value, and requiring Undo first to reach `null` makes the natural gesture the wrong
   * one. Hidden only once the draft is already `null`, where it would do nothing.
   */
  const canClear =
    (entry.kind === "text" || entry.kind === "textarea") &&
    baseline !== undefined &&
    draftValue !== null;

  return (
    <div className="grid gap-2 py-3 md:grid-cols-[minmax(0,20rem)_1fr] md:gap-4">
      <div className="space-y-0.5">
        {/* A read-only row renders a span, not a control, so it has no id for a label to point at. */}
        {setting.editable ? (
          <Label htmlFor={id} className="text-sm font-medium">
            {entry.label}
          </Label>
        ) : (
          <p className="text-sm font-medium">{entry.label}</p>
        )}
        <p className="font-mono text-[11px] text-muted-foreground">{setting.env}</p>
        {entry.help ? <p className="text-xs text-muted-foreground">{entry.help}</p> : null}
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {setting.editable ? (
            <>
              <div className="min-w-0 grow">
                <SettingControl
                  id={id}
                  entry={entry}
                  value={value}
                  disabled={busy}
                  onChange={onEdit}
                />
              </div>
              {entry.unit ? (
                <span className="text-xs text-muted-foreground">{entry.unit}</span>
              ) : null}
            </>
          ) : (
            <ReadOnlyValue setting={setting} />
          )}
          <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
        </div>

        {value === null ? (
          <p className="text-xs text-muted-foreground">Will be cleared to no value.</p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {status.detail}
          {status.actor ? (
            <>
              {" "}
              <Did value={status.actor} />
            </>
          ) : null}
        </p>

        {issues.map((issue, i) => (
          <p key={i} className="text-xs text-destructive">
            {issue.path ? `${issue.path}: ` : ""}
            {issue.message}
          </p>
        ))}

        {setting.editable ? (
          <div className="flex gap-3 text-xs">
            {edited ? (
              <button
                type="button"
                className="underline underline-offset-2 hover:text-muted-foreground"
                onClick={onRevert}
              >
                Undo edit
              </button>
            ) : null}
            {setting.editable && canClear ? (
              <button
                type="button"
                className="text-muted-foreground hover:underline"
                onClick={() => onEdit(null)}
              >
                Clear
              </button>
            ) : null}
            {setting.provenance === "admin" ? (
              <button
                type="button"
                className="text-muted-foreground hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={onReset}
              >
                Reset to {setting.env}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A read-only field: its value, or for a secret the one fact a read is allowed to learn. */
function ReadOnlyValue({ setting }: { setting: AdminSetting }) {
  if (setting.secret) {
    return (
      <span className="text-sm text-muted-foreground">
        {setting.configured ? "Set (withheld)" : "Not set"}
      </span>
    );
  }
  return <span className="font-mono text-sm break-all">{formatValue(setting.value)}</span>;
}

/** Sticky while there is anything to save, absent otherwise. */
function SaveBar({
  count,
  blocked,
  busy,
  reason,
  onReason,
  onDiscard,
  onSave,
}: {
  count: number;
  /** Why a save cannot go yet, when the console can tell without asking the server. */
  blocked: string | undefined;
  busy: boolean;
  reason: string;
  onReason: (next: string) => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="sticky bottom-0 z-20 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">
          {count} pending change{count === 1 ? "" : "s"}
        </span>
        {blocked ? <span className="text-sm text-destructive">{blocked}</span> : null}
        <Input
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          aria-label="Reason for this change (audit log)"
          placeholder="Reason (audit log)"
          className="h-9 max-w-xs"
        />
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onDiscard} disabled={busy}>
            Discard
          </Button>
          <Button onClick={onSave} disabled={busy || blocked !== undefined}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
