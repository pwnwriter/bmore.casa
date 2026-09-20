"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Film, Loader2, RefreshCw, Upload } from "lucide-react";
import type { PropertyRef } from "@/lib/property/types";

export default function RenovationVideo({ property }: { property: PropertyRef }) {
  const [brief, setBrief] = useState("Restore the facade with realistic masonry, refreshed windows, and a welcoming entrance. Preserve the building's shape and the neighboring homes.");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "starting" | "waiting" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const storageKey = `property-video:${property.layer}:${property.index}:${property.neighborhood ?? ""}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (saved?.token && saved.expires > Date.now()) { setToken(saved.token); setState("waiting"); }
      else sessionStorage.removeItem(storageKey);
    } catch { /* Storage can be unavailable in private browsing. */ }
  }, [storageKey]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!photo) { setPreview(null); return; }
    const url = URL.createObjectURL(photo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  useEffect(() => {
    if (!token || state !== "waiting") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const started = Date.now();
    const poll = async () => {
      try {
        const res = await fetch(`/api/property/video?token=${encodeURIComponent(token)}`, { signal: controller.signal });
        const json = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok) { setError(json.error ?? "Video generation failed."); setState("error"); return; }
        if (json.done) { setState("ready"); return; }
        failures = 0;
        if (Date.now() - started > 12 * 60_000) { setError("The video is still processing. Check again shortly."); setState("error"); return; }
      } catch {
        if (controller.signal.aborted) return;
        if (++failures >= 3) { setError("Connection interrupted. Check the existing video again."); setState("error"); return; }
      }
      timer = setTimeout(poll, 10_000);
    };
    timer = setTimeout(poll, 5000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, state]);
  const generate = async () => {
    if (!photo || !brief.trim()) return;
    setState("starting"); setError(null); setToken(null);
    try {
      const form = new FormData(); form.set("photo", photo); form.set("brief", brief); form.set("property", JSON.stringify(property));
      // Closing the viewer must not discard a job the provider has already billed.
      const response = await fetch("/api/property/video", { method: "POST", body: form });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      try { sessionStorage.setItem(storageKey, JSON.stringify({ token: json.token, expires: Date.now() + 11 * 3600_000 })); } catch { /* Polling still works without storage. */ }
      if (mounted.current) { setToken(json.token); setState("waiting"); }
    } catch (e) { if (mounted.current) { setError(e instanceof Error ? e.message : "Video generation failed."); setState("error"); } }
  };
  const busy = state === "starting" || state === "waiting";
  const media = token ? `/api/property/video?token=${encodeURIComponent(token)}&media=1` : "";
  return <div className="grid h-full min-h-0 grid-rows-[minmax(180px,45%)_1fr] bg-zinc-950 md:grid-cols-[minmax(0,1fr)_340px] md:grid-rows-1">
    <div className="relative flex min-h-0 items-center justify-center overflow-hidden bg-black">
      {state === "ready" ? <video key={media} controls playsInline src={media} className="h-full w-full object-contain" aria-label="Proposed renovation video" /> : preview ? <img src={preview} alt="Uploaded property reference" className="h-full w-full object-contain" /> : <button onClick={() => input.current?.click()} className="flex flex-col items-center gap-3 px-8 py-10 text-sm text-zinc-400"><Upload size={28} />Add a property photo</button>}
      <span className="pointer-events-none absolute left-3 top-3 rounded bg-black/80 px-3 py-1.5 text-xs text-amber-200">{state === "ready" ? "AI renovation concept / Not existing conditions" : "Proposed renovation"}</span>
      {busy && <div className="absolute inset-0 flex items-center justify-center gap-3 bg-black/65 px-6 text-center text-sm"><Loader2 className="shrink-0 animate-spin" size={20} />{state === "starting" ? "Starting your film..." : "Creating the renovation film. This can take a few minutes."}</div>}
    </div>
    <aside className="min-h-0 overflow-y-auto border-t border-white/10 p-5 md:border-l md:border-t-0">
      <h3 className="text-base font-medium">A possible next chapter</h3>
      <label className="mt-5 block text-xs text-zinc-400" htmlFor="property-photo">Property photo</label>
      <input ref={input} id="property-photo" type="file" accept="image/jpeg,image/png" disabled={busy} className="mt-2 w-full min-w-0 text-xs text-zinc-400 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-zinc-100" onChange={e => {
        const file = e.target.files?.[0]; if (!file) return;
        if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 8 * 1024 * 1024) { setError("Choose a JPEG or PNG under 8 MB."); e.target.value = ""; return; }
        setPhoto(file); setState("idle"); setToken(null); setError(null);
        try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
      }} />
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">Use a photo you own or have permission to use. JPEG or PNG, up to 8 MB.</p>
      <label htmlFor="renovation-brief" className="mt-5 block text-xs text-zinc-400">Renovation brief</label>
      <textarea id="renovation-brief" value={brief} onChange={e => setBrief(e.target.value)} maxLength={600} rows={5} disabled={busy} className="mt-2 w-full resize-y rounded-md border border-white/15 bg-zinc-900 p-3 text-sm leading-relaxed outline-none focus:border-cyan-300" />
      <button onClick={generate} disabled={busy || !photo || !brief.trim()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-cyan-300 px-3 py-3 text-sm font-medium text-zinc-950 disabled:opacity-40"><Film size={16} />Generate renovation film</button>
      <p className="mt-2 text-[11px] text-zinc-500">8 seconds / 720p / Uses your video API quota</p>
      {error && <p role="alert" className="mt-4 text-sm leading-relaxed text-rose-300">{error}</p>}
      {state === "error" && token && <button onClick={() => { setError(null); setState("waiting"); }} className="mt-3 flex items-center gap-2 text-sm text-cyan-300"><RefreshCw size={14} />Check existing video</button>}
      {state === "ready" && <a href={`${media}&download=1`} className="mt-4 flex items-center justify-center gap-2 rounded-md border border-white/15 px-3 py-2 text-sm"><Download size={16} />Download concept</a>}
      <p className="mt-5 border-t border-white/10 pt-4 text-xs leading-relaxed text-zinc-500">The film imagines exterior changes from your reference photo. It may alter details and does not establish construction feasibility, permissions, or future conditions.</p>
    </aside>
  </div>;
}
