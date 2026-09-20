"use client";

import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import { LAYER_ORDER, LAYERS } from "@/lib/geo/constants";
import { fmt, fmtDate } from "@/lib/data/stats";
import type { Summary } from "@/lib/data/types";

export default function AboutModal({ summary, onClose }: { summary: Summary; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="About the data" onClick={(e) => e.stopPropagation()} className="glass panel-in thin-scroll max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="eyebrow">Provenance · methods · limits</div>
            <h2 className="font-display mt-1 text-2xl font-medium text-slate-50">About the data</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 transition hover:bg-white/5 hover:text-slate-100">
            <X size={18} />
          </button>
        </div>

        <p className="mt-3 text-[13px] leading-relaxed text-slate-300">
          Every number in this app is computed from public ArcGIS layers published by Baltimore City’s Department of Housing & Community Development (DHCD) and city GIS. The data was downloaded once and is served from local files — nothing here is live. Assets
          generated {fmtDate(summary.generatedAt.slice(0, 10))}.
        </p>

        <div className="mt-4 overflow-x-auto rounded-xl border border-white/5">
          <table className="tabular w-full min-w-[560px] text-[11.5px]">
            <thead>
              <tr className="bg-white/[0.03] text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 font-medium">Source layer</th>
                <th className="px-2 py-2 text-right font-medium">API count</th>
                <th className="px-2 py-2 text-right font-medium">Downloaded</th>
                <th className="px-2 py-2 text-right font-medium">After cleaning</th>
                <th className="px-2 py-2 text-right font-medium">Parcels</th>
                <th className="px-3 py-2 font-medium">Dates covered</th>
              </tr>
            </thead>
            <tbody>
              {LAYER_ORDER.map((k) => {
                const d = summary.datasets[k];
                return (
                  <tr key={k} className="border-t border-white/5">
                    <td className="px-3 py-2">
                      <a href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-slate-200 hover:text-cyan-200">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: LAYERS[k].hex }} />
                        {d.layerTitle} <ExternalLink size={10} className="text-slate-500" />
                      </a>
                      <div className="pl-3 text-[10px] text-slate-500">date field: {d.dateField}</div>
                    </td>
                    <td className="px-2 py-2 text-right text-slate-300">{fmt(d.apiCount)}</td>
                    <td className="px-2 py-2 text-right text-slate-300">{fmt(d.downloaded)}</td>
                    <td className="px-2 py-2 text-right text-slate-100">
                      {fmt(d.records)}
                      {d.exactDuplicatesRemoved > 0 && <div className="text-[10px] text-slate-500">−{d.exactDuplicatesRemoved} exact duplicates</div>}
                    </td>
                    <td className="px-2 py-2 text-right text-slate-300">{fmt(d.distinctParcels)}</td>
                    <td className="px-3 py-2 text-slate-300">
                      {fmtDate(d.dateRange[0])} – {fmtDate(d.dateRange[1])}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[10.5px] text-slate-500">
          Also used: <a className="underline decoration-white/20 hover:text-slate-300" href={summary.neighborhoods.url} target="_blank" rel="noreferrer">Neighborhood Statistical Areas</a> ({summary.neighborhoods.count} polygons, with Census housing-unit counts) and{" "}
          <a className="underline decoration-white/20 hover:text-slate-300" href={summary.parcels.url} target="_blank" rel="noreferrer">Real Property</a> parcel counts per neighborhood ({fmt(summary.parcels.total_parcels)} parcels; {fmt(summary.parcels.parcels_without_matching_neighborhood)} without a matching neighborhood label are excluded from rates).
        </p>

        <h3 className="eyebrow mb-2 mt-6">What each metric counts</h3>
        <ul className="space-y-2">
          {LAYER_ORDER.map((k) => (
            <li key={k} className="flex gap-2.5 text-[12px] leading-relaxed text-slate-300">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: LAYERS[k].hex }} />
              <span>
                <span className="font-medium text-slate-100">{LAYERS[k].label}.</span> {LAYERS[k].counts}
              </span>
            </li>
          ))}
        </ul>

        <h3 className="eyebrow mb-2 mt-6">Known limits</h3>
        <ul className="list-disc space-y-1.5 pl-4 text-[12px] leading-relaxed text-slate-300 marker:text-slate-600">
          <li>
            <span className="text-slate-100">No vacancy history.</span> Both vacancy layers — including the one titled “All Vacant Building Notices” — contain only open notices; cancel and abate dates are empty on every record. Closed notices cannot be seen, so the timeline shows when
            today’s open notices were issued, not how many buildings were vacant in a past year.
          </li>
          <li>
            <span className="text-slate-100">Rehab records are a subset of permits.</span> Each is a use & occupancy permit (USE/BUSE) on a building that had a notice; every rehab record since 2019 also appears in the permit layer. The two are never added together.
          </li>
          <li>
            <span className="text-slate-100">Permits are not buildings.</span> {fmt(summary.datasets.permit.records)} permit records touch {fmt(summary.datasets.permit.distinctParcels)} parcels. Permit categories are inferred from case-number prefixes (checked against descriptions), not an
            official code list. The permit system changed in early 2025 and counts dip that year.
          </li>
          <li>
            <span className="text-slate-100">Different observation windows.</span> Demolitions begin in {summary.datasets.demolition.dateRange[0].slice(0, 4)}, rehab records in {summary.datasets.rehab.dateRange[0].slice(0, 4)}, permits in {summary.datasets.permit.dateRange[0].slice(0, 4)}.{" "}
            {summary.yearRange[1]} is a partial year.
          </li>
          <li>
            <span className="text-slate-100">Linking.</span> Records are linked across layers only through the city’s BLOCKLOT parcel identifier, never by fuzzy address matching.
          </li>
          <li>
            <span className="text-slate-100">3D columns are statistics.</span> Hexagon heights encode record counts. No building footprints or heights are drawn, because none were verified.
          </li>
          <li>Dates are converted to Baltimore local calendar dates. Declared permit costs contain obvious entry errors and are shown only per record, never summed.</li>
        </ul>
      </div>
    </div>
  );
}
