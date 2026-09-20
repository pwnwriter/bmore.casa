"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AttributionControl, Map as MLMap, NavigationControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ColumnLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { CITY_VIEW, INTRO_VIEW, LAYER_ORDER, LAYERS, resolveMapStyle, TYPE_TO_LAYER, type LayerKey } from "@/lib/geo/constants";
import type { CityData, PointSet, RecordRef } from "@/lib/data/types";
import { fmt, hexFullMax, type YearRange } from "@/lib/data/stats";

export type ViewMode = "columns" | "records";

export type CameraCommand =
  | { kind: "city"; nonce: number }
  | { kind: "bounds"; bbox: [number, number, number, number]; nonce: number }
  | { kind: "point"; position: [number, number]; nonce: number };

interface Props {
  data: CityData;
  intro: boolean;
  active: Record<LayerKey, boolean>;
  range: YearRange;
  mode: ViewMode;
  selectedNeighborhood: number | null;
  compareNeighborhood: number | null;
  permits: PointSet | null;
  selectedRecord: RecordRef | null;
  camera: CameraCommand;
  /** Drape the records over Google Photorealistic 3D Tiles (needs a server-side key, see /api/tiles3d). */
  photoreal: boolean;
  /** Show the 3D city on its own: no record layers, labels or click-selection. */
  mapOnly: boolean;
  onSelectNeighborhood: (index: number | null) => void;
  onSelectRecord: (ref: RecordRef | null) => void;
}

interface Segment {
  position: [number, number, number];
  elevation: number;
  layer: LayerKey;
  cell: number;
}

interface HoverInfo {
  x: number;
  y: number;
  title: string;
  lines: { color?: string; text: string }[];
}

/** Tallest column in metres. Heights encode record counts - they are not building heights. */
const MAX_COLUMN_M = 2200;
// permits at the base so the three vacancy-related layers stay visible on top
const STACK_ORDER: LayerKey[] = ["permit", "demolition", "rehab", "vacant"];

export default function CityMap(props: Props) {
  const { data, intro, active, range, mode, selectedNeighborhood, compareNeighborhood, permits, selectedRecord, camera, photoreal, mapOnly } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;

  const [ready, setReady] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  // The 3D Tiles stack is heavy, so it is only imported the first time photoreal mode is switched on.
  const [tiles3d, setTiles3d] = useState<{ Tile3DLayer: typeof import("@deck.gl/geo-layers").Tile3DLayer } | null>(null);
  const [credits, setCredits] = useState("");

  useEffect(() => {
    if (!photoreal || tiles3d) return;
    let cancelled = false;
    import("@deck.gl/geo-layers").then((geo) => {
      if (!cancelled) setTiles3d({ Tile3DLayer: geo.Tile3DLayer });
    });
    return () => {
      cancelled = true;
    };
  }, [photoreal, tiles3d]);

  // ---- map bootstrap (once)
  useEffect(() => {
    let cancelled = false;
    let map: MLMap | null = null;

    // v6 looks for its worker next to import.meta.url, which the bundler rewrites; see scripts/copy-maplibre-worker.mjs
    setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

    resolveMapStyle().then(({ style, attribution }) => {
      if (cancelled || !container.current) return;
      map = new MLMap({
        container: container.current,
        style,
        ...INTRO_VIEW,
        minZoom: 9.5,
        maxZoom: 18.5,
        maxPitch: 70,
        attributionControl: false,
      });
      const m = map;
      mapRef.current = m;
      // basemap hiccups (a missing tile, glyph or sprite) must never take the data layers down
      m.on("error", (e) => console.warn("[map]", e.error?.message ?? e));
      if (process.env.NODE_ENV !== "production") (window as unknown as { __map?: MLMap }).__map = m;
      m.addControl(
        new AttributionControl({
          compact: true,
          customAttribution: ["Records: Baltimore City DHCD · Open Baltimore", attribution].filter(Boolean).join(" · "),
        }),
        "bottom-right",
      );
      m.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");

      const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
      overlayRef.current = overlay;
      m.addControl(overlay);

      let hovered: number | null = null;
      m.on("load", () => {
        // under the basemap's labels when there is a basemap, on top otherwise
        const firstSymbol = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
        m.addSource("nbhd", { type: "geojson", data: data.neighborhoods });
        m.addLayer(
          {
            id: "nbhd-fill",
            type: "fill",
            source: "nbhd",
            paint: {
              "fill-color": ["case", ["boolean", ["feature-state", "selected"], false], "#4dd6e8", "#1a2a42"],
              "fill-opacity": [
                "case",
                ["boolean", ["feature-state", "selected"], false], 0.14,
                ["boolean", ["feature-state", "hover"], false], 0.55,
                0.3,
              ],
            },
          },
          firstSymbol,
        );
        m.addLayer(
          {
            id: "nbhd-line",
            type: "line",
            source: "nbhd",
            paint: {
              "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#7be7f5", "#4dd6e8"],
              "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.4, 0.8],
              "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.95, 0.34],
            },
          },
          firstSymbol,
        );
        setReady(true);
      });

      m.on("mousemove", "nbhd-fill", (e) => {
        const id = e.features?.[0]?.id as number | undefined;
        if (id === undefined || id === hovered) return;
        if (hovered !== null) m.setFeatureState({ source: "nbhd", id: hovered }, { hover: false });
        hovered = id;
        m.setFeatureState({ source: "nbhd", id }, { hover: true });
      });
      m.on("mouseleave", "nbhd-fill", () => {
        if (hovered !== null) m.setFeatureState({ source: "nbhd", id: hovered }, { hover: false });
        hovered = null;
      });

      // One click handler decides: a record point wins, otherwise the neighborhood under the cursor.
      m.on("click", (e) => {
        if (callbacks.current.intro || callbacks.current.mapOnly) return;
        const picked = overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 6 });
        if (picked?.layer?.id.startsWith("pts-") && typeof picked.object === "number") {
          callbacks.current.onSelectRecord({ layer: picked.layer.id.slice(4) as LayerKey, index: picked.object });
          return;
        }
        const feature = m.queryRenderedFeatures(e.point, { layers: ["nbhd-fill"] })[0];
        callbacks.current.onSelectRecord(null);
        callbacks.current.onSelectNeighborhood(feature ? (feature.id as number) : null);
      });

      m.on("zoom", () => setShowLabels(m.getZoom() >= 12.4));
    });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      overlayRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- slow orbit behind the title card
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !intro) return;
    let frame = 0;
    let last = performance.now();
    const spin = (now: number) => {
      map.setBearing(map.getBearing() + (now - last) * 0.0022);
      last = now;
      frame = requestAnimationFrame(spin);
    };
    frame = requestAnimationFrame(spin);
    return () => cancelAnimationFrame(frame);
  }, [intro, ready]);

  // ---- camera commands
  useEffect(() => {
    const map = mapRef.current;
    if (!map || intro) return;
    // Panel padding is animated in once (city flight) and then persists on the
    // map, so later moves stay centred in the free space. fitBounds ADDS its own
    // padding to the persistent one - so it only gets a small margin.
    const wide = window.innerWidth >= 1024;
    const padding = wide ? { top: 40, bottom: 220, left: 330, right: 410 } : { top: 70, bottom: 250, left: 20, right: 20 };
    if (camera.kind === "city") {
      map.flyTo({ ...CITY_VIEW, padding, duration: 2600, essential: true });
    } else if (camera.kind === "bounds") {
      const [w, s, e, n] = camera.bbox;
      map.setPadding(padding);
      map.fitBounds([[w, s], [e, n]], { padding: wide ? 70 : 30, pitch: 48, bearing: map.getBearing(), maxZoom: 16, duration: 2000, essential: true });
    } else {
      map.setPadding(padding);
      map.flyTo({ center: camera.position, zoom: Math.max(map.getZoom(), 16.2), pitch: 50, duration: 1800, essential: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, intro, ready]);

  // ---- map-only: the panels are hidden, so give the city the whole viewport (and hand it back after)
  const wasMapOnly = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || intro || wasMapOnly.current === mapOnly) return;
    wasMapOnly.current = mapOnly;
    const wide = window.innerWidth >= 1024;
    const panels = wide ? { top: 40, bottom: 220, left: 330, right: 410 } : { top: 70, bottom: 250, left: 20, right: 20 };
    map.easeTo({ padding: mapOnly ? { top: 0, bottom: 0, left: 0, right: 0 } : panels, duration: 900, essential: true });
  }, [mapOnly, ready, intro]);

  // ---- selected / compared neighborhood outline
  const highlighted = useRef<number[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    highlighted.current.forEach((id) => map.setFeatureState({ source: "nbhd", id }, { selected: false }));
    highlighted.current = [selectedNeighborhood, compareNeighborhood].filter((v): v is number => v !== null);
    highlighted.current.forEach((id) => map.setFeatureState({ source: "nbhd", id }, { selected: true }));
  }, [selectedNeighborhood, compareNeighborhood, ready]);

  // keep the GeoJSON source in sync if data is ever reloaded
  useEffect(() => {
    if (!ready) return;
    (mapRef.current?.getSource("nbhd") as GeoJSONSource | undefined)?.setData(data.neighborhoods);
  }, [data.neighborhoods, ready]);

  // ---- hex columns
  const activeKey = LAYER_ORDER.filter((k) => active[k]).join(",");
  // Height scale uses the full time span of the active layers, so dragging the
  // timeline never rescales the columns.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fullMax = useMemo(() => hexFullMax(data.hex, active), [data.hex, activeKey]);

  const { segments, cellCounts } = useMemo(() => {
    const counts = new Map<number, Record<LayerKey, number>>();
    for (const [cell, type, year, n] of data.hex.rows) {
      const layer = TYPE_TO_LAYER[type];
      if (!active[layer] || year < range[0] || year > range[1]) continue;
      let entry = counts.get(cell);
      if (!entry) counts.set(cell, (entry = { vacant: 0, rehab: 0, demolition: 0, permit: 0 }));
      entry[layer] += n;
    }
    const scale = MAX_COLUMN_M / fullMax;
    const out: Segment[] = [];
    counts.forEach((entry, cell) => {
      const [lon, lat] = data.hex.cells[cell];
      let base = 0;
      for (const layer of STACK_ORDER) {
        if (!entry[layer]) continue;
        const elevation = entry[layer] * scale;
        out.push({ position: [lon, lat, base], elevation, layer, cell });
        base += elevation;
      }
    });
    return { segments: out, cellCounts: counts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.hex, activeKey, range[0], range[1], fullMax]);

  // ---- record points
  const pointIndices = useMemo(() => {
    const sets: Partial<Record<LayerKey, PointSet>> = { ...data.points, permit: permits ?? undefined };
    const result: Partial<Record<LayerKey, number[]>> = {};
    for (const key of LAYER_ORDER) {
      const set = sets[key];
      if (!set || !active[key]) continue;
      const idx: number[] = [];
      for (let i = 0; i < set.length; i++) if (set.year[i] >= range[0] && set.year[i] <= range[1]) idx.push(i);
      result[key] = idx;
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.points, permits, activeKey, range[0], range[1]]);

  const labelData = useMemo(() => data.neighborhoods.features.map((f) => f.properties), [data.neighborhoods]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !ready) return;
    const sets: Partial<Record<LayerKey, PointSet>> = { ...data.points, permit: permits ?? undefined };
    const layers: Layer[] = [];
    // Over the photogrammetry mesh, records skip the depth test so a roof can never hide them.
    // (deck.gl's TerrainExtension draping was tried first; it dropped the points in the overlaid MapLibre setup.)
    const onMesh = photoreal && Boolean(tiles3d);
    const drape = onMesh ? { parameters: { depthCompare: "always" as const } } : {};
    // map-only mode draws the city and nothing else
    const dataMode: ViewMode | "none" = mapOnly ? "none" : mode;

    if (photoreal && tiles3d) {
      layers.push(
        new tiles3d.Tile3DLayer({
          id: "photoreal-tiles",
          // absolute URL: the loader resolves child tile URIs against it
          data: `${window.location.origin}/api/tiles3d/root.json`,
          onTilesetLoad: (tileset) => {
            // Google requires the per-tile data attributions to be displayed
            tileset.options.onTraversalComplete = (selected) => {
              const seen = new Set<string>();
              for (const tile of selected) {
                const copyright = (tile.content as { gltf?: { asset?: { copyright?: string } } } | undefined)?.gltf?.asset?.copyright;
                copyright?.split(/;/g).forEach((c) => c.trim() && seen.add(c.trim()));
              }
              setCredits([...seen].slice(0, 6).join(" · "));
              return selected;
            };
          },
          onTilesetError: (e: unknown) => console.warn("[photoreal]", e),
        }) as unknown as Layer,
      );
    }

    if (dataMode === "columns") {
      layers.push(
        new ColumnLayer<Segment>({
          id: "hex-columns",
          data: segments,
          diskResolution: 6,
          radius: data.hex.radiusMeters * 0.86,
          extruded: true,
          pickable: true,
          getPosition: (d) => d.position,
          getElevation: (d) => d.elevation,
          getFillColor: (d) => [...LAYERS[d.layer].color, 225],
          material: { ambient: 0.62, diffuse: 0.55, shininess: 22, specularColor: [40, 60, 80] },
          transitions: { getElevation: { duration: 350 }, getPosition: { duration: 350 } },
          onHover: (info: PickingInfo<Segment>) => {
            if (!info.object) return setHover(null);
            const entry = cellCounts.get(info.object.cell);
            if (!entry) return setHover(null);
            setHover({
              x: info.x,
              y: info.y,
              title: `${data.hex.radiusMeters * 2} m hex cell · ${range[0]}–${range[1]}`,
              lines: LAYER_ORDER.filter((k) => active[k] && entry[k]).map((k) => ({ color: LAYERS[k].hex, text: `${fmt(entry[k])} ${LAYERS[k].short.toLowerCase()}` })),
            });
          },
        }),
      );
    } else if (dataMode === "records") {
      // permits first (underneath), vacancy last (on top)
      for (const key of [...LAYER_ORDER].reverse()) {
        const set = sets[key];
        const indices = pointIndices[key];
        if (!set || !indices) continue;
        const [r, g, b] = LAYERS[key].color;
        if (!onMesh)
          layers.push(
            new ScatterplotLayer<number>({
              id: `glow-${key}`,
              data: indices,
              getPosition: (i) => [set.lon[i], set.lat[i]],
              getRadius: 16,
              radiusMinPixels: 3,
              radiusMaxPixels: 26,
              getFillColor: [r, g, b, key === "permit" ? 14 : 34],
              updateTriggers: { getPosition: set },
            }),
          );
        layers.push(
          new ScatterplotLayer<number>({
            id: `pts-${key}`,
            data: indices,
            pickable: true,
            getPosition: (i) => [set.lon[i], set.lat[i]],
            getRadius: onMesh ? 3.5 : 5,
            radiusMinPixels: onMesh ? 2.6 : key === "permit" ? 1.6 : 1.9,
            radiusMaxPixels: onMesh ? 7 : 9,
            // a dark rim keeps the dots legible against bright rooftops
            stroked: onMesh,
            getLineColor: [6, 10, 20, 230],
            lineWidthMinPixels: onMesh ? 1.2 : 0,
            getFillColor: [r, g, b, onMesh ? 255 : key === "permit" ? 190 : 235],
            updateTriggers: { getPosition: set },
            ...drape,
            onHover: (info: PickingInfo<number>) => {
              if (typeof info.object !== "number") return setHover(null);
              const i = info.object;
              setHover({
                x: info.x,
                y: info.y,
                title: set.address[i] ?? "Address not recorded",
                lines: [{ color: LAYERS[key].hex, text: `${LAYERS[key].dateLabel} ${set.date[i] ?? "date not recorded"}` }, { text: "Click for the full record" }],
              });
            },
          }),
        );
      }
      if (selectedRecord) {
        const set = sets[selectedRecord.layer];
        if (set && selectedRecord.index < set.length) {
          layers.push(
            new ScatterplotLayer<number>({
              id: "selected-record",
              data: [selectedRecord.index],
              getPosition: (i) => [set.lon[i], set.lat[i]],
              radiusUnits: "pixels",
              getRadius: 11,
              stroked: true,
              filled: false,
              lineWidthMinPixels: 2,
              getLineColor: [255, 255, 255, 240],
              ...drape,
            }),
          );
        }
      }
    }

    if (showLabels && !mapOnly) {
      layers.push(
        new TextLayer({
          id: "nbhd-labels",
          data: labelData,
          getPosition: (d) => d.center,
          getText: (d) => d.name,
          getSize: 11.5,
          sizeMinPixels: 10,
          sizeMaxPixels: 13,
          getColor: [196, 214, 232, 215],
          fontFamily: "Inter, system-ui, sans-serif",
          fontWeight: 600,
          fontSettings: { sdf: true },
          outlineWidth: 3,
          outlineColor: [6, 10, 20, 235],
          maxWidth: 9,
          wordBreak: "break-word",
          characterSet: "auto",
          // labels share z=0 with the dots; without this they z-fight
          parameters: { depthCompare: "always" },
        }),
      );
    }
    overlay.setProps({ layers, getCursor: ({ isHovering }) => (isHovering ? "pointer" : "grab") });
  }, [ready, mode, segments, cellCounts, pointIndices, permits, selectedRecord, showLabels, labelData, data, active, range, photoreal, tiles3d, mapOnly]);

  // drop stale tooltips when the scene changes under the cursor
  useEffect(() => setHover(null), [mode, activeKey, selectedNeighborhood, mapOnly]);

  return (
    <div className="absolute inset-0">
      {/* maplibre-gl.css forces position:relative on the container, so size it explicitly */}
      <div ref={container} className="h-full w-full" />
      {photoreal && !intro && (
        <div className="pointer-events-none absolute bottom-1 left-1/2 z-[6] max-w-[60%] -translate-x-1/2 truncate rounded bg-black/55 px-2 py-0.5 text-[10px] text-slate-200">
          <span className="font-semibold tracking-wide">Google</span> Photorealistic 3D Tiles{credits ? ` · ${credits}` : ""} — imagery context, not DHCD data
        </div>
      )}
      {hover && !intro && (
        <div className="glass pointer-events-none absolute z-20 max-w-64 rounded-lg px-3 py-2 text-xs" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <div className="font-medium text-slate-100">{hover.title}</div>
          {hover.lines.map((line, i) => (
            <div key={i} className="mt-0.5 flex items-center gap-1.5 text-slate-300">
              {line.color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: line.color }} />}
              {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { MAX_COLUMN_M };
