"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Layers, LineChart, Maximize2, X } from "lucide-react";
import AboutModal from "./AboutModal";
import AskPanel from "./AskPanel";
import ComparePanel from "./ComparePanel";
import InsightPanel from "./InsightPanel";
import Intro from "./Intro";
import LayerPanel from "./LayerPanel";
import RecordCard from "./RecordCard";
import Timeline from "./Timeline";
import type { SearchHit } from "./SearchBox";
import type { CameraCommand, ViewMode } from "@/components/map/CityMap";
import { loadCityData, loadPermits } from "@/lib/data/load";
import { describeRecord, hexFullMax, layerSeries, type YearRange } from "@/lib/data/stats";
import type { CityData, PointSet, RecordRef } from "@/lib/data/types";
import type { LayerKey } from "@/lib/geo/constants";
import type { PropertyRef } from "@/lib/property/types";

const CityMap = dynamic(() => import("@/components/map/CityMap"), { ssr: false });
const PropertyExplorer = dynamic(() => import("@/components/property/PropertyExplorer"), { ssr: false });

type Bbox = [number, number, number, number];
const union = (a: Bbox, b: Bbox): Bbox => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

export default function Explorer() {
  const [data, setData] = useState<CityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intro, setIntro] = useState(true);
  const [active, setActive] = useState<Record<LayerKey, boolean>>({ vacant: true, rehab: true, demolition: true, permit: false });
  const [range, setRange] = useState<YearRange>([2004, 2026]);
  const [mode, setMode] = useState<ViewMode>("columns");
  const [neighborhood, setNeighborhood] = useState<number | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareWith, setCompareWith] = useState<number | null>(null);
  const [record, setRecord] = useState<RecordRef | null>(null);
  const [property, setProperty] = useState<PropertyRef | null>(null);
  const [permits, setPermits] = useState<PointSet | null>(null);
  const [permitsState, setPermitsState] = useState<"idle" | "loading" | "error">("idle");
  const [camera, setCamera] = useState<CameraCommand>({ kind: "city", nonce: 0 });
  const [about, setAbout] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"none" | "layers" | "insight">("none");
  const [photoreal, setPhotoreal] = useState(false);
  const [photorealStatus, setPhotorealStatus] = useState<{ available: boolean; error?: string } | null>(null);
  // "3D map only": the photoreal city with every record layer and panel hidden
  const [mapOnly, setMapOnly] = useState(false);
  const permitCache = useRef(new Map<number, PointSet>());
  const nonce = useRef(0);
  const fly = useCallback((command: { kind: "city" } | { kind: "bounds"; bbox: Bbox } | { kind: "point"; position: [number, number] }) => {
    setCamera({ ...command, nonce: ++nonce.current } as CameraCommand);
  }, []);

  useEffect(() => {
    loadCityData()
      .then((loaded) => {
        setData(loaded);
        setRange(loaded.summary.yearRange);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // photoreal 3D needs a server-side key; ask once whether one is configured
  useEffect(() => {
    fetch("/api/tiles3d/status")
      .then((r) => r.json())
      .then((j) => setPhotorealStatus({ available: Boolean(j.available), error: j.error }))
      .catch(() => setPhotorealStatus({ available: false }));
  }, []);

  // individual permits: one file per neighborhood, fetched only when needed
  useEffect(() => {
    if (neighborhood === null || !active.permit) {
      if (neighborhood === null) setPermits(null);
      setPermitsState("idle");
      return;
    }
    const cached = permitCache.current.get(neighborhood);
    if (cached) {
      setPermits(cached);
      setPermitsState("idle");
      return;
    }
    let cancelled = false;
    setPermits(null);
    setPermitsState("loading");
    loadPermits(neighborhood)
      .then((set) => {
        permitCache.current.set(neighborhood, set);
        if (!cancelled) {
          setPermits(set);
          setPermitsState("idle");
        }
      })
      .catch(() => !cancelled && setPermitsState("error"));
    return () => {
      cancelled = true;
    };
  }, [neighborhood, active.permit]);

  const bboxOf = useCallback((index: number) => data!.neighborhoods.features[index].properties.bbox as Bbox, [data]);

  const selectNeighborhood = useCallback(
    (index: number | null) => {
      if (!data) return;
      // while comparing, a map click picks neighborhood B instead of replacing A
      if (compareOpen && neighborhood !== null) {
        if (index === null || index === neighborhood) return;
        setCompareWith(index);
        fly({ kind: "bounds", bbox: union(bboxOf(neighborhood), bboxOf(index)) });
        return;
      }
      setRecord(null);
      setNeighborhood(index);
      if (index === null) {
        setMode("columns");
        fly({ kind: "city" });
      } else {
        setMode("records");
        setMobilePanel("insight");
        fly({ kind: "bounds", bbox: bboxOf(index) });
      }
    },
    [data, compareOpen, neighborhood, fly, bboxOf],
  );

  const resetCity = useCallback(() => {
    setCompareOpen(false);
    setCompareWith(null);
    setRecord(null);
    setNeighborhood(null);
    setMode("columns");
    fly({ kind: "city" });
  }, [fly]);

  const onSearch = useCallback(
    (hit: SearchHit) => {
      if (!data) return;
      if (hit.kind === "neighborhood") {
        setCompareOpen(false);
        setCompareWith(null);
        setRecord(null);
        setNeighborhood(hit.index);
        setMode("records");
        setMobilePanel("insight");
        fly({ kind: "bounds", bbox: bboxOf(hit.index) });
        return;
      }
      const set = hit.layer === "permit" ? permits : data.points[hit.layer];
      if (!set) return;
      setActive((a) => ({ ...a, [hit.layer]: true }));
      setRange(data.summary.yearRange);
      setMode("records");
      setRecord({ layer: hit.layer, index: hit.index });
      setMobilePanel("insight");
      fly({ kind: "point", position: [set.lon[hit.index], set.lat[hit.index]] });
    },
    [data, permits, fly, bboxOf],
  );

  const series = useMemo(() => (data ? layerSeries(data.aggregates, data.summary, neighborhood) : null), [data, neighborhood]);
  const columnMax = useMemo(() => (data ? hexFullMax(data.hex, active) : 1), [data, active]);
  const neighborhoodProps = useMemo(() => data?.neighborhoods.features.map((f) => f.properties) ?? [], [data]);
  const recordDetail = useMemo(() => {
    if (!data || !record) return null;
    const set = record.layer === "permit" ? permits : data.points[record.layer];
    if (!set || record.index >= set.length) return null;
    return describeRecord(record, set, data.summary, neighborhoodProps);
  }, [data, record, permits, neighborhoodProps]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || about || property) return;
      if (mapOnly) setMapOnly(false);
      else if (record) setRecord(null);
      else if (compareOpen) setCompareOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [record, compareOpen, about, mapOnly, property]);

  if (error) {
    return (
      <main className="flex h-full items-center justify-center p-6">
        <div className="glass max-w-md rounded-2xl p-6 text-center">
          <AlertTriangle className="mx-auto text-amber-300" size={28} />
          <h1 className="font-display mt-3 text-lg text-slate-50">City records could not be loaded</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            The app reads pre-processed files from <code className="text-slate-200">public/data</code>. Generate them with <code className="text-slate-200">uv run bmore-casa refresh</code>, then reload.
          </p>
          <p className="mt-3 break-words text-xs text-slate-600">{error}</p>
        </div>
      </main>
    );
  }

  const scope = neighborhood !== null && data ? data.neighborhoods.features[neighborhood].properties.name : "Citywide";
  const showCompare = compareOpen && neighborhood !== null;
  const photorealOn = photoreal && Boolean(photorealStatus?.available);
  // map-only is only meaningful on top of the photoreal city
  const cleanMap = mapOnly && photorealOn && !intro;

  return (
    <main className="relative h-full w-full overflow-hidden">
      {data && (
        <CityMap
          data={data}
          intro={intro}
          active={active}
          range={range}
          mode={mode}
          selectedNeighborhood={neighborhood}
          compareNeighborhood={showCompare ? compareWith : null}
          permits={permits}
          selectedRecord={record}
          camera={camera}
          photoreal={photorealOn}
          mapOnly={cleanMap}
          onSelectNeighborhood={selectNeighborhood}
          onSelectRecord={(ref) => {
            setRecord(ref);
            if (ref) setMobilePanel("insight");
          }}
        />
      )}

      {intro && (
        <Intro
          summary={data?.summary ?? null}
          onExplore={() => {
            setIntro(false);
            fly({ kind: "city" });
          }}
        />
      )}

      {cleanMap && (
        <div className="panel-in absolute left-3 top-3 z-30 flex items-center gap-2 lg:left-4 lg:top-4">
          <div className="glass font-display rounded-xl px-3 py-2 text-[12px] font-semibold tracking-[0.16em] text-slate-50">
            BMORE<span className="text-cyan-300">.CASA</span>
          </div>
          <button onClick={() => setMapOnly(false)} className="glass flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11.5px] text-slate-200 transition hover:text-cyan-100">
            <Layers size={13} /> Show records & panels
            <kbd className="ml-1 rounded border border-white/10 px-1 text-[9.5px] text-slate-500">Esc</kbd>
          </button>
        </div>
      )}

      {!intro && data && series && !cleanMap && (
        <>
          {/* mobile top bar */}
          <div className="absolute left-3 right-3 top-3 z-30 flex items-center gap-2 lg:hidden">
            <div className="glass font-display flex-1 truncate rounded-xl px-3 py-2 text-[12px] font-semibold tracking-[0.16em] text-slate-50">
              BMORE<span className="text-cyan-300">.CASA</span>
            </div>
            {([["layers", Layers, "Layers"], ["insight", LineChart, "Insights"]] as const).map(([key, Icon, label]) => (
              <button key={key} onClick={() => setMobilePanel((p) => (p === key ? "none" : key))} aria-label={label} aria-pressed={mobilePanel === key} className={`glass rounded-xl p-2.5 ${mobilePanel === key ? "text-cyan-200" : "text-slate-300"}`}>
                {mobilePanel === key ? <X size={16} /> : <Icon size={16} />}
              </button>
            ))}
          </div>

          <aside className={`absolute left-3 top-16 z-20 w-[min(300px,calc(100%-1.5rem))] lg:left-4 lg:top-4 lg:block lg:max-h-[calc(100%-2rem)] ${mobilePanel === "layers" ? "block max-h-[calc(100%-5rem)]" : "hidden"}`}>
            <div className="flex max-h-[inherit] flex-col">
              <LayerPanel
                data={data}
                series={series}
                scope={scope}
                active={active}
                range={range}
                mode={mode}
                columnMax={columnMax}
                permits={permits}
                permitsState={permitsState}
                hasNeighborhood={neighborhood !== null}
                onToggle={(k) => setActive((a) => ({ ...a, [k]: !a[k] }))}
                onMode={setMode}
                photoreal={photoreal}
                photorealStatus={photorealStatus}
                onPhotoreal={(on) => {
                  setPhotoreal(on);
                  if (!on) setMapOnly(false);
                }}
                onMapOnly={() => {
                  // the clean view is the photoreal city, so switch that on with it
                  setPhotoreal(true);
                  setRecord(null);
                  setMapOnly(true);
                }}
                onSearch={onSearch}
                onAbout={() => setAbout(true)}
              />
            </div>
          </aside>

          <aside className={`absolute right-3 top-16 z-20 w-[min(380px,calc(100%-1.5rem))] flex-col gap-3 lg:right-4 lg:top-4 lg:flex lg:max-h-[calc(100%-9.5rem)] ${mobilePanel === "insight" ? "flex max-h-[calc(100%-5rem)]" : "hidden"}`}>
            {recordDetail && (
              <div className="shrink-0">
                <RecordCard record={recordDetail} onClose={() => setRecord(null)} onExplore={() => { if (record) setProperty({ ...record, ...(record.layer === "permit" && neighborhood !== null ? { neighborhood } : {}) }); }} />
              </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col">
              {showCompare ? (
                <ComparePanel
                  data={data}
                  a={neighborhood}
                  b={compareWith}
                  range={range}
                  onA={(i) => {
                    setNeighborhood(i);
                    fly({ kind: "bounds", bbox: compareWith !== null ? union(bboxOf(i), bboxOf(compareWith)) : bboxOf(i) });
                  }}
                  onB={(i) => {
                    setCompareWith(i);
                    if (i !== null) fly({ kind: "bounds", bbox: union(bboxOf(neighborhood), bboxOf(i)) });
                  }}
                  onClose={() => {
                    setCompareOpen(false);
                    setCompareWith(null);
                    fly({ kind: "bounds", bbox: bboxOf(neighborhood) });
                  }}
                />
              ) : (
                <InsightPanel data={data} neighborhood={neighborhood} range={range} series={series} onSelectNeighborhood={selectNeighborhood} onCompare={() => setCompareOpen(true)} />
              )}
            </div>
            <div className="shrink-0">
              <AskPanel
                neighborhood={neighborhood}
                neighborhoodName={neighborhood !== null ? neighborhoodProps[neighborhood].name : null}
                compare={showCompare ? compareWith : null}
                compareName={showCompare && compareWith !== null ? neighborhoodProps[compareWith].name : null}
                range={range}
              />
            </div>
          </aside>

          <div className={`absolute bottom-3 left-3 right-3 z-10 lg:bottom-4 lg:left-[332px] lg:right-[412px] ${mobilePanel !== "none" ? "hidden lg:block" : ""}`}>
            {neighborhood !== null && (
              <div className="mb-2 flex justify-center">
                <button onClick={resetCity} className="glass flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11.5px] text-slate-200 transition hover:text-cyan-100">
                  <Maximize2 size={11} /> Return to full city
                </button>
              </div>
            )}
            <Timeline summary={data.summary} series={series} scope={scope} active={active} range={range} onRange={setRange} />
          </div>
        </>
      )}

      {about && data && <AboutModal summary={data.summary} onClose={() => setAbout(false)} />}
      {property && <PropertyExplorer property={property} onClose={() => setProperty(null)} />}
    </main>
  );
}
