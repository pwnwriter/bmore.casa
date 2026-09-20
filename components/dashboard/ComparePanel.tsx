"use client";

import { useMemo } from "react";
import { MousePointerClick, X } from "lucide-react";
import YearBars from "@/components/charts/YearBars";
import { LAYER_ORDER, LAYERS } from "@/lib/geo/constants";
import { fmt, layerSeries, per1k, sumRange, type YearRange } from "@/lib/data/stats";
import type { CityData } from "@/lib/data/types";

interface Props {
  data: CityData;
  a: number;
  b: number | null;
  range: YearRange;
  onA: (index: number) => void;
  onB: (index: number | null) => void;
  onClose: () => void;
}

export default function ComparePanel({ data, a, b, range, onA, onB, onClose }: Props) {
  const options = useMemo(() => data.neighborhoods.features.map((f) => f.properties), [data]);
  const seriesA = useMemo(() => layerSeries(data.aggregates, data.summary, a), [data, a]);
  const seriesB = useMemo(() => (b === null ? null : layerSeries(data.aggregates, data.summary, b)), [data, b]);
  const fullRange = range[0] === data.summary.yearRange[0] && range[1] === data.summary.yearRange[1];
  const A = options[a];
  const B = b === null ? null : options[b];

  const select = (value: number | null, onChange: (v: number) => void, label: string, accent: string) => (
    <label className="block min-w-0">
      <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: accent }}>
        {label}
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => e.target.value !== "" && onChange(Number(e.target.value))}
        className="w-full truncate rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[12.5px] text-slate-100 outline-none focus:border-cyan-300/40"
      >
        {value === null && <option value="">Choose a neighborhood…</option>}
        {options.map((o) => (
          <option key={o.i} value={o.i}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="glass panel-in thin-scroll max-h-full overflow-y-auto rounded-2xl p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="eyebrow">Neighborhood comparison · {fullRange ? "all years" : `${range[0]}–${range[1]}`}</div>
          <h2 className="font-display mt-1 text-lg font-medium text-slate-50">Side by side</h2>
        </div>
        <button onClick={onClose} aria-label="Close comparison" className="rounded-md p-1 text-slate-400 transition hover:bg-white/5 hover:text-slate-100">
          <X size={15} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {select(a, onA, "A", "#7be7f5")}
        {select(b, (v) => onB(v), "B", "#f0c987")}
      </div>
      {b === null && (
        <p className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-white/10 px-2.5 py-2 text-[11.5px] text-slate-400">
          <MousePointerClick size={13} className="shrink-0 text-cyan-300" /> Pick neighborhood B from the list, or click one on the map.
        </p>
      )}

      {B && seriesB && (
        <>
          <div className="mt-4 overflow-hidden rounded-xl border border-white/5">
            <table className="tabular w-full text-[11.5px]">
              <thead>
                <tr className="bg-white/[0.03] text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-2.5 py-1.5 font-medium">Records</th>
                  <th className="px-2 py-1.5 text-right font-medium text-[#7be7f5]">A</th>
                  <th className="px-2 py-1.5 text-right font-medium text-[#f0c987]">B</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-white/5 text-slate-400">
                  <td className="px-2.5 py-1.5">Parcels (denominator)</td>
                  <td className="px-2 py-1.5 text-right">{fmt(A.parcels)}</td>
                  <td className="px-2 py-1.5 text-right">{fmt(B.parcels)}</td>
                </tr>
                {LAYER_ORDER.map((k) => {
                  const ca = sumRange(seriesA, k, range);
                  const cb = sumRange(seriesB, k, range);
                  const ra = per1k(ca, A.parcels);
                  const rb = per1k(cb, B.parcels);
                  return (
                    <tr key={k} className="border-t border-white/5 align-top">
                      <td className="px-2.5 py-1.5 text-slate-300">
                        <span className="mr-1.5 inline-block h-1.5 w-1.5 -translate-y-px rounded-full" style={{ background: LAYERS[k].hex }} />
                        {LAYERS[k].short}
                        <div className="pl-3 text-[10px] text-slate-500">per 1,000 parcels</div>
                      </td>
                      {[[ca, ra], [cb, rb]].map(([count, rate], i) => (
                        <td key={i} className="px-2 py-1.5 text-right">
                          <div className="font-medium text-slate-100">{fmt(count)}</div>
                          <div className="text-[10px] text-slate-500">{rate === null ? "-" : fmt(rate, 1)}</div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="eyebrow mb-2 mt-5">Records per year · shared scale per row</div>
          <div className="space-y-3">
            {LAYER_ORDER.map((k) => {
              const max = Math.max(1, ...seriesA.byLayer[k], ...seriesB.byLayer[k]);
              const coverage: [number, number] = [Number(data.summary.datasets[k].dateRange[0].slice(0, 4)), Number(data.summary.datasets[k].dateRange[1].slice(0, 4))];
              return (
                <div key={k}>
                  <div className="mb-1 flex justify-between text-[10.5px]">
                    <span className="text-slate-400">{LAYERS[k].label}</span>
                    <span className="tabular text-slate-500">
                      {coverage[0]}–{coverage[1]} · axis max {fmt(max)}/yr
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <YearBars years={seriesA.years} values={seriesA.byLayer[k]} color={LAYERS[k].hex} range={range} max={max} height={34} coverage={coverage} label={`${LAYERS[k].label} per year in ${A.name}`} />
                    <YearBars years={seriesB.years} values={seriesB.byLayer[k]} color={LAYERS[k].hex} range={range} max={max} height={34} coverage={coverage} label={`${LAYERS[k].label} per year in ${B.name}`} />
                  </div>
                </div>
              );
            })}
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <span className="truncate text-[#7be7f5]">A · {A.name}</span>
              <span className="truncate text-[#f0c987]">B · {B.name}</span>
            </div>
          </div>
        </>
      )}

      <div className="mt-4 space-y-1.5 border-t border-white/5 pt-3 text-[10.5px] leading-snug text-slate-500">
        <p>
          <span className="text-slate-400">Rates</span> divide record counts by each neighborhood’s parcel count in the city real-property layer ({fmt(data.summary.parcels.total_parcels)} parcels). They are rates of <em>records</em>; a parcel can have many permits.
        </p>
        <p>
          <span className="text-slate-400">Observation periods differ:</span> open notices reach back to {data.summary.datasets.vacant.dateRange[0].slice(0, 4)} but only include notices still open; demolitions start {data.summary.datasets.demolition.dateRange[0].slice(0, 4)}, rehab records {data.summary.datasets.rehab.dateRange[0].slice(0, 4)}, permits {data.summary.datasets.permit.dateRange[0].slice(0, 4)}. {data.summary.yearRange[1]} is a partial year.
        </p>
        <p>Differences between neighborhoods are descriptive. The records do not establish causes.</p>
      </div>
    </div>
  );
}
