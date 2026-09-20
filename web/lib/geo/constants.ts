import type { StyleSpecification } from "maplibre-gl";

export type LayerKey = "vacant" | "rehab" | "demolition" | "permit";
export type RGB = [number, number, number];

export const LAYER_ORDER: LayerKey[] = ["vacant", "rehab", "demolition", "permit"];

export interface LayerMeta {
  key: LayerKey;
  label: string;
  short: string;
  color: RGB;
  hex: string;
  /** What one record in this layer is - shown wherever the layer is counted. */
  counts: string;
  /** Which source date places a record on the timeline. */
  dateLabel: string;
}

export const LAYERS: Record<LayerKey, LayerMeta> = {
  vacant: {
    key: "vacant",
    label: "Open vacant building notices",
    short: "Open notices",
    color: [255, 112, 97],
    hex: "#ff7061",
    counts: "Vacant building notices that were still open when the source was downloaded, placed by the date the notice was issued. Closed notices are not in the source, so this is not a history of vacancy.",
    dateLabel: "Notice issued",
  },
  rehab: {
    key: "rehab",
    label: "Rehab permits on vacant buildings",
    short: "Rehab records",
    color: [61, 220, 151],
    hex: "#3ddc97",
    counts: "Use & occupancy permit records for buildings that had a vacant building notice, one record per parcel, placed by permit issue date. A permit is not proof the rehabilitation was completed.",
    dateLabel: "Permit issued",
  },
  demolition: {
    key: "demolition",
    label: "Completed city demolitions",
    short: "Demolitions",
    color: [166, 132, 224],
    hex: "#a684e0",
    counts: "City-led demolitions marked complete, placed by the recorded finish date. Each is a one-time event; private demolitions are not included.",
    dateLabel: "Demolition finished",
  },
  permit: {
    key: "permit",
    label: "Building permits",
    short: "Permits",
    color: [245, 176, 65],
    hex: "#f5b041",
    counts: "Permit records placed by issue date. One building often has many permits (and modifications of permits), so permits are not buildings and do not confirm finished construction.",
    dateLabel: "Permit issued",
  },
};

/** Index into aggregates/hex `types` -> layer. Mirrors ACTIVITY_TYPES in process.py. */
export const ACTIVITY_TYPES = [
  "vacant",
  "rehab",
  "demolition",
  "permit_construction",
  "permit_use",
  "permit_demolition",
  "permit_temporary",
  "permit_zoning",
  "permit_other",
] as const;

export const TYPE_TO_LAYER: LayerKey[] = ACTIVITY_TYPES.map((t) =>
  t.startsWith("permit_") ? "permit" : (t as LayerKey),
);

export const PERMIT_CATEGORIES = ["construction", "use", "demolition", "temporary", "zoning", "other"] as const;

export const PERMIT_CATEGORY_LABELS: Record<string, string> = {
  construction: "Construction & alteration (COM, BRCM, BCCM)",
  use: "Use & occupancy (USE, BUSE)",
  demolition: "Demolition permits (DEM, BDEM)",
  temporary: "Temporary use (TMP, BTEMP)",
  zoning: "Zoning-related (BMZ)",
  other: "Other prefixes",
};

export const CITY_VIEW = { center: [-76.6205, 39.2985] as [number, number], zoom: 11.35, pitch: 52, bearing: -14 };
export const INTRO_VIEW = { center: [-76.6205, 39.292] as [number, number], zoom: 10.85, pitch: 60, bearing: -32 };

/**
 * Fully local fallback style: the navy background plus the neighborhood
 * polygons (added at runtime) are the whole geographic base, so the app still
 * renders with no network at all.
 */
export const LOCAL_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#060a14" } }],
};

const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

/**
 * Street/water context is a progressive enhancement: OpenFreeMap's keyless dark
 * vector style, recolored to the navy palette. Any failure (offline, timeout,
 * bad payload) resolves to LOCAL_STYLE instead of breaking the map.
 */
export async function resolveMapStyle(timeoutMs = 3500): Promise<{ style: StyleSpecification; attribution: string | null }> {
  try {
    // `?basemap=off` forces the offline look - a safety net for unreliable venue Wi-Fi
    if (new URLSearchParams(window.location.search).get("basemap") === "off") throw new Error("basemap disabled");
    const res = await fetch(BASEMAP_STYLE_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const style = (await res.json()) as StyleSpecification;
    if (!Array.isArray(style.layers) || !style.sources) throw new Error("unexpected style payload");
    const tint: Record<string, [string, string]> = {
      background: ["background-color", "#060a14"],
      water: ["fill-color", "#0a1526"],
      landuse_residential: ["fill-color", "#090e1b"],
      landuse_park: ["fill-color", "#0a1a1c"],
      landcover_wood: ["fill-color", "#0a1a1c"],
      building: ["fill-color", "#0e1626"],
    };
    style.layers = style.layers
      // landcover_wood needs a sprite pattern we do not ship a fallback for
      // (place_* below city level would duplicate the official NSA neighborhood labels we draw ourselves)
      .filter((layer) => !["landcover_wood", "place_other", "place_suburb", "place_village"].includes(layer.id))
      .map((layer) => {
        const paint = { ...((layer.paint ?? {}) as Record<string, unknown>) };
        const rule = tint[layer.id];
        if (rule) paint[rule[0]] = rule[1];
        else if (layer.type === "line" && /^(highway|road|railway|aeroway)/.test(layer.id)) paint["line-color"] = layer.id.includes("casing") ? "#0a101d" : "#1b2942";
        else if (layer.type === "symbol") paint["text-color"] = layer.id.startsWith("place_") ? "#6d829c" : "#42546c";
        else return layer;
        if (layer.type === "symbol") paint["text-halo-color"] = "#060a14";
        return { ...layer, paint } as typeof layer;
      });
    return { style, attribution: BASEMAP_ATTRIBUTION };
  } catch {
    return { style: LOCAL_STYLE, attribution: null };
  }
}
