"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Circle, Download, Info, Loader2, Pause, Play, RotateCcw, Square, Volume2, X } from "lucide-react";
import type { PropertyRef } from "@/lib/property/types";
import type { RecordDetail } from "@/lib/data/types";
import { TOUR_SECONDS, tourPose } from "@/lib/property/tour";
import { recordCanvasTour } from "@/lib/property/recording";
import type { SceneHandle } from "./PhotorealScene";
import RenovationVideo from "./RenovationVideo";

const PhotorealScene = dynamic(() => import("./PhotorealScene"), { ssr: false });

export default function PropertyExplorer({ property, onClose }: { property: PropertyRef; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scene = useRef<SceneHandle>(null);
  const [record, setRecord] = useState<RecordDetail | null>(null);
  const [view, setView] = useState<"existing" | "proposed">("existing");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [mapError, setMapError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [details, setDetails] = useState(false);
  const [story, setStory] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [narrated, setNarrated] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [recording, setRecording] = useState(false);
  const [download, setDownload] = useState<{ url: string; extension: string } | null>(null);
  const [canRecord, setCanRecord] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const speechRequest = useRef<AbortController | null>(null);
  const soundGraph = useRef<{ context: AudioContext; destination: MediaStreamAudioDestinationNode } | null>(null);
  const capture = useRef<{ stop: () => void } | null>(null);
  const mounted = useRef(true);
  const state = useRef({ time, playing, narrated });
  state.current = { time, playing, narrated };
  const downloadRef = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    dialog.current?.showModal();
    setCanRecord(typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function");
    return () => {
      mounted.current = false;
      speechRequest.current?.abort();
      capture.current?.stop();
      audio.current?.pause();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      if (downloadRef.current) URL.revokeObjectURL(downloadRef.current);
      void soundGraph.current?.context.close();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ layer: property.layer, index: String(property.index), ...(property.neighborhood !== undefined ? { neighborhood: String(property.neighborhood) } : {}) });
    fetch(`/api/property/record?${query}`, { signal: controller.signal }).then(async response => {
      const json = await response.json(); if (!response.ok) throw new Error(json.error);
      if (!controller.signal.aborted) setRecord(json);
    }).catch(e => { if (!controller.signal.aborted) { setStatus("error"); setMapError(e.message); } });
    return () => controller.abort();
  }, [property.layer, property.index, property.neighborhood, attempt]);

  const pause = () => { scene.current?.pause(); audio.current?.pause(); capture.current?.stop(); };
  const seek = (seconds: number) => {
    scene.current?.seek(seconds);
    if (audio.current) audio.current.currentTime = Math.min(seconds, Number.isFinite(audio.current.duration) ? audio.current.duration : seconds);
  };
  const play = async () => {
    if (time >= TOUR_SECONDS) seek(0);
    if (narrated && audio.current) {
      try { await soundGraph.current?.context.resume(); await audio.current.play(); }
      catch { setError("Audio playback was blocked. Toggle narration off to play a silent tour."); return; }
    }
    scene.current?.play();
  };
  const prepare = async () => {
    if (preparing) return;
    pause(); setPreparing(true); setError(null);
    const controller = new AbortController(); speechRequest.current = controller;
    try {
      const context = new AudioContext();
      await context.resume();
      await soundGraph.current?.context.close();
      const destination = context.createMediaStreamDestination();
      soundGraph.current = { context, destination };
      const response = await fetch("/api/property/story", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(property), signal: controller.signal });
      const json = await response.json(); if (!response.ok) throw new Error(json.error);
      if (controller.signal.aborted) return;
      setStory(json.text);
      const speech = await fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: json.text }), signal: controller.signal });
      if (!speech.ok) throw new Error((await speech.json()).error);
      const blob = await speech.blob(); if (controller.signal.aborted) return;
      audio.current?.pause();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(blob);
      const player = new Audio(audioUrl.current);
      const source = context.createMediaElementSource(player);
      source.connect(context.destination); source.connect(destination);
      audio.current = player; setHasAudio(true); setNarrated(true); seek(0);
    } catch (e) { if (!controller.signal.aborted) { setNarrated(false); setError(e instanceof Error ? e.message : "Narration failed."); } }
    finally { if (!controller.signal.aborted) setPreparing(false); }
  };

  const recordTour = async () => {
    const canvas = scene.current?.canvas(); if (!canvas || !record || recording) return;
    pause(); seek(0); setError(null);
    try {
      capture.current = recordCanvasTour(canvas, record.title, () => scene.current?.credits() ?? "Google", (blob, extension) => {
        capture.current = null;
        if (!mounted.current) return;
        setRecording(false);
        if (downloadRef.current) URL.revokeObjectURL(downloadRef.current);
        const url = URL.createObjectURL(blob); downloadRef.current = url;
        setDownload({ url, extension });
      }, () => { if (mounted.current) { setRecording(false); setError("The video recording failed."); } }, narrated ? soundGraph.current?.destination.stream : undefined);
      setRecording(true);
      if (narrated && audio.current) { audio.current.currentTime = 0; await soundGraph.current?.context.resume(); await audio.current.play(); }
      scene.current?.play();
    } catch (e) { capture.current?.stop(); setRecording(false); setError(e instanceof Error ? e.message : "Recording could not start."); }
  };

  return <dialog ref={dialog} onCancel={e => { e.preventDefault(); onClose(); }} aria-labelledby="property-title" className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none border-0 bg-zinc-950 p-0 text-zinc-100 backdrop:bg-black">
    <div className="flex h-full flex-col">
      <header className="z-20 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 px-3 py-3 md:px-5">
        <div className="min-w-0 flex-1"><p className="text-[10px] uppercase text-cyan-300">bmore.casa / Property film</p><h2 id="property-title" className="break-words text-sm font-medium md:text-base">{record?.title ?? "Loading property"}</h2></div>
        <div role="group" aria-label="Property view" className="order-3 flex w-full rounded-md border border-white/15 p-1 sm:order-none sm:w-auto">
          {(["existing", "proposed"] as const).map(mode => <button key={mode} aria-pressed={view === mode} onClick={() => { pause(); setView(mode); setDetails(false); }} className={`flex-1 rounded px-4 py-1.5 text-xs ${view === mode ? "bg-zinc-200 text-zinc-950" : "text-zinc-400"}`}>{mode === "existing" ? "Existing" : "Proposed"}</button>)}
        </div>
        {view === "existing" && <button onClick={() => setDetails(v => !v)} aria-label="Property details" aria-pressed={details} title="Property details" className="rounded p-2 hover:bg-white/10"><Info size={18} /></button>}
        <button onClick={onClose} autoFocus aria-label="Close property film" title="Close property film" className="rounded p-2 hover:bg-white/10"><X size={20} /></button>
      </header>
      <section className={`relative min-h-0 flex-1 ${view === "existing" ? "" : "hidden"}`} aria-label="Existing property film">
        {record && <PhotorealScene key={attempt} record={record} ref={scene} onStatus={(next, message) => { setStatus(next); setMapError(message ?? null); }} onProgress={(seconds, active) => {
          setTime(seconds); setPlaying(active);
          if (!active && state.current.playing) { audio.current?.pause(); capture.current?.stop(); }
        }} />}
        {status !== "ready" && <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/85 p-8 text-center"><div className="max-w-sm">
          {status === "loading" ? <><Loader2 className="mx-auto animate-spin text-cyan-300" size={24} /><p className="mt-3 text-sm">Loading the real 3D scene...</p></> : <><p role="alert" className="text-sm leading-relaxed text-rose-200">{mapError}</p><button onClick={() => { setStatus("loading"); setAttempt(v => v + 1); }} className="mt-4 rounded-md border border-white/20 px-4 py-2 text-sm">Retry imagery</button></>}
        </div></div>}
        {status === "ready" && <span className="absolute left-3 top-3 rounded bg-black/65 px-3 py-1.5 text-xs">{tourPose(time).shot}{recording ? " / Recording" : ""}</span>}
        {details && record && <aside className="absolute bottom-14 right-3 top-3 z-20 w-[min(320px,calc(100%-1.5rem))] overflow-y-auto rounded-md border border-white/15 bg-zinc-950/95 p-4 text-xs">
          <h3 className="text-sm font-medium">{record.neighborhood ?? "Property record"}</h3><p className="mt-2 leading-relaxed text-zinc-400">{record.status}</p>
          <dl className="mt-4 space-y-2">{record.fields.map(field => <div key={field.label}><dt className="text-zinc-500">{field.label}</dt><dd className="break-words">{field.value}</dd></div>)}</dl>
          {story && <><h4 className="mt-5 font-medium">Narration</h4><p className="mt-2 leading-relaxed text-zinc-300">{story}</p></>}
          <p className="mt-4 leading-relaxed text-zinc-500">The camera centers on the record coordinate. Imagery can predate the record and does not verify current condition.</p><a href={record.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 block text-cyan-300">Open record source</a>
        </aside>}
      </section>
      <section className={`min-h-0 flex-1 ${view === "proposed" ? "" : "hidden"}`} aria-label="Proposed renovation film"><RenovationVideo property={property} /></section>
      {view === "existing" && <footer className="shrink-0 border-t border-white/10 px-3 py-3 md:px-5">
        <div className="flex items-center gap-3">
          <button onClick={playing ? pause : play} disabled={status !== "ready" || preparing} title={playing ? "Pause tour" : "Play tour"} aria-label={playing ? "Pause tour" : "Play tour"} className="rounded-md bg-cyan-300 p-2.5 text-zinc-950 disabled:opacity-40">{playing ? <Pause size={18} /> : <Play size={18} />}</button>
          <button onClick={() => { pause(); seek(0); }} disabled={status !== "ready"} title="Restart tour" aria-label="Restart tour" className="rounded p-2 disabled:opacity-40"><RotateCcw size={17} /></button>
          <input type="range" min={0} max={TOUR_SECONDS} step={0.1} value={time} onChange={e => { pause(); seek(Number(e.target.value)); }} disabled={status !== "ready" || recording} aria-label="Tour position" className="min-w-0 flex-1 accent-cyan-300" />
          <span className="w-20 shrink-0 text-right text-xs tabular-nums text-zinc-400">{Math.floor(time)} / {TOUR_SECONDS}s</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {!hasAudio ? <button onClick={prepare} disabled={!record || preparing || recording} className="flex items-center gap-2 py-1 text-zinc-300 disabled:opacity-40">{preparing ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}{preparing ? "Preparing narration..." : "Generate narration"}</button> : <label className="flex items-center gap-2"><input type="checkbox" checked={narrated} disabled={recording} onChange={e => { pause(); setNarrated(e.target.checked); }} className="accent-cyan-300" />Narration</label>}
          {canRecord && <button onClick={recording ? pause : recordTour} disabled={status !== "ready" || preparing} className="flex items-center gap-2 py-1 text-zinc-300 disabled:opacity-40">{recording ? <Square size={13} className="text-rose-300" /> : <Circle size={13} className="text-rose-300" />}{recording ? "Stop recording" : "Record tour"}</button>}
          {download && <a href={download.url} download={`property-tour.${download.extension}`} className="flex items-center gap-2 py-1 text-cyan-300"><Download size={14} />Download film</a>}
          {error && <p role="alert" className="w-full text-xs text-rose-300">{error}</p>}
        </div>
      </footer>}
    </div>
  </dialog>;
}
