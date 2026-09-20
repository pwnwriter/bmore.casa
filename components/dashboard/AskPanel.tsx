"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, SendHorizonal, Sparkles, Square, Volume2 } from "lucide-react";
import type { YearRange } from "@/lib/data/stats";

interface Props {
  neighborhood: number | null;
  neighborhoodName: string | null;
  compare: number | null;
  compareName: string | null;
  range: YearRange;
}

interface Answer {
  answer: string;
  model: string;
  grounding: { selectedYears: [number, number]; scopes: string[]; dataDownloaded: string };
}

/** Questions are answered by Gemini from a fact sheet computed server-side - never from the model's memory. */
export default function AskPanel({ neighborhood, neighborhoodName, compare, compareName, range }: Props) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [result, setResult] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<"off" | "loading" | "on">("off");
  const audio = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setSpeaking("off");
  };
  // a new scope makes the previous answer stale
  useEffect(() => {
    setResult(null);
    setError(null);
    stop();
  }, [neighborhood, compare]);
  useEffect(() => stop, []);

  const place = neighborhoodName ?? "Baltimore";
  const suggestions =
    compareName && neighborhoodName
      ? [`How do ${neighborhoodName} and ${compareName} differ in recorded demolitions and rehab permits?`, `Which of the two has more open notices per 1,000 parcels?`]
      : [`How did recorded rehabilitation activity change in ${place}?`, `How old are the open vacant building notices in ${place}?`, `What do permits tell us about ${place}, and what don't they?`];

  const ask = async (q: string) => {
    const text = q.trim();
    if (text.length < 3 || state === "loading") return;
    setQuestion(text);
    setState("loading");
    setError(null);
    setResult(null);
    stop();
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, neighborhood, compare, range }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult(json as Answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setState("idle");
    }
  };

  const speak = async () => {
    if (speaking !== "off") return stop();
    if (!result) return;
    setSpeaking("loading");
    try {
      const res = await fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: result.answer }) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      const player = new Audio(URL.createObjectURL(await res.blob()));
      audio.current = player;
      player.onended = stop;
      await player.play();
      setSpeaking("on");
    } catch (e) {
      setSpeaking("off");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="glass rounded-2xl">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <Sparkles size={13} className="text-cyan-300" />
        <span className="text-[12.5px] font-medium text-slate-100">Ask Baltimore</span>
        <span className="truncate text-[10.5px] text-slate-500">answers only from the computed records</span>
        <ChevronDown size={14} className={`ml-auto shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="thin-scroll max-h-[42vh] overflow-y-auto border-t border-white/5 px-4 pb-3.5 pt-3">
          <form onSubmit={(e) => { e.preventDefault(); ask(question); }} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 focus-within:border-cyan-300/40">
            <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} placeholder={`Ask about ${place}'s records…`} aria-label="Ask a question about the records" className="w-full bg-transparent text-[12.5px] text-slate-100 outline-none placeholder:text-slate-500" />
            <button type="submit" disabled={state === "loading" || question.trim().length < 3} aria-label="Ask" className="text-cyan-300 transition hover:text-cyan-100 disabled:opacity-40">
              {state === "loading" ? <Loader2 size={14} className="animate-spin" /> : <SendHorizonal size={14} />}
            </button>
          </form>

          {!result && state === "idle" && (
            <div className="mt-2 flex flex-col gap-1">
              {suggestions.map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-left text-[11.5px] leading-snug text-slate-300 transition hover:border-cyan-300/25 hover:text-cyan-100">
                  {s}
                </button>
              ))}
            </div>
          )}

          {state === "loading" && <p className="mt-3 text-[11.5px] text-slate-400">Computing the fact sheet and asking Gemini…</p>}
          {error && <p className="mt-3 rounded-md border border-rose-400/20 bg-rose-400/5 px-2.5 py-2 text-[11.5px] leading-snug text-rose-200">{error}</p>}

          {result && (
            <div className="mt-3">
              <p className="text-[12.5px] leading-relaxed text-slate-200">{result.answer}</p>
              <div className="mt-2.5 flex items-start justify-between gap-3 border-t border-white/5 pt-2">
                <p className="text-[10px] leading-snug text-slate-500">
                  Grounded on a computed fact sheet: {result.grounding.scopes.join(" · ")} · records dated {result.grounding.selectedYears[0]}–{result.grounding.selectedYears[1]} · data downloaded {result.grounding.dataDownloaded}. AI-written summary ({result.model}) — check it against the panels.
                </p>
                <button onClick={speak} aria-label={speaking === "off" ? "Read the answer aloud" : "Stop reading"} title="Read aloud (ElevenLabs)" className="shrink-0 rounded-md border border-white/10 p-1.5 text-slate-300 transition hover:border-cyan-300/30 hover:text-cyan-100">
                  {speaking === "loading" ? <Loader2 size={13} className="animate-spin" /> : speaking === "on" ? <Square size={13} /> : <Volume2 size={13} />}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
