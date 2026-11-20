"use client";

import type { PlaceAtlasPreview, PlaceAtlasSurveyResult } from "@beaconsgg/protocol-types";
import { CheckIcon } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { mutate } from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Did, ErrorText, Field, Panel, StateWord } from "@/components/primitives";
import { ApiError, describeApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { mediaRoom } from "@/features/dashboard";
import { useAdminStatus } from "@/features/servers";
import { useWallet } from "@/features/wallet";
import {
  atlasPinsKey,
  importAtlas,
  inspectAtlas,
  snapshotsKey,
  surveyAtlas,
  unpinAtlas,
  uploadAtlas,
} from "./api";
import {
  MAX_IMPORT_CELLS,
  NO_CONTENT_FILTERS,
  SWITCH_KEYS,
  anyContentFilter,
  anyTypeLeftOut,
  switchHint,
  switchLabel,
  switchState,
  buildImportOptions,
  buildImportParams,
  describeSkipped,
  describeSwitches,
  estimateImport,
  formatBytes,
  resolveAtlasTarget,
  selectAllTypes,
  skipTypeLabel,
  typeRowsFromPreview,
  typeRowsFromSurvey,
  wireTypes,
  type AtlasContentFilters,
  type AtlasSwitchKey,
  type AtlasImportEstimate,
  type AtlasTarget,
  type AtlasTypeSelection,
} from "./atlasImportLogic";
import { AtlasTypePicker } from "./AtlasTypePicker";
import { AtlasVolumeReview } from "./AtlasVolumeReview";
import { parseGeohashPrefixes } from "./logic";

/** How often a running survey is polled. */
const SURVEY_POLL_MS = 1000;
/** Statuses that mean the server predates `places.atlas.survey`, not that the survey failed. */
const NO_SURVEY_OP = new Set([404, 405, 501]);
/** Coverage chips shown before the rest fold into a disclosure. */
const CHIPS_SHOWN = 32;

/**
 * Where step 3 stands. `unavailable` (the server has no survey op) and `skipped` (the operator went
 * on without one) both open step 4 without counts.
 */
type SurveyState =
  | { kind: "idle" }
  | { kind: "running"; tilesDone: number; tilesTotal: number }
  | { kind: "done"; result: PlaceAtlasSurveyResult }
  | { kind: "failed"; error: string }
  | { kind: "unavailable" }
  | { kind: "skipped" };

type StepState = "done" | "current" | "locked";

/** One numbered step: always shows its title and one-line explanation, its body only once reached. */
function Step({
  n,
  title,
  hint,
  state,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  state: StepState;
  children?: ReactNode;
}) {
  return (
    <li
      className={cn(
        "relative border-l-2 pb-6 pl-6 last:pb-0",
        state === "done"
          ? "border-status-ok"
          : state === "current"
            ? "border-primary"
            : "border-line-2",
      )}
    >
      <span
        className={cn(
          "absolute top-0 -left-[13px] flex size-6 items-center justify-center rounded-full border-2 bg-card font-mono text-[11px]",
          state === "done"
            ? "border-status-ok text-status-ok"
            : state === "current"
              ? "border-primary text-foreground"
              : "border-line-2 text-muted-foreground",
        )}
        aria-hidden
      >
        {state === "done" ? <CheckIcon className="size-3.5" /> : n}
      </span>
      <h3 className={cn("text-sm font-medium", state === "locked" && "text-muted-foreground")}>
        {title}
      </h3>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {state !== "locked" && children ? <div className="mt-3 space-y-3">{children}</div> : null}
    </li>
  );
}

/** An include/skip choice for one content filter. */
function SkipSelect({
  label,
  skip,
  onChange,
}: {
  label: string;
  skip: boolean;
  onChange: (skip: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Select value={skip ? "skip" : "include"} onValueChange={(v) => onChange(v === "skip")}>
        <SelectTrigger size="sm" className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="include">Include</SelectItem>
          <SelectItem value="skip">Skip</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/** A labelled switch, the state it is in, and what that state does. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint: ReactNode;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 text-sm ${disabled ? "text-muted-foreground" : ""}`}>
      <Switch className="mt-0.5" checked={checked} onCheckedChange={onChange} disabled={disabled} />
      <span>
        {label}
        {/* The switch announces its own state; the word is for the eye. */}
        <StateWord on={checked} className="ml-2" aria-hidden />
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Import an Atlas volume at runtime: no server configuration, no redeploy. Five steps, each opening
 * once the one before it is settled, because a run over a large volume is long and the operator
 * should know exactly what it will take before starting it:
 *
 * 1. choose the volume (a hosted URL, usually its root; an archive or a mounted tree otherwise),
 * 2. review what the preview says about it, above all **who signed it**: importing pins that did
 *    for the volume forever after (`places.atlas.unpin` is the deliberate escape),
 * 3. choose the area, and survey it (a background job on the server, polled here),
 * 4. choose the place types and content to take, with the survey's counts,
 * 5. confirm the summary and import.
 *
 * Editing an earlier step discards everything after it. The run itself lands in Recent runs below.
 */
export function AtlasImportCard({
  origin,
  serverCoverage,
}: {
  origin: string;
  /** The server's advertised coverage: the pinned descriptor copy the panel's server holds. */
  serverCoverage: string[];
}) {
  const { wallet } = useWallet();
  const status = useAdminStatus(origin).data;
  const room = status ? mediaRoom(status.counts)?.room : undefined;
  const serverArea = serverCoverage.filter((prefix) => prefix !== "").join(", ");

  const [url, setUrl] = useState("");
  const [path, setPath] = useState("");
  // The target is captured when inspect/upload succeeds, so later steps name exactly what was
  // previewed, never the live fields (whose edits discard the preview anyway).
  const [volume, setVolume] = useState<
    { preview: PlaceAtlasPreview; target: AtlasTarget } | undefined
  >(undefined);
  // Pre-filled from the server's own advertised coverage, so "import just what this server covers"
  // is the default gesture. `[""]` means "everywhere" there, which here is the blank input.
  const [area, setArea] = useState(serverArea);
  const [survey, setSurvey] = useState<SurveyState>({ kind: "idle" });
  const [selection, setSelection] = useState<AtlasTypeSelection>({});
  const [filters, setFilters] = useState<AtlasContentFilters>(NO_CONTENT_FILTERS);
  const [importPhotos, setImportPhotos] = useState(true);
  const [retireMissing, setRetireMissing] = useState(true);
  // Off by default: a filter normally leaves what it skips alone. On is the clean-up for an
  // earlier import that forgot a filter.
  const [retireFiltered, setRetireFiltered] = useState(false);
  // Off by default for the same reason: the clean-up for an earlier import that took a type this
  // one leaves out.
  const [retireUnselectedTypes, setRetireUnselectedTypes] = useState(false);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  // Bumped to abandon a running survey poll: cancel, an area edit, a new volume, or unmount.
  const pollGeneration = useRef(0);
  useEffect(() => () => void (pollGeneration.current += 1), []);

  const preview = volume?.preview;
  const parsedArea = useMemo(() => parseGeohashPrefixes(area), [area]);
  const surveyResult = survey.kind === "done" ? survey.result : undefined;
  const rows = useMemo(
    () =>
      surveyResult ? typeRowsFromSurvey(surveyResult) : preview ? typeRowsFromPreview(preview) : [],
    [surveyResult, preview],
  );
  const types = useMemo(() => wireTypes(rows, selection), [rows, selection]);
  const estimate = useMemo(
    () => (surveyResult ? estimateImport(surveyResult, types, filters) : undefined),
    [surveyResult, types, filters],
  );

  const areaProblem =
    parsedArea.invalid.length > 0
      ? `Not geohash prefixes: ${parsedArea.invalid.join(", ")}`
      : parsedArea.prefixes.length > MAX_IMPORT_CELLS
        ? `At most ${MAX_IMPORT_CELLS} prefixes (${parsedArea.prefixes.length} given)`
        : undefined;

  const step1: StepState = volume ? "done" : "current";
  const step2: StepState = !preview ? "locked" : preview.pin === "mismatch" ? "current" : "done";
  const surveySettled =
    survey.kind === "done" || survey.kind === "unavailable" || survey.kind === "skipped";
  const step3: StepState = step2 !== "done" ? "locked" : surveySettled ? "done" : "current";
  const step4: StepState =
    step3 !== "done" ? "locked" : types.problems.length > 0 ? "current" : "done";
  const step5: StepState = step4 !== "done" ? "locked" : "current";

  /** Stop polling and forget the survey and everything chosen from it. */
  const resetFromSurvey = () => {
    pollGeneration.current += 1;
    setSurvey({ kind: "idle" });
    setSelection({});
    setFilters(NO_CONTENT_FILTERS);
    setRetireFiltered(false);
    setRetireUnselectedTypes(false);
  };
  // Selecting every type again also clears retireUnselectedTypes, for the same reason as below.
  const updateSelection = (next: AtlasTypeSelection) => {
    setSelection(next);
    if (!anyTypeLeftOut(wireTypes(rows, next))) setRetireUnselectedTypes(false);
  };
  // Clearing the last content filter also clears retireFiltered, so the switch never comes back
  // on by itself when a filter is set again later.
  const updateFilters = (next: AtlasContentFilters) => {
    setFilters(next);
    if (!anyContentFilter(next)) setRetireFiltered(false);
  };
  const resetFromVolume = () => {
    resetFromSurvey();
    setVolume(undefined);
    setImportPhotos(true);
    setRetireMissing(true);
  };

  const act = async (label: string, run: () => Promise<void>) => {
    setError(undefined);
    setBusy(label);
    try {
      await run();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(undefined);
    }
  };

  const inspect = (at: { url: string } | { path: string }) =>
    act("Inspecting", async () => {
      resetFromVolume();
      setVolume({ preview: await inspectAtlas(origin, wallet!, at), target: at });
    });

  const upload = (file: File) =>
    act("Uploading", async () => {
      resetFromVolume();
      const staged = await uploadAtlas(origin, wallet!, file);
      setVolume({ preview: staged.preview, target: { staged: staged.staged } });
    });

  /** Open step 4 without counts: types from the preview, all of them ticked. */
  const continueWithoutSurvey = (kind: "unavailable" | "skipped") => {
    if (!preview) return;
    pollGeneration.current += 1;
    setSurvey({ kind });
    setSelection(selectAllTypes(typeRowsFromPreview(preview)));
  };

  const runSurvey = async () => {
    if (!volume || areaProblem) return;
    setError(undefined);
    const generation = ++pollGeneration.current;
    const params = {
      ...resolveAtlasTarget(volume.target, volume.preview),
      ...(parsedArea.prefixes.length > 0 ? { cells: parsedArea.prefixes } : {}),
    };
    setSurvey({ kind: "running", tilesDone: 0, tilesTotal: 0 });
    try {
      for (;;) {
        const s = await surveyAtlas(origin, wallet!, params);
        if (generation !== pollGeneration.current) return;
        if (s.status === "done" && s.result) {
          setSurvey({ kind: "done", result: s.result });
          setSelection(selectAllTypes(typeRowsFromSurvey(s.result)));
          return;
        }
        if (s.status !== "running") {
          setSurvey({ kind: "failed", error: s.error ?? "The survey stopped without a result." });
          return;
        }
        setSurvey({ kind: "running", tilesDone: s.tilesDone, tilesTotal: s.tilesTotal });
        await new Promise((resolve) => setTimeout(resolve, SURVEY_POLL_MS));
        if (generation !== pollGeneration.current) return;
      }
    } catch (err) {
      if (generation !== pollGeneration.current) return;
      if (err instanceof ApiError && NO_SURVEY_OP.has(err.status))
        continueWithoutSurvey("unavailable");
      else setSurvey({ kind: "failed", error: describeApiError(err) });
    }
  };

  const doImport = () =>
    act("Starting the import", async () => {
      if (!volume || areaProblem || types.problems.length > 0) return;
      await importAtlas(
        origin,
        wallet!,
        buildImportParams({
          target: volume.target,
          preview: volume.preview,
          cells: parsedArea.prefixes,
          categories: types.categories,
          options,
        }),
      );
      toast.success(
        `Importing ${volume.preview.volume}@${volume.preview.version}, watch Recent runs`,
      );
      resetFromVolume();
      setArea(serverArea);
      // The pin lands at confirm time and the run just enqueued: tell both cards below now;
      // neither polls until it can already see something moving.
      void mutate(atlasPinsKey(origin, wallet!.account.did));
      void mutate(snapshotsKey(origin, wallet!.account.did));
    });

  const doUnpin = () =>
    act("Unpinning", async () => {
      if (!preview) return;
      await unpinAtlas(origin, wallet!, preview.volume);
      toast.success(`Unpinned ${preview.volume}, inspect again to re-confirm`);
      resetFromVolume();
      void mutate(atlasPinsKey(origin, wallet!.account.did));
    });

  const addPrefix = (prefix: string) => {
    if (parsedArea.prefixes.includes(prefix)) return;
    setArea(area.trim() ? `${area.trim().replace(/,$/, "")}, ${prefix}` : prefix);
    resetFromSurvey();
  };
  const coverage = preview?.coverage ?? [];
  const chip = (prefix: string) => (
    <Button
      key={prefix}
      variant="outline"
      size="xs"
      className="font-mono"
      disabled={parsedArea.prefixes.includes(prefix)}
      onClick={() => addPrefix(prefix)}
    >
      + {prefix}
    </Button>
  );

  const disabled = !wallet || busy !== undefined;
  // The options the import will send, built once: the switches, the confirm summary and the request
  // all read this one object.
  const options = buildImportOptions({
    skipTypes: types.skipTypes,
    filters,
    importPhotos,
    retireMissing,
    retireFiltered,
    categories: types.categories,
    retireUnselectedTypes,
  });
  const sent = { categories: types.categories, options };
  const skipped = describeSkipped(options);
  const switches = describeSwitches(sent);
  const setSwitch: Record<AtlasSwitchKey, (on: boolean) => void> = {
    importPhotos: setImportPhotos,
    retireMissing: setRetireMissing,
    retireFiltered: setRetireFiltered,
    retireUnselectedTypes: setRetireUnselectedTypes,
  };

  return (
    <Panel title="Atlas: import a volume">
      <p className="mb-4 text-sm text-muted-foreground">
        A regional import can take hours to complete, mostly downloading photos. It runs in the
        background on the server, so you can leave this page and follow it in Recent runs.
      </p>
      <ol className="ml-3">
        <Step
          n={1}
          title="Choose a volume"
          hint="Point at a hosted volume. Its root URL follows the latest version; a version URL pins one."
          state={step1}
        >
          <Field label="Hosted volume URL">
            <div className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  resetFromVolume();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && url.trim() && !disabled)
                    void inspect({ url: url.trim() });
                }}
                placeholder="https://…/us-west/"
                className="font-mono"
              />
              <Button
                disabled={disabled || !url.trim()}
                onClick={() => void inspect({ url: url.trim() })}
              >
                Inspect
              </Button>
            </div>
          </Field>
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Other sources: an archive file, or a tree the server has mounted
            </summary>
            <div className="mt-2 space-y-3">
              <Field label="Volume archive (.zip, from `cartographer pack`)">
                <Input
                  type="file"
                  accept=".zip,application/zip"
                  disabled={disabled}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                    e.target.value = ""; // the same file can be re-picked after a failure
                  }}
                />
              </Field>
              <Field label="Mounted path (under the server's BEACON_ATLAS_VOLUMES_DIR, the fast local import)">
                <div className="flex gap-2">
                  <Input
                    value={path}
                    onChange={(e) => {
                      setPath(e.target.value);
                      resetFromVolume();
                    }}
                    placeholder="us-west   (or . for the dir itself)"
                    className="font-mono"
                  />
                  <Button
                    variant="outline"
                    disabled={disabled || !path.trim()}
                    onClick={() => void inspect({ path: path.trim() })}
                  >
                    Inspect
                  </Button>
                </div>
              </Field>
            </div>
          </details>
        </Step>

        <Step
          n={2}
          title="Review the volume"
          hint="Check what it holds and who signed it. Importing pins this publisher for the volume."
          state={step2}
        >
          {preview ? (
            <AtlasVolumeReview
              preview={preview}
              busy={busy !== undefined}
              onUnpin={() => void doUnpin()}
            />
          ) : null}
        </Step>

        <Step
          n={3}
          title="Choose the area"
          hint="Limit the import to geohash prefixes, then survey the area to see what it holds."
          state={step3}
        >
          <Field label="Geohash prefixes (blank imports the whole volume)">
            <Input
              value={area}
              onChange={(e) => {
                setArea(e.target.value);
                resetFromSurvey();
              }}
              placeholder="e.g. 9q5, 9q4c"
              className="max-w-md font-mono"
            />
          </Field>
          {areaProblem ? <p className="text-xs text-destructive">{areaProblem}</p> : null}
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="outline"
              size="xs"
              disabled={!area.trim()}
              onClick={() => {
                setArea("");
                resetFromSurvey();
              }}
            >
              Whole volume
            </Button>
            {serverArea && area !== serverArea ? (
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  setArea(serverArea);
                  resetFromSurvey();
                }}
              >
                This server&apos;s coverage
              </Button>
            ) : null}
            {coverage.length > 0 ? (
              <span className="ml-2 text-xs text-muted-foreground">Volume coverage:</span>
            ) : null}
            {coverage.slice(0, CHIPS_SHOWN).map(chip)}
          </div>
          {coverage.length > CHIPS_SHOWN ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                {coverage.length - CHIPS_SHOWN} more coverage prefixes
              </summary>
              <div className="mt-1 flex flex-wrap gap-1">
                {coverage.slice(CHIPS_SHOWN).map(chip)}
              </div>
            </details>
          ) : null}

          {survey.kind === "running" ? (
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-[width]"
                    style={{
                      width:
                        survey.tilesTotal > 0
                          ? `${Math.floor((survey.tilesDone / survey.tilesTotal) * 100)}%`
                          : "0%",
                    }}
                  />
                </div>
                <Button variant="ghost" size="xs" onClick={resetFromSurvey}>
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {survey.tilesTotal > 0
                  ? `Surveying: ${survey.tilesDone.toLocaleString()} of ${survey.tilesTotal.toLocaleString()} tiles read`
                  : "Starting the survey…"}
              </p>
            </div>
          ) : survey.kind === "done" ? (
            <SurveySummary result={survey.result} preview={preview} />
          ) : survey.kind === "unavailable" ? (
            <p className="text-xs text-muted-foreground">
              This server cannot survey volumes (it predates the survey op), so counts are
              unavailable. You can still choose place types and filters.
            </p>
          ) : survey.kind === "skipped" ? (
            <p className="text-xs text-muted-foreground">
              Survey skipped: the next steps work without counts.{" "}
              <button type="button" className="underline" onClick={resetFromSurvey}>
                Survey after all
              </button>
            </p>
          ) : (
            <div className="space-y-1">
              {survey.kind === "failed" ? (
                <p className="text-xs text-destructive">Survey failed: {survey.error}</p>
              ) : null}
              <div className="flex items-center gap-2">
                <Button disabled={disabled || !!areaProblem} onClick={() => void runSurvey()}>
                  Survey this area
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!areaProblem}
                  onClick={() => continueWithoutSurvey("skipped")}
                >
                  Skip, continue without counts
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The server reads every tile in the area once; a large area takes a while.
              </p>
            </div>
          )}
        </Step>

        <Step
          n={4}
          title="Choose what to import"
          hint="Pick place types and which places to skip. Counts follow your filters."
          state={step4}
        >
          <AtlasTypePicker
            rows={rows}
            selection={selection}
            onChange={updateSelection}
            survey={surveyResult}
            filters={filters}
          />
          {types.problems.map((p) => (
            <p key={p} className="text-xs text-destructive">
              {p}
            </p>
          ))}

          <div className="max-w-md space-y-2">
            <SkipSelect
              label="Places without photos"
              skip={filters.requirePhotos}
              onChange={(skip) => updateFilters({ ...filters, requirePhotos: skip })}
            />
            <SkipSelect
              label="Places without a name"
              skip={filters.requireName}
              onChange={(skip) => updateFilters({ ...filters, requireName: skip })}
            />
            <SkipSelect
              label="Places without a description"
              skip={filters.requireDescription}
              onChange={(skip) => updateFilters({ ...filters, requireDescription: skip })}
            />
          </div>

          <div className="space-y-3">
            {SWITCH_KEYS.map((key) => {
              const state = switchState(key, sent);
              return (
                <Toggle
                  key={key}
                  label={switchLabel(key)}
                  checked={state === "on"}
                  disabled={state === "unavailable"}
                  onChange={setSwitch[key]}
                  hint={switchHint(key, state, estimate)}
                />
              );
            })}
          </div>
        </Step>

        <Step
          n={5}
          title="Confirm and import"
          hint="Check the summary. The run starts in the background and shows in Recent runs."
          state={step5}
        >
          {volume ? (
            <div className="space-y-3">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Volume</dt>
                <dd className="min-w-0 break-all">
                  <span className="font-mono">
                    {volume.preview.volume}@{volume.preview.version}
                  </span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {"url" in volume.target
                      ? (volume.preview.versionUrl ?? volume.target.url)
                      : "staged" in volume.target
                        ? "uploaded archive"
                        : `mounted path ${volume.target.path}`}
                  </span>
                </dd>
                <dt className="text-muted-foreground">Publisher</dt>
                <dd>
                  <Did value={volume.preview.publisher} />
                  {volume.preview.pin === "new" ? (
                    <span className="ml-2 text-xs text-status-warn">pinned by this import</span>
                  ) : null}
                </dd>
                <dt className="text-muted-foreground">Area</dt>
                <dd className="font-mono">
                  {parsedArea.prefixes.length > 0 ? parsedArea.prefixes.join(", ") : "whole volume"}
                </dd>
                <dt className="text-muted-foreground">Place types</dt>
                <dd>
                  {types.categories ? types.categories.join(", ") : "all supported types"}
                  {types.skipTypes ? (
                    <span className="block text-xs text-muted-foreground">
                      skipping {types.skipTypes.map(skipTypeLabel).join(", ")}
                    </span>
                  ) : null}
                </dd>
                <dt className="text-muted-foreground">Content filters</dt>
                <dd>{skipped.length > 0 ? `skipping ${skipped.join(", ")}` : "none"}</dd>
                {switches.map((sw) => (
                  <Fragment key={sw.key}>
                    <dt className="text-muted-foreground">{sw.label}</dt>
                    <dd>
                      <StateWord on={sw.on} />
                      <span className="ml-2 text-muted-foreground">{sw.effect}</span>
                    </dd>
                  </Fragment>
                ))}
                <dt className="text-muted-foreground">Estimate</dt>
                <dd>
                  {estimate ? (
                    `${estimate.places.toLocaleString()} places`
                  ) : (
                    <span className="text-muted-foreground">
                      unavailable without a survey (the whole volume holds{" "}
                      {volume.preview.places.toLocaleString()} places)
                    </span>
                  )}
                </dd>
              </dl>
              <ImportSize
                estimate={estimate}
                importPhotos={importPhotos}
                preview={volume.preview}
                scoped={parsedArea.prefixes.length > 0}
                room={room}
              />
              <Button
                disabled={disabled || !!areaProblem || types.problems.length > 0}
                onClick={() => void doImport()}
              >
                {estimate
                  ? `Import ${estimate.places.toLocaleString()} places`
                  : `Import ${volume.preview.volume}@${volume.preview.version}`}
              </Button>
            </div>
          ) : null}
        </Step>
      </ol>
      {busy ? <p className="mt-2 text-xs text-muted-foreground">{busy}…</p> : null}
      <ErrorText>{error}</ErrorText>
    </Panel>
  );
}

/**
 * How much the import downloads, set apart so the operator sees it before starting: a regional
 * volume's photos run to gigabytes, and that is where the hours go. `room` is what the server's
 * media limit leaves (`admin.status`), absent for a server without one: photos past it are left
 * out by the server and counted on the run, so the operator is told before, not only after.
 */
function ImportSize({
  estimate,
  importPhotos,
  preview,
  scoped,
  room,
}: {
  estimate: AtlasImportEstimate | undefined;
  importPhotos: boolean;
  preview: PlaceAtlasPreview;
  scoped: boolean;
  room: number | undefined;
}) {
  // Without a survey only the volume's totals are known, so an area import shows them as a ceiling.
  const dataBytes = estimate ? estimate.dataBytes : (preview.tileBytes ?? 0);
  const mediaBytes = importPhotos ? (estimate ? estimate.mediaBytes : preview.mediaBytes) : 0;
  const photoFiles = estimate ? estimate.photoFiles : preview.media;
  const ceiling = !estimate && scoped;
  return (
    <div className="rounded-md border border-status-warn/40 bg-status-warn/10 p-3">
      <p className="text-xs text-muted-foreground">Download size</p>
      <p className="text-2xl font-semibold tabular-nums">
        {ceiling ? "up to " : "about "}
        {formatBytes(dataBytes + mediaBytes)}
      </p>
      <p className="text-xs text-muted-foreground">
        {formatBytes(dataBytes)} of place data
        {importPhotos
          ? ` and ${formatBytes(mediaBytes)} of photos (${photoFiles.toLocaleString()} files)`
          : ", photos not downloaded"}
        {ceiling ? ". This is the whole volume; survey the area for this import's size." : "."}
      </p>
      {importPhotos && room !== undefined && mediaBytes > room ? (
        <p className="mt-2 text-xs font-medium text-status-warn">
          This server has {formatBytes(room)} of room left for media, so not every photo will fit.
          The places still import; photos past the limit are left out and counted on the run, and
          importing again once there is more room fetches only those.
        </p>
      ) : null}
      <p className="mt-2 text-xs">
        Large imports can take hours to complete. The run carries on in the background on the
        server.
      </p>
    </div>
  );
}

/** What a finished survey found in the area, with each data source's share. */
function SurveySummary({
  result,
  preview,
}: {
  result: PlaceAtlasSurveyResult;
  preview: PlaceAtlasPreview | undefined;
}) {
  const sourceName = (id: string) => preview?.sources?.find((s) => s.id === id)?.name ?? id;
  return (
    <div className="space-y-1 rounded-md bg-muted px-3 py-2 text-xs">
      <p>
        <span className="font-medium">{result.places.toLocaleString()} places</span> in{" "}
        {result.cells.toLocaleString()} cells · {formatBytes(result.tileBytes)} of tile data ·{" "}
        {result.photoFiles.toLocaleString()} photo files (about{" "}
        {formatBytes(result.mediaBytesEstimate)})
      </p>
      {result.sources.length > 0 ? (
        <p className="text-muted-foreground">
          From{" "}
          {result.sources
            .map((s) => `${sourceName(s.id)} (${s.places.toLocaleString()})`)
            .join(", ")}
        </p>
      ) : null}
    </div>
  );
}
