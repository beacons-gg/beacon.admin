"use client";

import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./worker";
import { useEffect, useRef } from "react";
import type { LatLng } from "@beaconsgg/protocol-types";
import { OSM_RASTER_STYLE } from "./MapCanvas";

/**
 * A small click-to-pick map: one marker, one click handler, the console's tokenless OSM raster
 * style. Game plugins get it as `ui.PointPicker`, to pick a point such as where a room goes.
 * Deliberately NOT `MapCanvas` — the pane-of-glass carries discovery/places sources
 * and viewport-cell reporting this picker has no use for; a picker is a marker on a map.
 */
export function PointPicker({
  value,
  onPick,
}: {
  /** The current anchor (marker position + initial center), or null (world view, no marker). */
  value: LatLng | null;
  onPick: (point: LatLng) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new maplibregl.Map({
      container,
      style: OSM_RASTER_STYLE,
      center: value ? [value.lng, value.lat] : [0, 20],
      zoom: value ? 9 : 1,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("click", (e) => onPickRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    mapRef.current = map;
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // Init once (deliberately not keyed on `value` — it moves the marker via the effect below,
    // not by re-creating the map).
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (markerRef.current) {
      markerRef.current.setLngLat([value.lng, value.lat]);
    } else {
      markerRef.current = new maplibregl.Marker().setLngLat([value.lng, value.lat]).addTo(map);
    }
  }, [value]);

  return <div ref={containerRef} className="h-56 w-full overflow-hidden rounded-md border" />;
}
