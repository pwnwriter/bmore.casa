"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { TilesRenderer } from "3d-tiles-renderer/three";
import { GLTFExtensionsPlugin, ReorientationPlugin } from "3d-tiles-renderer/three/plugins";
import type { RecordDetail } from "@/lib/data/types";
import { TOUR_SECONDS, tourPose } from "@/lib/property/tour";

export interface SceneHandle {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  canvas(): HTMLCanvasElement | null;
  credits(): string;
}
interface Props {
  record: RecordDetail;
  ref: Ref<SceneHandle>;
  onProgress: (seconds: number, playing: boolean) => void;
  onStatus: (status: "loading" | "ready" | "error", message?: string) => void;
}

export default function PhotorealScene({ record, ref, onProgress, onStatus }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef<SceneHandle | null>(null);
  const callbacks = useRef({ onProgress, onStatus });
  callbacks.current = { onProgress, onStatus };
  const [credits, setCredits] = useState("Google");
  useImperativeHandle(ref, () => ({
    play: () => actions.current?.play(), pause: () => actions.current?.pause(), seek: s => actions.current?.seek(s),
    canvas: () => actions.current?.canvas() ?? null, credits: () => actions.current?.credits() ?? "Google",
  }), []);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    callbacks.current.onStatus("loading");
    const controller = new AbortController();
    let dispose: (() => void) | undefined;
    let disposed = false;
    const start = async () => {
      const response = await fetch("/api/tiles3d/status", { signal: controller.signal });
      const status = await response.json();
      if (!status.available) throw new Error(status.error || "Photorealistic imagery needs a Google Maps key or Cesium ion token.");
      if (disposed) return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false, logarithmicDepthBuffer: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setClearColor("#aabfce");
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute("role", "img");
      renderer.domElement.setAttribute("aria-label", "Photorealistic property flythrough");
      element.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 20000000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.minDistance = 35;
      controls.maxDistance = 2000;
      controls.maxPolarAngle = Math.PI * 0.46;
      const tiles = new TilesRenderer(`${location.origin}/api/tiles3d/root.json`);
      const draco = new DRACOLoader().setDecoderPath("/draco/");
      draco.setWorkerLimit(2);
      tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco, autoDispose: false }));
      tiles.registerPlugin(new ReorientationPlugin({ lat: THREE.MathUtils.degToRad(record.position[1]), lon: THREE.MathUtils.degToRad(record.position[0]), height: 0 }));
      tiles.errorTarget = 12;
      tiles.loadSiblings = false;
      tiles.setCamera(camera);
      scene.add(tiles.group);
      let elapsed = 0, playing = false, ready = false, surface = 0, last = performance.now(), lastSample = 0, lastUI = 0;
      let creditsText = "Google";
      const copyright = new Map<object, string>();
      const apply = (seconds: number) => {
        const pose = tourPose(seconds), angle = THREE.MathUtils.degToRad(pose.heading);
        controls.target.set(0, surface, 0);
        camera.position.set(Math.sin(angle) * pose.radius, surface + pose.height, Math.cos(angle) * pose.radius);
        camera.lookAt(controls.target);
        controls.update();
      };
      apply(9);
      const pause = () => { playing = false; callbacks.current.onProgress(elapsed, false); };
      controls.addEventListener("start", pause);
      const lost = (event: Event) => { event.preventDefault(); pause(); callbacks.current.onStatus("error", "The graphics connection was lost. Reopen the property tour."); };
      renderer.domElement.addEventListener("webglcontextlost", lost);
      tiles.addEventListener("tile-visibility-change", ({ tile, visible }) => {
        const meta = (tile as unknown as { engineData: { metadata?: { asset?: { copyright?: string } } } }).engineData;
        if (visible) copyright.set(tile, meta.metadata?.asset?.copyright ?? "");
        else copyright.delete(tile);
      });
      tiles.addEventListener("load-error", ({ tile }) => {
        if (!tile || !ready) callbacks.current.onStatus("error", "The 3D imagery could not be loaded. Check the tile provider access or retry.");
      });
      const timeout = window.setTimeout(() => { if (!ready) callbacks.current.onStatus("error", "Detailed imagery is taking too long to load here. Retry the tour or choose another property."); }, 60_000);
      const resize = () => {
        const { width, height } = element.getBoundingClientRect();
        renderer.setSize(Math.max(width, 1), Math.max(height, 1));
        camera.aspect = Math.max(width, 1) / Math.max(height, 1);
        camera.updateProjectionMatrix();
        tiles.setResolutionFromRenderer(camera, renderer);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(element);
      resize();
      actions.current = {
        play: () => { if (!ready) return; if (elapsed >= TOUR_SECONDS) elapsed = 0; playing = true; last = performance.now(); callbacks.current.onProgress(elapsed, true); },
        pause,
        seek: seconds => { elapsed = Math.max(0, Math.min(TOUR_SECONDS, seconds)); apply(elapsed); callbacks.current.onProgress(elapsed, playing); },
        canvas: () => renderer.domElement,
        credits: () => creditsText,
      };
      renderer.setAnimationLoop(now => {
        const dt = Math.min((now - last) / 1000, 0.1); last = now;
        if (!element.clientWidth || !element.clientHeight) return;
        controls.update();
        camera.updateMatrixWorld();
        tiles.group.updateMatrixWorld(true);
        tiles.update();
        if (now - lastSample > 700) {
          lastSample = now;
          // Coarse globe tiles can intersect kilometres below the local surface.
          // Wait for Baltimore-scale terrain instead of moving the camera underground.
          const ray = new THREE.Raycaster(new THREE.Vector3(0, 1500, 0), new THREE.Vector3(0, -1, 0), 0, 1600);
          const hit = ray.intersectObject(tiles.group, true)[0];
          if (hit && Number.isFinite(hit.point.y) && hit.point.y < 500) {
            if (!ready) {
              surface = hit.point.y;
              ready = true;
              clearTimeout(timeout);
              apply(0);
              callbacks.current.onStatus("ready");
            } else if (!playing) {
              const delta = (hit.point.y - surface) * 0.2;
              surface += delta;
              camera.position.y += delta;
              controls.target.y += delta;
            }
          }
          const attribution = [...new Set([...copyright.values()].flatMap(v => v.split(";").map(s => s.trim()).filter(s => s && s !== "Google")))].join(" / ");
          const nextCredits = `Google${attribution ? ` / ${attribution}` : ""}`;
          if (nextCredits !== creditsText) { creditsText = nextCredits; setCredits(creditsText); }
        }
        if (playing) {
          elapsed = Math.min(TOUR_SECONDS, elapsed + dt);
          apply(elapsed);
          if (elapsed >= TOUR_SECONDS) playing = false;
        }
        if (now - lastUI > 150) { lastUI = now; callbacks.current.onProgress(elapsed, playing); }
        renderer.render(scene, camera);
      });
      const visibility = () => { if (document.hidden) pause(); };
      document.addEventListener("visibilitychange", visibility);
      dispose = () => {
        clearTimeout(timeout);
        actions.current = null;
        renderer.setAnimationLoop(null);
        observer.disconnect();
        document.removeEventListener("visibilitychange", visibility);
        renderer.domElement.removeEventListener("webglcontextlost", lost);
        controls.dispose();
        tiles.dispose();
        draco.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    };
    start().catch(error => { if (!disposed) callbacks.current.onStatus("error", error instanceof Error ? error.message : "3D imagery is unavailable."); });
    return () => { disposed = true; controller.abort(); dispose?.(); };
  }, [record]);

  return <div className="absolute inset-0">
    <div ref={host} className="absolute inset-0" />
    <div className="pointer-events-none absolute bottom-2 left-3 right-3 z-10 flex flex-wrap items-end justify-between gap-2 text-[10px] text-white">
      <span className="rounded bg-black/65 px-2 py-1">Aerial imagery / Capture date varies</span>
      <span className="max-w-full rounded bg-black/65 px-2 py-1" data-property-credits>{credits}</span>
    </div>
  </div>;
}
