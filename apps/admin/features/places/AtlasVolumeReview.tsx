"use client";

import type { PlaceAtlasPreview } from "@beaconsgg/protocol-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Did, Facts, KICKER, ToneBadge } from "@/components/primitives";
import { formatBytes } from "./atlasImportLogic";

/** How many coverage prefixes / subcategories show before the rest fold into a disclosure. */
const SHOWN = 24;

/** A list of slugs as quiet badges, the tail folded away when it is long. */
function SlugList({ values }: { values: string[] }) {
  const badges = (list: string[]) =>
    list.map((v) => (
      <Badge key={v} variant="outline">
        {v}
      </Badge>
    ));
  return (
    <div className="flex flex-wrap gap-1">
      {badges(values.slice(0, SHOWN))}
      {values.length > SHOWN ? (
        <details className="w-full">
          <summary className="cursor-pointer text-muted-foreground">
            {values.length - SHOWN} more
          </summary>
          <div className="mt-1 flex flex-wrap gap-1">{badges(values.slice(SHOWN))}</div>
        </details>
      ) : null}
    </div>
  );
}

const count = (n: number | undefined) => (n === undefined ? undefined : n.toLocaleString());

/**
 * Step 2 of the import: everything the inspect preview says about the volume, grouped. The trust
 * half (who signed it and how that compares to the pin) leads, since a mismatch stops the flow here.
 */
export function AtlasVolumeReview({
  preview,
  busy,
  onUnpin,
}: {
  preview: PlaceAtlasPreview;
  busy: boolean;
  onUnpin: () => void;
}) {
  const { bounds } = preview;
  return (
    <div className="space-y-4 rounded-md border border-line-2 p-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono">
            {preview.volume}@{preview.version}
          </span>
          <span className="text-xs text-muted-foreground">signed by</span>
          <Did value={preview.publisher} />
          {preview.pin === "new" ? (
            <ToneBadge tone="warn">new publisher, importing pins this key</ToneBadge>
          ) : preview.pin === "pinned" ? (
            <ToneBadge tone="ok">matches the pinned publisher</ToneBadge>
          ) : (
            <ToneBadge tone="error">DOES NOT match the pinned publisher</ToneBadge>
          )}
        </div>
        {preview.pin === "mismatch" ? (
          <div className="space-y-1 text-xs">
            <p className="text-destructive">
              This volume is pinned to <Did value={preview.pinnedPublisher ?? ""} />. A different
              key signing the same volume is exactly what the pin exists to catch, so the import
              stops here. Only unpin if you know the publisher rotated keys on purpose.
            </p>
            <Button
              variant="ghost"
              size="xs"
              className="text-destructive"
              disabled={busy}
              onClick={onUnpin}
            >
              Unpin {preview.volume}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Facts
          title="Version"
          rows={[
            ["Revision", count(preview.revision)],
            [
              "Created",
              preview.createdAt ? new Date(preview.createdAt).toLocaleString() : undefined,
            ],
            [
              "Version URL",
              preview.versionUrl ? (
                <a
                  href={preview.versionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono break-all underline-offset-2 hover:underline"
                >
                  {preview.versionUrl}
                </a>
              ) : undefined,
            ],
          ]}
        />
        <Facts
          title="Size"
          rows={[
            ["Places", count(preview.places)],
            ["Cells", count(preview.cells)],
            [
              "Photos",
              `${preview.media.toLocaleString()} files (${formatBytes(preview.mediaBytes)})`,
            ],
            [
              "Tile data",
              preview.tileBytes === undefined ? undefined : formatBytes(preview.tileBytes),
            ],
            [
              "Outline cells",
              preview.geometryCells === undefined
                ? undefined
                : `${preview.geometryCells.toLocaleString()} (polygon outlines, not imported yet)`,
            ],
            [
              "Retired",
              preview.retired === undefined
                ? undefined
                : `${preview.retired.toLocaleString()} places removed since an earlier version`,
            ],
          ]}
        />
        <Facts
          title="Area"
          rows={[
            [
              "Bounds",
              bounds ? (
                <span className="font-mono">
                  lat {bounds.minLat.toFixed(3)} to {bounds.maxLat.toFixed(3)}, lng{" "}
                  {bounds.minLng.toFixed(3)} to {bounds.maxLng.toFixed(3)}
                </span>
              ) : undefined,
            ],
            ["Cell precision", count(preview.cellPrecision)],
            [
              "Coverage",
              preview.coverage && preview.coverage.length > 0 ? (
                <SlugList values={preview.coverage} />
              ) : undefined,
            ],
          ]}
        />
        <Facts
          title="Place types"
          rows={[
            [
              "Categories",
              preview.categories && preview.categories.length > 0 ? (
                <SlugList values={preview.categories} />
              ) : undefined,
            ],
            [
              "Subcategories",
              preview.subcategories && preview.subcategories.length > 0 ? (
                <SlugList values={preview.subcategories} />
              ) : undefined,
            ],
          ]}
        />
      </div>

      {preview.sources && preview.sources.length > 0 ? (
        <div>
          <h4 className={`${KICKER} mb-1`}>Data sources</h4>
          <ul className="space-y-1 text-xs">
            {preview.sources.map((s) => (
              <li key={s.id}>
                <span className="font-medium">{s.name}</span>{" "}
                <span className="font-mono text-muted-foreground">({s.id})</span>: {s.attribution}.{" "}
                {s.licenseUrl ? (
                  <a
                    href={s.licenseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    {s.license}
                  </a>
                ) : (
                  s.license
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview.inputs && preview.inputs.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Built from {preview.inputs.length} upstream{" "}
            {preview.inputs.length === 1 ? "file" : "files"}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {preview.inputs.map((input) => (
              <li key={`${input.source}:${input.artifact}`} className="break-all">
                <span className="text-muted-foreground">{input.source}</span>{" "}
                <span className="font-mono">{input.artifact}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
