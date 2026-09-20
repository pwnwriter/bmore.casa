"use client";

import type { YearRange } from "@/lib/data/stats";
import { fmt } from "@/lib/data/stats";

interface Props {
  years: number[];
  values: number[];
  color: string;
  /** Bars outside this range are dimmed. */
  range?: YearRange;
  /** Share a y-axis between charts (e.g. neighborhood comparison). Defaults to this series' max. */
  max?: number;
  height?: number;
  /** First/last year the source actually covers; drawn as a baseline so empty years read as "not observed". */
  coverage?: [number, number];
  showAxis?: boolean;
  label?: string;
}

/** Minimal SVG bar chart of records per year. One series, one scale, scale stated in the label. */
export default function YearBars({ years, values, color, range, max, height = 34, coverage, showAxis = false, label }: Props) {
  const top = Math.max(1, max ?? Math.max(...values));
  const n = years.length;
  const W = 100;
  const step = W / n;
  const x = (year: number) => (year - years[0]) * step;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} role="img" aria-label={label ?? "Records per year"}>
        {coverage && (
          <line x1={x(coverage[0])} x2={x(coverage[1]) + step} y1={height - 0.4} y2={height - 0.4} stroke={color} strokeOpacity={0.45} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
        )}
        {values.map((v, i) => {
          if (!v) return null;
          const h = Math.max(0.8, (v / top) * (height - 2));
          const inRange = !range || (years[i] >= range[0] && years[i] <= range[1]);
          return (
            <rect key={years[i]} x={i * step + step * 0.14} y={height - h} width={step * 0.72} height={h} rx={0.4} fill={color} opacity={inRange ? 0.92 : 0.2}>
              <title>{`${years[i]}: ${fmt(v)}`}</title>
            </rect>
          );
        })}
      </svg>
      {showAxis && (
        <div className="tabular mt-1 flex justify-between text-[9px] text-slate-500">
          <span>{years[0]}</span>
          <span>{years[Math.floor(n / 2)]}</span>
          <span>{years[n - 1]}</span>
        </div>
      )}
    </div>
  );
}
