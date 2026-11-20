import { setWorkerUrl } from "maplibre-gl";

// maplibre 6 cannot find its own worker inside a bundle: Next emits the file as an asset from this
// URL, and maplibre is told where it is once, before any map is made. Every map here imports this.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
