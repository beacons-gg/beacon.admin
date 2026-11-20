"use client";

import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./worker";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { RadioIcon, Settings2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { loadJson, saveJson } from "@/lib/storage";
import type { FeatureCollection } from "./logic";
import type { Inspect } from "./InspectPanel";
import { boundsToBBox, viewCells } from "./logic";

/**
 * The controlled MapLibre canvas (the pane-of-glass, refactored out of the old MapPanel so the
 * Explore hub can drive it alongside a results list). It owns only the map lifecycle: it reports
 * the viewport's query cells up, renders the collections + selection geometry it's given, and
 * reports clicks up. Data fetching, filters, and selection state live in the parent: it draws every
 * feature it is handed, in the fill the feature carries.
 *
 * Tiles default to the OSM raster server, drawn dark; a custom style URL is persisted — the console never
 * requires a token.
 */

export const OSM_RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  // Drawn dark to sit in the dark console: brightness min and max swapped invert the tile, and no
  // saturation leaves it gray, so the data is the only color on it.
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
      paint: {
        "raster-brightness-min": 0.92,
        "raster-brightness-max": 0.04,
        "raster-saturation": -1,
        "raster-contrast": 0.1,
      },
    },
  ],
};

const STYLE_KEY = "beacon-admin.map-style";
const VIEW_KEY = "beacon-admin.map-view";
const viewSchema = z.object({ lng: z.number(), lat: z.number(), zoom: z.number() });

const LAYERS = ["rooms", "scouts", "places"] as const;

export interface MapCanvasProps {
  collections: Record<(typeof LAYERS)[number], FeatureCollection>;
  selectionGeometry: GeoJSON.FeatureCollection;
  onCellsChange: (cells: string[]) => void;
  onSelect: (inspect: Inspect) => void;
  serverLegend: { label: string; color: string }[];
  /** What the marker fills mean: places, scouts, and the room groups being coloured. */
  fillLegend: { key: string; label: string; color: string }[];
  statusText: string;
  refreshing: boolean;
  /** Fly the camera here when `key` changes (a selection from the list or map). */
  focus?: { lng: number; lat: number; key: string } | undefined;
}

export function MapCanvas({
  collections,
  selectionGeometry,
  onCellsChange,
  onSelect,
  serverLegend,
  fillLegend,
  statusText,
  refreshing,
  focus,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map>(null);
  const [styleUrl, setStyleUrl] = useState("");

  // Refs mirror the latest props so a style swap (which wipes sources) can repopulate immediately.
  const collectionsRef = useRef(collections);
  const selectionRef = useRef(selectionGeometry);
  const onCellsRef = useRef(onCellsChange);
  const onSelectRef = useRef(onSelect);
  onCellsRef.current = onCellsChange;
  onSelectRef.current = onSelect;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const pulseFrameRef = useRef<number | null>(null);

  /** A one-point (or empty) FeatureCollection for the selected-marker highlight. */
  const pointFC = (p: MapCanvasProps["focus"]): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: p
      ? [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [p.lng, p.lat] },
            properties: {},
          },
        ]
      : [],
  });

  /** The beacon pulse: expand + fade the selection ring each frame while something is selected. */
  const animatePulse = () => {
    const map = mapRef.current;
    if (!map || !map.getLayer("selected-pulse")) return;
    const t = (performance.now() % 1600) / 1600;
    map.setPaintProperty("selected-pulse", "circle-radius", 12 + t * 22);
    map.setPaintProperty("selected-pulse", "circle-stroke-opacity", 0.5 * (1 - t));
    pulseFrameRef.current = requestAnimationFrame(animatePulse);
  };

  // Map lifecycle: init once, restore the persisted view + style, wire moveend → query cells.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const savedView = loadJson(VIEW_KEY, viewSchema);
    const savedStyle = loadJson(STYLE_KEY, z.string());
    setStyleUrl(savedStyle ?? "");
    const map = new maplibregl.Map({
      container,
      style: savedStyle || OSM_RASTER_STYLE,
      center: savedView ? [savedView.lng, savedView.lat] : [0, 20],
      zoom: savedView?.zoom ?? 1.5,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "bottom-right");

    for (const id of LAYERS) {
      map.on("click", id, (e: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const props = e.features?.[0]?.properties as Inspect | undefined;
        if (props) onSelectRef.current(props);
      });
      map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
    }

    let lastCellsKey = "";
    const syncCells = () => {
      const b = map.getBounds();
      const next = viewCells(
        boundsToBBox(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()),
        map.getZoom(),
      );
      const key = next.join(",");
      if (key !== lastCellsKey) {
        lastCellsKey = key;
        onCellsRef.current(next);
      }
      const center = map.getCenter();
      saveJson(VIEW_KEY, { lng: center.lng, lat: center.lat, zoom: map.getZoom() });
    };

    // MapLibre measures the container at construction; in this flex layout it can be zero-height
    // until the layout settles (tiles load but nothing paints), and a later resize (fill-on-mount,
    // sidebar collapse, window resize) changes the map's bounds without firing `moveend`. Resize
    // AND re-sync the query cells, or they stay pinned to the initial (smaller) viewport and fetch a
    // region offset from what's shown. The observer's initial callback also corrects the construction.
    const resizeObserver = new ResizeObserver(() => {
      map.resize();
      syncCells();
    });
    resizeObserver.observe(container);

    const addLayers = () => {
      if (!map.getSource("selection")) {
        map.addSource("selection", { type: "geojson", data: selectionRef.current });
        map.addLayer({
          id: "selection-fill",
          type: "fill",
          source: "selection",
          paint: { "fill-color": "#0e9fe0", "fill-opacity": 0.15 },
        });
        map.addLayer({
          id: "selection-line",
          type: "line",
          source: "selection",
          paint: { "line-color": "#0e9fe0", "line-width": 2 },
        });
      }
      for (const id of LAYERS) {
        if (map.getSource(id)) continue;
        map.addSource(id, { type: "geojson", data: collectionsRef.current[id] });
        map.addLayer({
          id,
          type: "circle",
          source: id,
          paint: {
            "circle-radius": id === "places" ? 5 : 7,
            "circle-color": ["get", "color"],
            "circle-stroke-width": 2,
            "circle-stroke-color": ["get", "originColor"],
            "circle-opacity": 0.85,
          },
        });
      }
      // Selected-marker highlight — a gold ring + beacon pulse, drawn on top of the markers.
      if (!map.getSource("selected")) {
        map.addSource("selected", { type: "geojson", data: pointFC(focusRef.current) });
        map.addLayer({
          id: "selected-pulse",
          type: "circle",
          source: "selected",
          paint: {
            "circle-radius": 16,
            "circle-opacity": 0,
            "circle-stroke-color": "#f5b942",
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 0,
          },
        });
        map.addLayer({
          id: "selected-ring",
          type: "circle",
          source: "selected",
          paint: {
            "circle-radius": 11,
            "circle-opacity": 0,
            "circle-stroke-color": "#f5b942",
            "circle-stroke-width": 3,
            "circle-stroke-opacity": 0.95,
          },
        });
      }
      syncCells();
    };

    map.on("load", addLayers);
    map.on("styledata", () => {
      if (map.isStyleLoaded() && !map.getSource("rooms")) addLayers();
    });
    map.on("moveend", syncCells);
    return () => {
      resizeObserver.disconnect();
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Push fresh data into the sources whenever the fan-out answers or a filter changes (no-ops before
  // load). Only a layer whose collection changed is re-sent: a room filter leaves places alone.
  useEffect(() => {
    const previous = collectionsRef.current;
    collectionsRef.current = collections;
    const map = mapRef.current;
    if (!map) return;
    for (const id of LAYERS) {
      if (collections[id] === previous[id]) continue;
      (map.getSource(id) as GeoJSONSource | undefined)?.setData(collections[id]);
    }
  }, [collections]);

  useEffect(() => {
    selectionRef.current = selectionGeometry;
    (mapRef.current?.getSource("selection") as GeoJSONSource | undefined)?.setData(
      selectionGeometry,
    );
  }, [selectionGeometry]);

  // Highlight the selected marker (gold ring + beacon pulse) and ease to it on a NEW selection.
  const lastFocusRef = useRef("");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    (map.getSource("selected") as GeoJSONSource | undefined)?.setData(pointFC(focus));
    if (focus && focus.key !== lastFocusRef.current) {
      lastFocusRef.current = focus.key;
      map.easeTo({ center: [focus.lng, focus.lat], duration: 600 });
    }
    if (pulseFrameRef.current !== null) {
      cancelAnimationFrame(pulseFrameRef.current);
      pulseFrameRef.current = null;
    }
    if (!map.getLayer("selected-pulse")) return;
    const reduce =
      typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (focus && !reduce) {
      animatePulse();
    } else {
      // Reduced motion → a static faint ring; deselected → nothing.
      map.setPaintProperty("selected-pulse", "circle-radius", 16);
      map.setPaintProperty("selected-pulse", "circle-stroke-opacity", focus ? 0.4 : 0);
    }
    return () => {
      if (pulseFrameRef.current !== null) {
        cancelAnimationFrame(pulseFrameRef.current);
        pulseFrameRef.current = null;
      }
    };
  }, [focus]);

  const applyStyle = () => {
    saveJson(STYLE_KEY, styleUrl);
    mapRef.current?.setStyle(styleUrl || OSM_RASTER_STYLE);
  };

  return (
    <div className="relative min-w-0 flex-1 bg-muted">
      <div ref={containerRef} className="absolute inset-0 h-full" />

      {/* status + style settings (top-right) */}
      <div className="absolute top-3 right-3 flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border bg-card/85 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
          {refreshing ? (
            <RadioIcon className="size-3.5 animate-pulse text-gold" />
          ) : (
            <span className="size-1.5 rounded-full bg-status-ok shadow-[0_0_6px_var(--status-ok)]" />
          )}
          <span className="tabular">{statusText}</span>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Map style" title="Map style">
              <Settings2Icon className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <Label htmlFor="style-url" className="text-xs">
              Custom style URL (blank = OSM raster)
            </Label>
            <div className="mt-2 flex gap-2">
              <Input
                id="style-url"
                value={styleUrl}
                onChange={(e) => setStyleUrl(e.target.value)}
                placeholder="https://…/style.json"
              />
              <Button size="sm" onClick={applyStyle}>
                Apply
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              No token required. A MapTiler/Mapbox style URL with the key embedded also works.
            </p>
          </PopoverContent>
        </Popover>
      </div>

      {/* legend (bottom-left) */}
      <div className="absolute bottom-3 left-3 rounded-lg border bg-card/85 px-3 py-2.5 text-xs shadow-sm backdrop-blur">
        {serverLegend.map((s) => (
          <div key={s.label} className="flex items-center gap-2 py-0.5 text-muted-foreground">
            <span
              className="size-2 rounded-[2px] border-2"
              style={{ borderColor: s.color, background: "transparent" }}
            />
            {s.label}
          </div>
        ))}
        {serverLegend.length > 0 ? <div className="my-1.5 h-px bg-border" /> : null}
        {fillLegend.map((k) => (
          <div key={k.key} className="flex items-center gap-2 py-0.5 text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: k.color }} />
            {k.label}
          </div>
        ))}
      </div>
    </div>
  );
}
