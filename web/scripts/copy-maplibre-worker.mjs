// MapLibre GL v6 ships its web worker as separate ES modules and locates them
// relative to import.meta.url - which a bundler rewrites. Serving them from
// /public and pointing setWorkerUrl() there keeps tile + GeoJSON parsing working.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "maplibre-gl", "dist");
const to = join(root, "public", "maplibre");
mkdirSync(to, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(join(from, file), join(to, file));
console.log("maplibre worker copied to public/maplibre");
const dracoFrom = join(root, "node_modules", "three", "examples", "jsm", "libs", "draco", "gltf");
const dracoTo = join(root, "public", "draco");
mkdirSync(dracoTo, { recursive: true });
for (const file of ["draco_decoder.wasm", "draco_wasm_wrapper.js", "draco_decoder.js"]) copyFileSync(join(dracoFrom, file), join(dracoTo, file));
