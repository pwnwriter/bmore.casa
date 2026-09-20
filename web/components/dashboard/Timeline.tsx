"use client";

import { useEffect, useState } from "react";
import { Info, Pause, Play, RotateCcw } from "lucide-react";
import YearBars from "@/components/charts/YearBars";
import { LAYER_ORDER, LAYERS, type LayerKey } from "@/lib/geo/constants";
import { fmt, sumRange, type LayerSeries, type YearRange } from "@/lib/data/stats";
import type { Summary } from "@/lib/data/types";

interface Props {
  summary: Summary;
  series: LayerSeries;
  scope: string;
  active: Record<LayerKey, boolean>;
  range: YearRange;
  onRange: (range: YearRange) => void;
}

const STEP_MS = 750;

export default function Timeline({ summary, series, scope, active, range, onRange }: Props) {
  const [min, max] = summary.yearRange;
  const [playing, setPlaying] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const shown = LAYER_ORDER.filter((k) => active[k]);

  // Play sweeps the end year forward, accumulating records by their recorded dates.
  useEffect(() => {
    if (!playing) return;
    if (range[1] >= max) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => onRange([range[0], range[1] + 1]), STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, range, max, onRange]);

  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (range[1] >= max) onRange([range[0], Math.min(max, range[0])]);
    setPlaying(true);
  };

  return (
    <div className="glass panel-in rounded-2xl px-4 pb-3 pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          onClick={togglePlay}
          aria-label={playing ? "Pause timeline" : "Play timeline"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-cyan-200 transition hover:bg-cyan-300/20"
        >
          {playing ? <Pause size={14} /> : <Play size={14} className="translate-x-px" />}
        </button>
        <div className="min-w-0">
          <div className="eyebrow">Time machine · {scope}</div>
          <div className="font-display tabular text-lg font-medium leading-tight text-slate-50">
            {range[0] === range[1] ? range[0] : `${range[0]} – ${range[1]}`}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {(range[0] !== min || range[1] !== max) && (
            <button onClick={() => { setPlaying(false); onRange([min, max]); }} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-400 transition hover:bg-white/5 hover:text-slate-200">
              <RotateCcw size={11} /> All years
            </button>
          )}
          <button onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-400 transition hover:bg-white/5 hover:text-slate-200">
            <Info size={12} /> What is counted?
          </button>
        </div>
      </div>

      {showHelp && (
        <div className="mt-2 rounded-lg border border-white/5 bg-black/25 p-3 text-[11px] leading-relaxed text-slate-300">
          <p className="mb-1.5 text-slate-200">
            The timeline filters <em>records by their recorded date</em>. It does not reconstruct what the city looked like in a past year — the sources cannot support that.
          </p>
          <ul className="space-y-1">
            {LAYER_ORDER.map((k) => (
              <li key={k} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: LAYERS[k].hex }} />
                <span>
                  <span className="text-slate-100">{LAYERS[k].short}</span> ({summary.datasets[k].dateRange[0].slice(0, 4)}–{summary.datasets[k].dateRange[1].slice(0, 4)}): {LAYERS[k].counts}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2 space-y-1">
        {shown.length === 0 && <div className="py-3 text-center text-xs text-slate-500">Turn on a layer to see its records over time.</div>}
        {shown.map((k) => {
          const coverage: [number, number] = [Number(summary.datasets[k].dateRange[0].slice(0, 4)), Number(summary.datasets[k].dateRange[1].slice(0, 4))];
          return (
            <div key={k} className="grid grid-cols-[92px_1fr_64px] items-end gap-2">
              <div className="truncate pb-px text-[10.5px] text-slate-400">{LAYERS[k].short}</div>
              <YearBars years={series.years} values={series.byLayer[k]} color={LAYERS[k].hex} range={range} height={22} coverage={coverage} label={`${LAYERS[k].label} per year`} />
              <div className="tabular pb-px text-right text-[11px] font-medium" style={{ color: LAYERS[k].hex }}>
                {fmt(sumRange(series, k, range))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-[92px_1fr_64px] gap-2">
        <div />
        <div>
          <div className="range-dual mt-1">
            <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
            <div
              className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded bg-cyan-300/70"
              style={{ left: `${((range[0] - min) / (max - min)) * 100}%`, right: `${((max - range[1]) / (max - min)) * 100}%` }}
            />
            <input type="range" aria-label="Start year" min={min} max={max} step={1} value={range[0]} onChange={(e) => { setPlaying(false); onRange([Math.min(Number(e.target.value), range[1]), range[1]]); }} />
            <input type="range" aria-label="End year" min={min} max={max} step={1} value={range[1]} onChange={(e) => { setPlaying(false); onRange([range[0], Math.max(Number(e.target.value), range[0])]); }} />
          </div>
          <div className="tabular flex justify-between text-[9.5px] text-slate-500">
            <span>{min}</span>
            <span>{Math.round((min + max) / 2)}</span>
            <span>{max} (partial)</span>
          </div>
        </div>
        <div />
      </div>
      <p className="mt-1.5 hidden text-[10px] leading-snug text-slate-500 sm:block">
        Bars: records per year by recorded date, each row on its own scale. Baselines mark the years each source covers — the sources start at different times, so absent bars mean “not observed”, not zero activity.
      </p>
    </div>
  );
}
