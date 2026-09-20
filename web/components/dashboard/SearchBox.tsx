"use client";

import { useMemo, useState } from "react";
import { MapPin, Search, X } from "lucide-react";
import { LAYERS, type LayerKey } from "@/lib/geo/constants";
import type { CityData, PointSet } from "@/lib/data/types";

export type SearchHit = { kind: "neighborhood"; index: number } | { kind: "record"; layer: LayerKey; index: number };

interface Row {
  hit: SearchHit;
  title: string;
  subtitle: string;
  color?: string;
}

interface Props {
  data: CityData;
  permits: PointSet | null;
  onSelect: (hit: SearchHit) => void;
}

const LIMIT = 8;
const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Address search over the loaded record sets plus neighborhood names - all client-side. */
export default function SearchBox({ data, permits, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const q = normalize(query);
    if (q.length < 2) return [];
    const out: Row[] = [];
    for (const f of data.neighborhoods.features) {
      if (out.length >= 3) break;
      if (normalize(f.properties.name).includes(q)) out.push({ hit: { kind: "neighborhood", index: f.properties.i }, title: f.properties.name, subtitle: "Neighborhood" });
    }
    if (q.length < 3) return out;
    const sets: PointSet[] = [data.points.vacant, data.points.rehab, data.points.demolition, ...(permits ? [permits] : [])];
    for (const set of sets) {
      let found = 0;
      for (let i = 0; i < set.length && found < 3 && out.length < LIMIT; i++) {
        const address = set.address[i];
        if (address && address.includes(q)) {
          found++;
          out.push({ hit: { kind: "record", layer: set.layer, index: i }, title: address, subtitle: `${LAYERS[set.layer].short} · ${set.date[i] ?? "no date"}`, color: LAYERS[set.layer].hex });
        }
      }
    }
    return out;
  }, [query, data, permits]);

  const choose = (row: Row) => {
    onSelect(row.hit);
    setOpen(false);
    setQuery(row.title);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 transition focus-within:border-cyan-300/40">
        <Search size={13} className="shrink-0 text-slate-500" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" && rows[0]) choose(rows[0]); if (e.key === "Escape") setOpen(false); }}
          placeholder="Search an address or neighborhood"
          aria-label="Search an address or neighborhood"
          className="w-full bg-transparent text-[12.5px] text-slate-100 outline-none placeholder:text-slate-500"
        />
        {query && (
          <button onClick={() => { setQuery(""); setOpen(false); }} aria-label="Clear search" className="text-slate-500 hover:text-slate-300">
            <X size={13} />
          </button>
        )}
      </div>
      {open && query.trim().length >= 2 && (
        <div className="glass absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg">
          {rows.length === 0 ? (
            <div className="px-3 py-2.5 text-[11.5px] text-slate-400">
              No match in open notices, rehab or demolition records{permits ? " or this neighborhood’s permits" : ""}. Permit addresses become searchable once a neighborhood is selected.
            </div>
          ) : (
            rows.map((row, i) => (
              <button key={i} onClick={() => choose(row)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-white/5">
                {row.color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} /> : <MapPin size={12} className="shrink-0 text-cyan-300" />}
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-slate-100">{row.title}</span>
                  <span className="block text-[10.5px] text-slate-500">{row.subtitle}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
