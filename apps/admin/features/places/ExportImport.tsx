"use client";

import { placeExportSchema, placeListNameSchema } from "@beaconsgg/protocol-types";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorText, Field, Panel } from "@/components/primitives";
import { describeApiError } from "@/lib/api";
import { downloadJson, exportFilename } from "@/lib/download";
import { useWallet } from "@/features/wallet";
import { exportPlaces, importPlaces } from "./api";

/**
 * The `beacon-places/1` interchange loop (the server's places spec, beacon.server
 * `doc/spec/places.md` §7): export downloads the dataset as a GeoJSON FeatureCollection; import
 * lands a file as the `list:<name>` source with replace-the-list semantics (uniques survive the
 * hop, media re-hosts by hash).
 */
export function ExportImport({ origin }: { origin: string }) {
  const { wallet } = useWallet();
  const [listName, setListName] = useState("");
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const runExport = async () => {
    if (!wallet) return;
    setError(undefined);
    try {
      const collection = await exportPlaces(origin, wallet);
      downloadJson(exportFilename("beacon-places", origin), collection);
      setMessage(`Exported ${collection.features.length} places.`);
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  const runImport = async (file: File) => {
    if (!wallet) return;
    setError(undefined);
    setMessage(undefined);
    try {
      const name = placeListNameSchema.parse(listName);
      // Strict on purpose, not the read twin: this file is bound for a server's ACCEPT side
      // (`places.import`). Stripping a field here would silently discard something the target server
      // might have kept; a mismatch should fail loudly on the console instead.
      const collection = placeExportSchema.parse(JSON.parse(await file.text()));
      const snapshot = await importPlaces(origin, wallet, name, collection);
      setMessage(
        `Import queued as list:${name} (run ${snapshot.id}, ${collection.features.length} features) — watch it under Import & runs.`,
      );
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  return (
    <Panel title="Export / import (beacon-places/1)">
      <div className="flex flex-wrap items-end gap-3">
        <Button disabled={!wallet} onClick={() => void runExport()}>
          Export dataset
        </Button>
        <div className="flex items-end gap-2">
          <Field label="Import as list:<name>">
            <Input
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              placeholder="downtown-favorites"
            />
          </Field>
          <label
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              wallet && listName
                ? "cursor-pointer bg-muted text-foreground hover:bg-muted"
                : "cursor-not-allowed bg-muted text-muted-foreground"
            }`}
          >
            Choose file…
            <input
              type="file"
              accept="application/json,.json,.geojson"
              className="hidden"
              disabled={!wallet || !listName}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void runImport(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
      {message ? <p className="mt-2 text-sm text-status-ok">{message}</p> : null}
      <ErrorText>{error}</ErrorText>
    </Panel>
  );
}
