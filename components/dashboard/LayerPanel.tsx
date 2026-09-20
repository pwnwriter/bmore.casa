"use client";

import { BarChart3, Building2, CircleDot, Database, Eye, Loader2 } from "lucide-react";
import SearchBox, { type SearchHit } from "./SearchBox";
import type { ViewMode } from "@/components/map/CityMap";
import { LAYER_ORDER, LAYERS, type LayerKey } from "@/lib/geo/constants";
import { fmt, sumRange, type LayerSeries, type YearRange } from "@/lib/data/stats";
import type { CityData, PointSet } from "@/lib/data/types";

interface Props {
  data: CityData;
  series: LayerSeries;
  scope: string;
  active: Record<LayerKey, boolean>;
  range: YearRange;
  mode: ViewMode;
  columnMax: number;
  permits: PointSet | null;
  permitsState: "idle" | "loading" | "error";
  hasNeighborhood: boolean;
  onToggle: (layer: LayerKey) => void;
  onMode: (mode: ViewMode) => void;
  photoreal: boolean;
  photorealStatus: { available: boolean; error?: string } | null;
  onPhotoreal: (on: boolean) => void;
  /** Switch to the photoreal city with every record layer and panel hidden. */
  onMapOnly: () => void;
  onSearch: (hit: SearchHit) => void;
  onAbout: () => void;
}

export default function LayerPanel(props: Props) {
  const { data, series, scope, active, range, mode, columnMax, permits, permitsState, hasNeighborhood, onToggle, onMode, onSearch, onAbout, photoreal, photorealStatus, onPhotoreal, onMapOnly } = props;

  return (
    <div className="glass panel-in thin-scroll flex max-h-full flex-col overflow-y-auto rounded-2xl">
      <div className="border-b border-white/5 px-4 pb-3 pt-4">
        <div className="font-display text-[15px] font-semibold tracking-[0.18em] text-slate-50">
          BMORE<span className="text-cyan-300">.CASA</span>
        </div>
        <div className="mt-0.5 text-[11px] text-slate-400">Housing records from Baltimore City open data</div>
        <div className="mt-3">
          <SearchBox data={data} permits={permits} onSelect={onSearch} />
        </div>
      </div>

      <div className="px-4 pb-1 pt-3">
        <div className="eyebrow mb-2 flex items-center justify-between">
          <span>Layers</span>
          <span className="tabular normal-case tracking-normal text-slate-500">
            {scope} · {range[0]}–{range[1]}
          </span>
        </div>
        <ul className="space-y-1">
          {LAYER_ORDER.map((k) => {
            const on = active[k];
            return (
              <li key={k}>
                <button
                  onClick={() => onToggle(k)}
                  aria-pressed={on}
                  title={LAYERS[k].counts}
                  className={`group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${on ? "bg-white/[0.045]" : "opacity-55 hover:opacity-90"}`}
                >
                  <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    <span className="h-2.5 w-2.5 rounded-full transition" style={{ background: on ? LAYERS[k].hex : "transparent", border: `1.5px solid ${LAYERS[k].hex}`, boxShadow: on ? `0 0 10px ${LAYERS[k].hex}99` : "none" }} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-200">{LAYERS[k].label}</span>
                  <span className="tabular text-[12px] font-medium text-slate-300">{fmt(sumRange(series, k, range))}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-1.5 px-2 text-[10px] leading-snug text-slate-500">
          Counts are source records dated in the selected years — not buildings. Rehab records are also permits; never add the two.
        </p>
      </div>

      <div className="px-4 pb-3 pt-2">
        <div className="eyebrow mb-2">View</div>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-black/30 p-1">
          {([["columns", "3D density", BarChart3], ["records", "Records", CircleDot]] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              onClick={() => onMode(value)}
              aria-pressed={mode === value}
              className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11.5px] transition ${mode === value ? "bg-cyan-300/15 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(125,211,232,.28)]" : "text-slate-400 hover:text-slate-200"}`}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>

        <button
          onClick={() => photorealStatus?.available && onPhotoreal(!photoreal)}
          disabled={!photorealStatus?.available}
          aria-pressed={photoreal}
          className={`mt-1.5 flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] transition ${photoreal ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100" : "border-white/5 bg-black/20 text-slate-300 hover:border-white/15"} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <Building2 size={13} className="shrink-0" />
          <span className="min-w-0 flex-1">
            Photorealistic 3D city
            <span className="block text-[10px] leading-snug text-slate-500">
              {photorealStatus === null
                ? "Checking…"
                : photorealStatus.available
                  ? "Google photogrammetry of the real buildings — context imagery; records are drawn on top."
                  : (photorealStatus.error ?? "Add CESIUM_ION_TOKEN (free) or GOOGLE_MAPS_API_KEY to .env, then restart.")}
            </span>
          </span>
          <span className={`h-3.5 w-6 shrink-0 rounded-full p-0.5 transition ${photoreal ? "bg-cyan-300/70" : "bg-white/10"}`}>
            <span className={`block h-2.5 w-2.5 rounded-full bg-white transition ${photoreal ? "translate-x-2.5" : ""}`} />
          </span>
        </button>

        {photorealStatus?.available && (
          <button
            onClick={onMapOnly}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border border-white/5 bg-black/20 px-2.5 py-1.5 text-left text-[11.5px] text-slate-300 transition hover:border-cyan-300/25 hover:text-cyan-100"
          >
            <Eye size={13} className="shrink-0" />
            <span className="min-w-0 flex-1">
              3D map only
              <span className="block text-[10px] leading-snug text-slate-500">Just the city — hides every record layer and panel. Press Esc to come back.</span>
            </span>
          </button>
        )}

        <div className="mt-2.5 rounded-lg border border-white/5 bg-black/20 p-2.5 text-[10.5px] leading-snug text-slate-400">
          {mode === "columns" ? (
            <>
              <div className="mb-1 font-medium text-slate-300">Reading the columns</div>
              Each hexagon is a {data.hex.radiusMeters * 2} m cell. Column height is the <span className="text-slate-200">number of records</span> in the cell, stacked by layer color; the tallest possible column is {fmt(columnMax)} records. Columns are a statistical
              encoding — <span className="text-slate-200">not building shapes or heights</span>.
            </>
          ) : (
            <>
              <div className="mb-1 font-medium text-slate-300">Reading the points</div>
              Each dot is one source record at its recorded coordinates. Click a dot for the record, or a neighborhood for its statistics.
              {active.permit && !hasNeighborhood && <div className="mt-1.5 text-amber-200/80">Individual permits ({fmt(data.summary.datasets.permit.records)}) load per neighborhood — select one. Citywide permits are shown in 3D density.</div>}
              {active.permit && hasNeighborhood && permitsState === "loading" && (
                <div className="mt-1.5 flex items-center gap-1.5 text-amber-200/80">
                  <Loader2 size={11} className="animate-spin" /> Loading permit records…
                </div>
              )}
              {active.permit && permitsState === "error" && <div className="mt-1.5 text-rose-300">Permit records for this neighborhood could not be loaded.</div>}
            </>
          )}
        </div>
      </div>

      <button onClick={onAbout} className="mt-auto flex items-center gap-2 border-t border-white/5 px-4 py-2.5 text-left text-[11.5px] text-slate-400 transition hover:bg-white/[0.03] hover:text-slate-200">
        <Database size={12} /> About the data, methods & limits
      </button>
    </div>
  );
}
