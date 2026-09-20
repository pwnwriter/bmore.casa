import type { LayerKey } from "@/lib/geo/constants";

/** Columnar point file shared fields (public/data/{vacant,rehabs,demolitions}.json, permits/<i>.json). */
export interface RawPoints {
  lon: number[];
  lat: number[];
  date: (string | null)[];
  address: (string | null)[];
  blocklot: (string | null)[];
  id: string[];
  n?: number[];
  [extra: string]: unknown;
}

export interface PointSet {
  layer: LayerKey;
  length: number;
  lon: number[];
  lat: number[];
  date: (string | null)[];
  year: Int16Array;
  address: (string | null)[];
  blocklot: (string | null)[];
  id: string[];
  /** neighborhood index per record (-1 = unassigned) */
  n: Int16Array;
  extra: Record<string, unknown[]>;
}

export interface NeighborhoodProps {
  i: number;
  name: string;
  parcels: number | null;
  housingUnits: number | null;
  population: number | null;
  center: [number, number];
  bbox: [number, number, number, number];
}

export type NeighborhoodCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, NeighborhoodProps>;

/** type -> year -> [records, distinct parcels] */
export type YearTable = Record<string, Record<string, [number, number]>>;

export interface Aggregates {
  types: string[];
  city: YearTable;
  neighborhoods: Record<string, YearTable>;
  totals: Record<string, Partial<Record<LayerKey, [number, number]>>>;
  cityTotals: Record<LayerKey, [number, number]>;
}

export interface HexData {
  radiusMeters: number;
  cells: [number, number][];
  /** [cell, typeIndex, year, count] */
  rows: [number, number, number, number][];
}

export interface DatasetSummary {
  layerTitle: string;
  url: string;
  dateField: string;
  apiCount: number;
  downloaded: number;
  downloadedAt: string;
  records: number;
  exactDuplicatesRemoved: number;
  distinctParcels: number;
  dateRange: [string, string];
}

export interface Finding {
  id: string;
  title: string;
  text: string;
  metric: string;
  values: Record<string, unknown>;
}

export interface Summary {
  generatedAt: string;
  datasets: Record<LayerKey, DatasetSummary>;
  yearRange: [number, number];
  neighborhoods: { url: string; count: number };
  parcels: { url: string; total_parcels: number; parcels_without_matching_neighborhood: number };
  permitCategories: { prefixes: Record<string, string>; counts: Record<string, number> };
  findings: Finding[];
}

export interface CityData {
  summary: Summary;
  aggregates: Aggregates;
  neighborhoods: NeighborhoodCollection;
  hex: HexData;
  points: Record<Exclude<LayerKey, "permit">, PointSet>;
}

export interface RecordRef {
  layer: LayerKey;
  index: number;
}

export interface RecordDetail {
  layer: LayerKey;
  title: string;
  neighborhood: string | null;
  position: [number, number];
  status: string;
  fields: { label: string; value: string }[];
  notes: string[];
  sourceTitle: string;
  sourceUrl: string;
}
