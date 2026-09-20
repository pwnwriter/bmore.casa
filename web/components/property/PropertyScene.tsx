"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize, Pause, Play } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PropertyContext, Proposal } from "@/lib/property/types";

export default function PropertyScene({ context, selectedId, proposal, onSelect }: { context: PropertyContext; selectedId: number | null; proposal: Proposal | null; onSelect: (id: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    setError(false);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch { setError(true); return; }
    const element = host.current;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor("#e4ebed");
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute("aria-label", proposal ? "Proposed property and surroundings in 3D" : "Mapped property and surroundings in 3D");
    renderer.domElement.setAttribute("role", "img");
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const buildingMeshes: THREE.Mesh[] = [];
    scene.add(new THREE.HemisphereLight(0xffffff, 0x778078, 2.6));
    const sun = new THREE.DirectionalLight(0xfff8e8, 3);
    sun.position.set(-60, 120, 70);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -180, right: 180, top: 180, bottom: -180, far: 400 });
    sun.shadow.bias = -0.001;
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshStandardMaterial({ color: "#d3dcd6", roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);
    for (const road of context.roads) {
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(road.points.map(([x, z]) => new THREE.Vector3(x, 0.03, z))), new THREE.LineBasicMaterial({ color: "#f7faf8" })));
    }
    let target = new THREE.Vector3(0, 4, 0);
    let distance = 90;
    for (const building of context.buildings) {
      const chosen = building.id === selectedId;
      const design = chosen ? proposal : null;
      const shape = new THREE.Shape(building.outline.map(([x, z]) => new THREE.Vector2(x, -z)));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: building.height, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: design?.facadeColor ?? (chosen ? "#279ca6" : "#b5bec4"), roughness: 0.85 }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.buildingId = building.id;
      buildingMeshes.push(mesh);
      scene.add(mesh);
      scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: chosen ? "#12616a" : "#88969d", transparent: true, opacity: 0.6 })));
      if (chosen) {
        geometry.computeBoundingBox();
        target = geometry.boundingBox!.getCenter(new THREE.Vector3());
        distance = Math.max(45, geometry.boundingBox!.getSize(new THREE.Vector3()).length() * 2.2);
      }
      if (design) {
        const roofGeometry = new THREE.ShapeGeometry(shape);
        roofGeometry.rotateX(-Math.PI / 2);
        roofGeometry.translate(0, building.height + 0.04, 0);
        scene.add(new THREE.Mesh(roofGeometry, new THREE.MeshStandardMaterial({ color: design.roof === "green" ? "#63914c" : design.roof === "solar" ? "#304e78" : design.trimColor, roughness: design.roof === "solar" ? 0.2 : 0.9, metalness: design.roof === "solar" ? 0.5 : 0 })));
        // Repeated glazing is a schematic design treatment, never surveyed openings.
        const windowMaterial = new THREE.MeshStandardMaterial({ color: "#c0e4ee", metalness: 0.25, roughness: 0.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
        const trimMaterial = new THREE.MeshStandardMaterial({ color: design.trimColor, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
        for (let i = 1; i < building.outline.length; i++) {
          const [ax, az] = building.outline[i - 1], [bx, bz] = building.outline[i];
          const columns = Math.min(20, Math.floor(Math.hypot(bx - ax, bz - az) / 3));
          const floors = Math.min(20, Math.max(1, Math.floor(building.height / 3)));
          for (let floor = 0; floor < floors; floor++) for (let column = 0; column < columns; column++) {
            const t = (column + 0.5) / columns;
            const frame = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.75), trimMaterial);
            frame.position.set(ax + (bx - ax) * t, (floor + 0.55) * building.height / floors, az + (bz - az) * t);
            frame.rotation.y = -Math.atan2(bz - az, bx - ax);
            frame.add(new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.5), windowMaterial));
            scene.add(frame);
          }
        }
      }
    }
    const marker = new THREE.Mesh(new THREE.RingGeometry(1.4, 2, 40), new THREE.MeshBasicMaterial({ color: "#c14156", side: THREE.DoubleSide, depthTest: false }));
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.12;
    marker.renderOrder = 10;
    scene.add(marker);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 3000);
    camera.position.copy(target).add(new THREE.Vector3(distance * 0.8, distance * 0.7, distance));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.minDistance = 12;
    controls.maxDistance = 1000;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.autoRotateSpeed = 0.6;
    controls.update();
    controls.saveState();
    controlsRef.current = controls;
    let pointerStart = { x: 0, y: 0 };
    const pointerDown = (event: PointerEvent) => { pointerStart = { x: event.clientX, y: event.clientY }; };
    const pointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = ray.intersectObjects(buildingMeshes, false)[0];
      if (hit && hit.object.userData.buildingId !== selectedId) selectRef.current(hit.object.userData.buildingId);
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    setRotating(false);
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height));
      camera.aspect = Math.max(1, width) / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    const lost = (e: Event) => { e.preventDefault(); setError(true); };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      controlsRef.current = null;
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m));
        }
      });
      materials.forEach(m => m.dispose());
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [context, selectedId, proposal]);

  return <div className="relative h-full min-h-0 w-full bg-[#e4ebed]">
    <div ref={host} className="absolute inset-0" />
    <div className="absolute left-3 top-3 max-w-[calc(100%-7rem)] rounded-md bg-white/95 px-3 py-2 text-xs text-zinc-700 shadow-sm">
      <strong>{proposal ? "Proposed concept" : "Existing mapped form"}</strong>
      <p className="mt-1 text-[11px]">{proposal ? "Illustrative facade, windows and roof" : "Schematic exterior; current condition unverified"}</p>
    </div>
    <div className="absolute right-3 top-3 flex gap-1">
      <button title={rotating ? "Pause orbit" : "Orbit building"} aria-label={rotating ? "Pause orbit" : "Orbit building"} className="rounded-md bg-white p-2 text-zinc-700 shadow-sm" onClick={() => { if (controlsRef.current) { controlsRef.current.autoRotate = !rotating; setRotating(!rotating); } }}>{rotating ? <Pause size={17} /> : <Play size={17} />}</button>
      <button title="Reset camera" aria-label="Reset camera" className="rounded-md bg-white p-2 text-zinc-700 shadow-sm" onClick={() => controlsRef.current?.reset()}><Maximize size={17} /></button>
    </div>
    <div className="absolute bottom-2 left-3 right-3 flex flex-wrap justify-between gap-1 text-[10px] text-zinc-700">
      <span className="rounded bg-white/90 px-2 py-1">{proposal ? "Concept colors / Rose: record coordinate" : "Teal: selected footprint / Rose: record coordinate"}</span>
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="rounded bg-white/90 px-2 py-1">Map data: OpenStreetMap contributors</a>
    </div>
    {error && <div role="alert" className="absolute inset-0 flex items-center justify-center bg-white/95 p-8 text-sm text-zinc-800">3D rendering is unavailable. Enable WebGL or reopen this view.</div>}
  </div>;
}
