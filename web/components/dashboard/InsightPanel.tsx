"use client";

import { useMemo } from "react";
import { ArrowLeft, GitCompareArrows } from "lucide-react";
import YearBars from "@/components/charts/YearBars";
import { LAYER_ORDER, LAYERS, type LayerKey } from "@/lib/geo/constants";
import { fmt, fmtDate, layerSeries, openNoticeFacts, openNoticeRank, per1k, permitCategories, sumRange, type LayerSeries, type YearRange } from "@/lib/data/stats";
import type { CityData } from "@/lib/data/types";

interface Props {
  data: CityData;
  neighborhood: number | null;
  range: YearRange;
  series: LayerSeries;
  onSelectNeighborhood: (index: number | null) => void;
  onCompare: () => void;
}

export function StatTile({ layer, value, sub }: { layer: LayerKey; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/25 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: LAYERS[layer].hex }} />
        {LAYERS[layer].short}
      </div>
      <div className="font-display tabular mt-0.5 text-[22px] font-medium leading-none text-slate-50">{value}</div>
      {sub && <div className="tabular mt-1 text-[10.5px] text-slate-500">{sub}</div>}
    </div>
  );
}

export default function InsightPanel({ data, neighborhood, range, series, onSelectNeighborhood, onCompare }: Props) {
  const fullRange = range[0] === data.summary.yearRange[0] && range[1] === data.summary.yearRange[1];
  const rangeLabel = fullRange ? "all years" : `${range[0]}–${range[1]}`;

  const topByRate = useMemo(() => {
    return data.neighborhoods.features
      .map((f) => ({ p: f.properties, open: data.aggregates.totals[String(f.properties.i)]?.vacant?.[0] ?? 0 }))
      .filter((r) => (r.p.parcels ?? 0) >= 100)
      .map((r) => ({ ...r, rate: (1000 * r.open) / (r.p.parcels as number) }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 6);
  }, [data]);

  if (neighborhood === null) {
    return (
      <div className="glass panel-in thin-scroll max-h-full overflow-y-auto rounded-2xl p-4">
        <div className="eyebrow">Citywide · {rangeLabel}</div>
        <h2 className="font-display mt-1 text-xl font-medium text-slate-50">Baltimore City</h2>
        <p className="mt-0.5 text-[11.5px] text-slate-400">
          {fmt(data.summary.neighborhoods.count)} neighborhoods · {fmt(data.summary.parcels.total_parcels)} real-property parcels
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {LAYER_ORDER.map((k) => (
            <StatTile key={k} layer={k} value={fmt(sumRange(series, k, range))} sub={fullRange ? `${fmt(data.aggregates.cityTotals[k][1])} distinct parcels` : `records dated ${rangeLabel}`} />
          ))}
        </div>

        <div className="eyebrow mb-2 mt-5">Open notices per 1,000 parcels — highest</div>
        <ul className="space-y-0.5">
          {topByRate.map((r, i) => (
            <li key={r.p.i}>
              <button onClick={() => onSelectNeighborhood(r.p.i)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition hover:bg-white/5">
                <span className="tabular w-4 text-slate-500">{i + 1}</span>
                <span className="flex-1 truncate text-slate-200">{r.p.name}</span>
                <span className="tabular text-slate-400">{fmt(r.open)} open</span>
                <span className="tabular w-12 text-right font-medium text-[var(--color-vacant)]">{fmt(r.rate)}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-1 px-2 text-[10px] leading-snug text-slate-500">All-time open notices ÷ parcels in the city’s real-property layer; neighborhoods with at least 100 parcels.</p>

        <div className="eyebrow mb-2 mt-5">Patterns verified in the data</div>
        <ul className="space-y-2">
          {data.summary.findings.map((f) => (
            <li key={f.id} className="rounded-lg border border-white/5 bg-black/20 p-2.5">
              <div className="text-[12px] font-medium text-slate-100">{f.title}</div>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-400">{f.text}</p>
              <p className="mt-1 text-[10px] text-slate-600">Metric: {f.metric}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[10.5px] leading-snug text-slate-500">Select a neighborhood on the map to see its records. These are descriptive counts; the records do not explain why a place changed.</p>
      </div>
    );
  }

  return <NeighborhoodInsight data={data} neighborhood={neighborhood} range={range} rangeLabel={rangeLabel} fullRange={fullRange} series={series} onBack={() => onSelectNeighborhood(null)} onCompare={onCompare} />;
}

function NeighborhoodInsight({ data, neighborhood, range, rangeLabel, fullRange, series, onBack, onCompare }: { data: CityData; neighborhood: number; range: YearRange; rangeLabel: string; fullRange: boolean; series: LayerSeries; onBack: () => void; onCompare: () => void }) {
  const props = data.neighborhoods.features[neighborhood].properties;
  const totals = data.aggregates.totals[String(neighborhood)] ?? {};
  const facts = useMemo(() => openNoticeFacts(data.points.vacant, neighborhood), [data, neighborhood]);
  const rank = useMemo(() => openNoticeRank(data, neighborhood), [data, neighborhood]);
  const categories = permitCategories(data.aggregates, neighborhood, range);
  const permitTotal = categories.reduce((s, c) => s + c.records, 0);
  const citySeries = useMemo(() => layerSeries(data.aggregates, data.summary, null), [data]);

  const period = (layer: LayerKey, from: number, to: number) => sumRange(series, layer, [from, to]);
  const bullets: string[] = [];
  if (rank && facts.total > 0) bullets.push(`Ranks ${fmt(rank.rank)} of ${fmt(rank.of)} neighborhoods (≥${rank.minParcels} parcels) for open notices per 1,000 parcels.`);
  if (facts.total > 0) {
    bullets.push(`${fmt(facts.before2016)} of its ${fmt(facts.total)} open notices (${fmt((100 * facts.before2016) / facts.total)}%) were issued before 2016; the oldest is dated ${fmtDate(facts.oldest)}. ${fmt(facts.since2022)} were issued in 2022 or later.`);
  } else bullets.push("No open vacant building notices are recorded here in the source snapshot.");
  if (facts.withRehab > 0) bullets.push(`${fmt(facts.withRehab)} open-notice parcel${facts.withRehab === 1 ? "" : "s"} also ha${facts.withRehab === 1 ? "s" : "ve"} an earlier rehab permit record (matched on BLOCKLOT).`);
  const r1 = period("rehab", 2015, 2019);
  const r2 = period("rehab", 2020, 2024);
  if (r1 + r2 > 0) bullets.push(`Rehab permit records: ${fmt(r1)} issued 2015–2019 and ${fmt(r2)} issued 2020–2024 (two full five-year windows).`);
  const d1 = period("demolition", 2015, 2019);
  const d2 = period("demolition", 2020, 2024);
  if (d1 + d2 > 0) bullets.push(`Completed city demolitions: ${fmt(d1)} in 2015–2019 and ${fmt(d2)} in 2020–2024.`);
  const cityOpen = data.aggregates.cityTotals.vacant[0];
  if (facts.total > 0) bullets.push(`Holds ${fmt((100 * facts.total) / cityOpen, 1)}% of the city’s ${fmt(cityOpen)} open notices and ${fmt((100 * (props.parcels ?? 0)) / data.summary.parcels.total_parcels, 1)}% of its parcels.`);

  return (
    <div className="glass panel-in thin-scroll max-h-full overflow-y-auto rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1 rounded-md py-1 pr-2 text-[11px] text-slate-400 transition hover:text-cyan-200">
          <ArrowLeft size={12} /> Full city
        </button>
        <button onClick={onCompare} className="flex items-center gap-1.5 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1 text-[11px] text-cyan-100 transition hover:bg-cyan-300/20">
          <GitCompareArrows size={12} /> Compare
        </button>
      </div>
      <div className="eyebrow mt-2">Neighborhood · {rangeLabel}</div>
      <h2 className="font-display mt-1 text-xl font-medium leading-tight text-slate-50">{props.name}</h2>
      <p className="mt-0.5 text-[11.5px] text-slate-400">
        {fmt(props.parcels)} parcels · {fmt(props.housingUnits)} housing units (Census, via city NSA layer)
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {LAYER_ORDER.map((k) => {
          const count = sumRange(series, k, range);
          const rate = per1k(count, props.parcels);
          const sub = rate === null ? "no parcel denominator" : `${fmt(rate, rate < 10 ? 1 : 0)} per 1,000 parcels`;
          return <StatTile key={k} layer={k} value={fmt(count)} sub={k === "permit" && fullRange ? `${sub} · ${fmt(totals.permit?.[1] ?? 0)} distinct parcels` : sub} />;
        })}
      </div>

      <div className="eyebrow mb-1.5 mt-5">Computed from the records</div>
      <ul className="space-y-1.5">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-slate-300">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-cyan-300/70" />
            {b}
          </li>
        ))}
      </ul>

      <div className="eyebrow mb-2 mt-5">Records per year</div>
      <div className="space-y-2.5">
        {LAYER_ORDER.map((k) => {
          const coverage: [number, number] = [Number(data.summary.datasets[k].dateRange[0].slice(0, 4)), Number(data.summary.datasets[k].dateRange[1].slice(0, 4))];
          const peak = Math.max(...series.byLayer[k]);
          return (
            <div key={k}>
              <div className="mb-0.5 flex justify-between text-[10.5px]">
                <span className="text-slate-400">{LAYERS[k].label}</span>
                <span className="tabular text-slate-500">peak {fmt(peak)}/yr</span>
              </div>
              <YearBars years={series.years} values={series.byLayer[k]} color={LAYERS[k].hex} range={range} height={30} coverage={coverage} label={`${LAYERS[k].label} per year in ${props.name}`} />
            </div>
          );
        })}
        <div className="tabular flex justify-between text-[9.5px] text-slate-500">
          <span>{series.years[0]}</span>
          <span>{series.years[series.years.length - 1]} (partial)</span>
        </div>
      </div>

      {permitTotal > 0 && (
        <>
          <div className="eyebrow mb-2 mt-5">Permit categories · {rangeLabel}</div>
          <ul className="space-y-1.5">
            {categories.map((c) => (
              <li key={c.category}>
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-300">{c.label}</span>
                  <span className="tabular text-slate-400">{fmt(c.records)}</span>
                </div>
                <div className="mt-0.5 h-1 overflow-hidden rounded bg-white/5">
                  <div className="h-full rounded bg-[var(--color-permit)]" style={{ width: `${(100 * c.records) / permitTotal}%`, opacity: 0.85 }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] leading-snug text-slate-500">Categories come from the case-number prefix. The permit system changed in early 2025, and city-wide permit counts dip that year ({fmt(citySeries.byLayer.permit[citySeries.years.indexOf(2024)])} in 2024 → {fmt(citySeries.byLayer.permit[citySeries.years.indexOf(2025)])} in 2025) — treat 2025+ with care.</p>
        </>
      )}

      <p className="mt-4 border-t border-white/5 pt-3 text-[10.5px] leading-snug text-slate-500">
        Descriptive counts of public records. They do not show why this neighborhood changed, and a historical notice is not proof a building is vacant today.
      </p>
    </div>
  );
}
