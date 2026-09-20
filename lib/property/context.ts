import { readFile } from "node:fs/promises";
import path from "node:path";
import { toPointSet } from "@/lib/data/load";
import { describeRecord } from "@/lib/data/stats";
import type { NeighborhoodCollection, RawPoints, Summary } from "@/lib/data/types";
import { containsPoint, type Building, type GroundPoint, type PropertyContext, type PropertyRef } from "./types";

export function parsePropertyRef(body: Record<string, unknown>): PropertyRef {
  if (!body || !["vacant", "rehab", "demolition", "permit"].includes(body.layer as string) || !Number.isInteger(body.index) || (body.index as number) < 0) throw new Error("Invalid property reference.");
  if (body.layer === "permit" && (!Number.isInteger(body.neighborhood) || (body.neighborhood as number) < 0 || (body.neighborhood as number) > 1000)) throw new Error("Invalid permit neighborhood.");
  return { layer: body.layer as PropertyRef["layer"], index: body.index as number, ...(body.layer === "permit" ? { neighborhood: body.neighborhood as number } : {}) };
}

const files = new Map<string, Promise<unknown>>();
function read<T>(file: string): Promise<T> {
  let pending = files.get(file);
  if (!pending) {
    pending = readFile(path.join(process.cwd(), "public/data", file), "utf8").then(JSON.parse);
    if (files.size >= 12) files.delete(files.keys().next().value!);
    files.set(file, pending);
    pending.catch(() => files.delete(file));
  }
  return pending as Promise<T>;
}

interface Way { id: number; tags?: Record<string, string>; geometry?: { lon: number; lat: number }[] }
const MAP_HEADERS = { Accept: "application/json", "User-Agent": "BaltimoreReborn/0.1 (property-study)" };

interface MapElement { type: string; id: number; lon?: number; lat?: number; nodes?: number[]; tags?: Record<string, string> }
export function mapWays(elements: MapElement[]): Way[] {
  const nodes = new Map(elements.filter(e => e.type === "node" && Number.isFinite(e.lon) && Number.isFinite(e.lat)).map(e => [e.id, { lon: e.lon!, lat: e.lat! }]));
  return elements.filter(e => e.type === "way" && (e.tags?.building || e.tags?.highway) && e.nodes?.every(id => nodes.has(id))).map(e => ({ id: e.id, tags: e.tags, geometry: e.nodes!.map(id => nodes.get(id)!) }));
}

async function loadWays(lon: number, lat: number): Promise<Way[]> {
  try {
    const query = `[out:json][timeout:12];(way["building"](around:110,${lat},${lon});way["highway"](around:140,${lat},${lon}););out geom;`;
    const response = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { ...MAP_HEADERS, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Map service unavailable.");
    const json = await response.json();
    if (!Array.isArray(json.elements) || json.remark) throw new Error("Incomplete map response.");
    return json.elements;
  } catch {
    // The core OSM API supplies a small local extract when Overpass is unavailable.
    const dy = 140 / 111320, dx = dy / Math.cos(lat * Math.PI / 180);
    const bbox = [lon - dx, lat - dy, lon + dx, lat + dy].join(",");
    const response = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`, { headers: MAP_HEADERS, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error("Map service unavailable.");
    const json = await response.json();
    if (!Array.isArray(json.elements)) throw new Error("Incomplete map response.");
    return mapWays(json.elements);
  }
}

export function mappedGeometry(ways: Way[], origin: [number, number]) {
  const project = (p: { lon: number; lat: number }): GroundPoint => [(p.lon - origin[0]) * 111320 * Math.cos(origin[1] * Math.PI / 180), -(p.lat - origin[1]) * 111320];
  const buildings: Building[] = [];
  const roads: PropertyContext["roads"] = [];
  for (const way of ways) {
    if (!way.geometry || way.geometry.length < 2 || way.geometry.some(p => !Number.isFinite(p.lon) || !Number.isFinite(p.lat))) continue;
    const points = way.geometry.map(project);
    const tags = way.tags ?? {};
    if (tags.building && tags.building !== "no" && points.length >= 4) {
      const first = points[0], last = points[points.length - 1];
      if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 0.1) continue;
      // OSM height is metres unless explicitly tagged in feet.
      const rawHeight = tags.height?.match(/^([\d.]+)\s*(m|ft|')?$/);
      const height = rawHeight ? Number(rawHeight[1]) * (rawHeight[2] === "ft" || rawHeight[2] === "'" ? 0.3048 : 1) : NaN;
      const levels = Number(tags["building:levels"]);
      const mapped = Number.isFinite(height) && height > 0 && height < 500;
      const fromLevels = Number.isFinite(levels) && levels > 0 && levels <= 100;
      buildings.push({ id: way.id, name: [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || tags.name || `Footprint ${way.id}`, outline: points, height: mapped ? height : fromLevels ? levels * 3 : 9, heightSource: mapped ? "mapped" : fromLevels ? "levels" : "estimated" });
    } else if (tags.highway) roads.push({ points, name: tags.name ?? "Unnamed street" });
  }
  // Multiple overlapping footprints must be resolved by the user.
  const matches = buildings.filter(b => containsPoint(b.outline, [0, 0]));
  return { buildings, roads, selectedId: matches.length === 1 ? matches[0].id : null };
}

export async function getPropertyRecord(ref: PropertyRef) {
  const file = ref.layer === "permit" ? `permits/${ref.neighborhood}.json` : ({ vacant: "vacant.json", rehab: "rehabs.json", demolition: "demolitions.json" })[ref.layer];
  const [raw, summary, neighborhoods] = await Promise.all([read<RawPoints>(file), read<Summary>("summary.json"), read<NeighborhoodCollection>("neighborhoods.geojson")]);
  if (ref.index >= raw.lon.length) throw new Error("Property record not found.");
  const set = toPointSet(ref.layer, raw, ref.neighborhood);
  const record = describeRecord(ref, set, summary, neighborhoods.features.map(f => f.properties));
  const [lon, lat] = record.position;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error("Property coordinates are missing.");
  return record;
}

const cache = new Map<string, { expires: number; value: PropertyContext }>();
export async function getPropertyContext(ref: PropertyRef): Promise<PropertyContext> {
  const key = JSON.stringify(ref);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const record = await getPropertyRecord(ref);
  const [lon, lat] = record.position;
  let geometry: ReturnType<typeof mappedGeometry> = { buildings: [], roads: [], selectedId: null };
  let warning: string | null = null;
  try {
    geometry = mappedGeometry(await loadWays(lon, lat), record.position);
    if (!geometry.buildings.length) warning = "No supported building footprints were returned here. Complex buildings and unmapped structures may be missing.";
  } catch (error) {
    console.warn("[property geometry]", error instanceof Error ? error.message : "Map request failed");
    warning = "Building footprints could not be loaded. Retry when the map service is available.";
  }
  const value: PropertyContext = { record, ...geometry, fetchedAt: new Date().toISOString(), warning };
  if (!warning) {
    if (cache.size >= 20) cache.delete(cache.keys().next().value!);
    cache.set(key, { value, expires: Date.now() + 15 * 60_000 });
  }
  return value;
}
