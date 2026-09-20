"use client";

import { ArrowRight, ArrowUpRight, BookOpen } from "lucide-react";
import { LAYER_ORDER, LAYERS } from "@/lib/geo/constants";
import { fmt } from "@/lib/data/stats";
import type { Summary } from "@/lib/data/types";
import { MOLAB_URL, NOTEBOOK_URL } from "@/lib/site";

function NotebookLink({ href, place, note, external }: { href: string; place: string; note: string; external?: boolean }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="group flex items-center gap-3 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 backdrop-blur-sm transition hover:border-white/30 hover:bg-white/10"
    >
      <BookOpen size={18} className="shrink-0 text-slate-300" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium tracking-wide text-slate-50">
          View notebook <span className="text-slate-500">/</span> <span className="text-cyan-300">{place}</span>
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{note}</span>
      </span>
      <ArrowUpRight size={15} className="shrink-0 text-slate-400 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </a>
  );
}

export default function Intro({ summary, onExplore }: { summary: Summary | null; onExplore: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center px-6 text-center">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(6,10,20,0.35)_0%,rgba(6,10,20,0.82)_70%,rgba(6,10,20,0.96)_100%)]" />
      <div className="relative">
        <div className="eyebrow rise" style={{ animationDelay: "0.1s" }}>
          A civic data twin · HopHacks 2026
        </div>
        <h1 className="font-display rise mt-4 text-[clamp(2.4rem,7vw,5.6rem)] font-medium leading-[0.95] tracking-[0.08em] text-slate-50" style={{ animationDelay: "0.25s", textShadow: "0 0 60px rgba(77,214,232,0.25)" }}>
          BMORE<span className="text-cyan-300">.CASA</span>
        </h1>
        <p className="rise mx-auto mt-5 max-w-xl text-[clamp(0.95rem,1.6vw,1.15rem)] leading-relaxed text-slate-300" style={{ animationDelay: "0.45s" }}>
          Explore the changing landscape of Baltimore, one building at a time.
        </p>

        <div className="rise mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2" style={{ animationDelay: "0.6s" }}>
          {LAYER_ORDER.map((k) => (
            <div key={k} className="flex items-center gap-2 text-[12px] text-slate-400">
              <span className="h-2 w-2 rounded-full" style={{ background: LAYERS[k].hex, boxShadow: `0 0 10px ${LAYERS[k].hex}` }} />
              <span className="tabular font-medium text-slate-200">{summary ? fmt(summary.datasets[k].records) : "…"}</span>
              {LAYERS[k].short.toLowerCase()}
            </div>
          ))}
        </div>

        <div className="rise pointer-events-auto mx-auto mt-10 flex max-w-xl flex-col items-center gap-3" style={{ animationDelay: "0.75s" }}>
          <button
            onClick={onExplore}
            disabled={!summary}
            className="group inline-flex items-center gap-2.5 rounded-full border border-cyan-300/40 bg-cyan-300/10 px-8 py-3.5 text-sm font-medium tracking-wide text-cyan-50 shadow-[0_0_40px_-8px_rgba(77,214,232,0.55)] transition hover:bg-cyan-300/20 disabled:opacity-50"
          >
            {summary ? "Explore Baltimore" : "Loading city records…"}
            <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
          </button>
          <div className={`grid w-full gap-3 text-left ${MOLAB_URL ? "sm:grid-cols-2" : "max-w-xs"}`}>
            <NotebookLink href={NOTEBOOK_URL} place="casa" note="Hosted right here. Opens instantly, nothing to install." />
            {MOLAB_URL && <NotebookLink href={MOLAB_URL} place="molab" note="On marimo's molab cloud. Read the code, run it, fork it." external />}
          </div>
        </div>
        <p className="rise mt-6 text-[11px] text-slate-500" style={{ animationDelay: "0.9s" }}>
          Real public records from Baltimore City DHCD. Columns show record counts, not buildings.
        </p>
      </div>
    </div>
  );
}
