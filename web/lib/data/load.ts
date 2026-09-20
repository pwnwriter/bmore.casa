import type { LayerKey } from "@/lib/geo/constants";
import type { Aggregates, CityData, HexData, NeighborhoodCollection, PointSet, RawPoints, Summary } from "./types";

const SHARED = new Set(["lon", "lat", "date", "address", "blocklot", "id", "n"]);

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} - HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function toPointSet(layer: LayerKey, raw: RawPoints, neighborhood?: number): PointSet {
  const length = raw.lon.length;
  const year = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const d = raw.date[i];
    year[i] = d ? Number(d.slice(0, 4)) : -1;
  }
  const n = new Int16Array(length);
  if (raw.n) n.set(raw.n);
  else n.fill(neighborhood ?? -1);
  const extra: Record<string, unknown[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!SHARED.has(key) && Array.isArray(value)) extra[key] = value;
  }
  return { layer, length, lon: raw.lon, lat: raw.lat, date: raw.date, year, address: raw.address, blocklot: raw.blocklot, id: raw.id, n, extra };
}

/** Everything the explorer needs, from static files only - no ArcGIS calls at runtime. */
export async function loadCityData(): Promise<CityData> {
  const [summary, aggregates, neighborhoods, hex, vacant, rehabs, demolitions] = await Promise.all([
    getJSON<Summary>("/data/summary.json"),
    getJSON<Aggregates>("/data/aggregates.json"),
    getJSON<NeighborhoodCollection>("/data/neighborhoods.geojson"),
    getJSON<HexData>("/data/hex.json"),
    getJSON<RawPoints>("/data/vacant.json"),
    getJSON<RawPoints>("/data/rehabs.json"),
    getJSON<RawPoints>("/data/demolitions.json"),
  ]);
  return {
    summary,
    aggregates,
    neighborhoods,
    hex,
    points: {
      vacant: toPointSet("vacant", vacant),
      rehab: toPointSet("rehab", rehabs),
      demolition: toPointSet("demolition", demolitions),
    },
  };
}

/** Individual permit records are only shipped per neighborhood, on demand. */
export async function loadPermits(neighborhood: number): Promise<PointSet> {
  const res = await fetch(`/data/permits/${neighborhood}.json`);
  if (res.status === 404) return toPointSet("permit", { lon: [], lat: [], date: [], address: [], blocklot: [], id: [] }, neighborhood);
  if (!res.ok) throw new Error(`permits/${neighborhood}.json - HTTP ${res.status}`);
  return toPointSet("permit", (await res.json()) as RawPoints, neighborhood);
}
