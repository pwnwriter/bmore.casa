"use client";

import { Box, ExternalLink, X } from "lucide-react";
import { LAYERS } from "@/lib/geo/constants";
import type { RecordDetail } from "@/lib/data/types";

export default function RecordCard({ record, onClose, onExplore }: { record: RecordDetail; onClose: () => void; onExplore: () => void }) {
  const meta = LAYERS[record.layer];
  return (
    <div className="glass panel-in rounded-2xl p-4" style={{ borderColor: `${meta.hex}55` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: meta.hex }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.hex, boxShadow: `0 0 8px ${meta.hex}` }} />
            {meta.label}
          </div>
          <h3 className="font-display mt-1 truncate text-[17px] font-medium text-slate-50">{record.title}</h3>
          <div className="text-[11.5px] text-slate-400">{record.neighborhood ?? "Neighborhood not assigned"}</div>
        </div>
        <button onClick={onClose} aria-label="Close record" className="rounded-md p-1 text-slate-400 transition hover:bg-white/5 hover:text-slate-100">
          <X size={15} />
        </button>
      </div>

      <div className="mt-2.5 inline-flex rounded-full border border-white/10 bg-black/30 px-2.5 py-0.5 text-[11px] text-slate-200">{record.status}</div>

      <button onClick={onExplore} className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/20"><Box size={15} />Explore building in 3D</button>

      <dl className="mt-3 space-y-1.5">
        {record.fields.map((f) => (
          <div key={f.label} className="grid grid-cols-[42%_1fr] gap-2 text-[11.5px]">
            <dt className="text-slate-500">{f.label}</dt>
            <dd className="tabular break-words text-slate-200">{f.value}</dd>
          </div>
        ))}
      </dl>

      {record.notes.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-white/5 pt-2.5">
          {record.notes.map((n, i) => (
            <li key={i} className="text-[10.5px] leading-snug text-slate-400">
              {n}
            </li>
          ))}
        </ul>
      )}

      <a href={record.sourceUrl} target="_blank" rel="noreferrer" className="mt-2.5 flex items-center gap-1 text-[10.5px] text-cyan-300/80 transition hover:text-cyan-200">
        Source layer: {record.sourceTitle} <ExternalLink size={10} />
      </a>
    </div>
  );
}
