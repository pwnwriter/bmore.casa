import { ACTIVITY_TYPES, LAYER_ORDER, LAYERS, PERMIT_CATEGORIES, PERMIT_CATEGORY_LABELS, TYPE_TO_LAYER, type LayerKey } from "@/lib/geo/constants";
import type { Aggregates, CityData, HexData, NeighborhoodProps, PointSet, RecordDetail, RecordRef, Summary, YearTable } from "./types";

export type YearRange = [number, number];

export interface LayerSeries {
  years: number[];
  /** records per year, per layer */
  byLayer: Record<LayerKey, number[]>;
}

const tableFor = (agg: Aggregates, neighborhood: number | null): YearTable =>
  neighborhood === null ? agg.city : (agg.neighborhoods[String(neighborhood)] ?? {});

export function yearsOf(summary: Summary): number[] {
  const [a, b] = summary.yearRange;
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

/** Records per year per layer for the city or one neighborhood. */
export function layerSeries(agg: Aggregates, summary: Summary, neighborhood: number | null): LayerSeries {
  const years = yearsOf(summary);
  const table = tableFor(agg, neighborhood);
  const byLayer = Object.fromEntries(LAYER_ORDER.map((k) => [k, years.map(() => 0)])) as Record<LayerKey, number[]>;
  ACTIVITY_TYPES.forEach((type, t) => {
    const perYear = table[type];
    if (!perYear) return;
    const target = byLayer[TYPE_TO_LAYER[t]];
    years.forEach((y, i) => {
      target[i] += perYear[String(y)]?.[0] ?? 0;
    });
  });
  return { years, byLayer };
}

export function sumRange(series: LayerSeries, layer: LayerKey, [from, to]: YearRange): number {
  let total = 0;
  series.years.forEach((y, i) => {
    if (y >= from && y <= to) total += series.byLayer[layer][i];
  });
  return total;
}

export function permitCategories(agg: Aggregates, neighborhood: number | null, [from, to]: YearRange) {
  const table = tableFor(agg, neighborhood);
  return PERMIT_CATEGORIES.map((category) => {
    let records = 0;
    for (const [year, [n]] of Object.entries(table[`permit_${category}`] ?? {})) {
      if (Number(year) >= from && Number(year) <= to) records += n;
    }
    return { category, label: PERMIT_CATEGORY_LABELS[category], records };
  })
    .filter((c) => c.records > 0)
    .sort((a, b) => b.records - a.records);
}

/**
 * Largest all-years record total in any hex cell for the active layers. The
 * column height scale is pinned to this, so moving the timeline never rescales.
 */
export function hexFullMax(hex: HexData, active: Record<LayerKey, boolean>): number {
  const totals = new Float64Array(hex.cells.length);
  for (const [cell, type, , n] of hex.rows) if (active[TYPE_TO_LAYER[type]]) totals[cell] += n;
  let max = 1;
  for (const t of totals) if (t > max) max = t;
  return max;
}

export const per1k = (count: number, parcels: number | null): number | null =>
  parcels && parcels > 0 ? (1000 * count) / parcels : null;

/** Rank by open notices per 1,000 parcels among neighborhoods with at least `minParcels` parcels. */
export function openNoticeRank(data: CityData, neighborhood: number, minParcels = 100) {
  const rates: { i: number; rate: number }[] = [];
  for (const f of data.neighborhoods.features) {
    const p = f.properties;
    if (!p.parcels || p.parcels < minParcels) continue;
    const open = data.aggregates.totals[String(p.i)]?.vacant?.[0] ?? 0;
    rates.push({ i: p.i, rate: (1000 * open) / p.parcels });
  }
  rates.sort((a, b) => b.rate - a.rate);
  const position = rates.findIndex((r) => r.i === neighborhood);
  return position < 0 ? null : { rank: position + 1, of: rates.length, minParcels };
}

/** Facts about the open notices of one neighborhood, computed from the point records. */
export function openNoticeFacts(vacant: PointSet, neighborhood: number) {
  let total = 0;
  let before2016 = 0;
  let since2022 = 0;
  let oldest: string | null = null;
  let withRehab = 0;
  for (let i = 0; i < vacant.length; i++) {
    if (vacant.n[i] !== neighborhood) continue;
    total++;
    const y = vacant.year[i];
    if (y > 0 && y < 2016) before2016++;
    if (y >= 2022) since2022++;
    const d = vacant.date[i];
    if (d && (!oldest || d < oldest)) oldest = d;
    if (vacant.extra.rehabDate?.[i]) withRehab++;
  }
  return { total, before2016, since2022, oldest, withRehab };
}

export function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "not recorded";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

const text = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** Build the inspector card for one record, stating only what the source row says. */
export function describeRecord(ref: RecordRef, set: PointSet, summary: Summary, neighborhoods: NeighborhoodProps[]): RecordDetail {
  const i = ref.index;
  const ds = summary.datasets[ref.layer];
  const fields: RecordDetail["fields"] = [];
  const notes: string[] = [];
  const add = (label: string, value: string | null) => {
    if (value) fields.push({ label, value });
  };
  let status = "";

  add(LAYERS[ref.layer].dateLabel, fmtDate(set.date[i]));
  if (ref.layer === "vacant") {
    status = "Notice open in source snapshot";
    add("Notice number", set.id[i]);
    add("Owner code (source)", text(set.extra.owner?.[i]));
    const rehab = text(set.extra.rehabDate?.[i]);
    const demo = text(set.extra.demoDate?.[i]);
    if (rehab) notes.push(`The same parcel (BLOCKLOT) has a rehab permit record issued ${fmtDate(rehab)}.`);
    if (demo) notes.push(`The same parcel (BLOCKLOT) has a completed city demolition record dated ${fmtDate(demo)}.`);
    notes.push(`Open when the layer was downloaded (${fmtDate(ds.downloadedAt.slice(0, 10))}); it may have been abated or cancelled since.`);
  } else if (ref.layer === "rehab") {
    status = "Permit issued";
    add("Permit number", set.id[i]);
    add("Existing use (source code)", text(set.extra.existingUse?.[i]));
    add("Proposed use (source code)", text(set.extra.proposedUse?.[i]));
    notes.push("A use & occupancy permit on a building that had a vacant building notice. It does not confirm the work was finished or the building is occupied.");
  } else if (ref.layer === "demolition") {
    status = text(set.extra.status?.[i]) ?? "Demo Complete";
    add("Demolition started", text(set.extra.started?.[i]) ? fmtDate(text(set.extra.started?.[i])) : null);
    const decon = text(set.extra.deconstruction?.[i]);
    add("Deconstruction", decon === "Y" ? "Yes" : decon === "N" ? "No" : null);
    notes.push("A completed city demolition is a one-time event at this location, not a current property status.");
  } else {
    const category = PERMIT_CATEGORIES[Number(set.extra.cat?.[i] ?? 5)];
    status = set.extra.mod?.[i] ? "Permit issued (modification of an earlier permit)" : "Permit issued";
    add("Case number", set.id[i]);
    add("Category (from case prefix)", PERMIT_CATEGORY_LABELS[category]);
    add("Existing use (source code)", text(set.extra.existingUse?.[i]));
    add("Proposed use (source code)", text(set.extra.proposedUse?.[i]));
    const cost = set.extra.cost?.[i];
    add("Declared cost", typeof cost === "number" ? `$${fmt(cost)}` : null);
    add("Description", text(set.extra.desc?.[i]));
    notes.push("An issued permit records permission to do work, not that the work was completed.");
  }
  add("Parcel (BLOCKLOT)", set.blocklot[i]);

  const n = set.n[i];
  return {
    layer: ref.layer,
    title: set.address[i] ?? "Address not recorded",
    neighborhood: n >= 0 ? neighborhoods[n].name : null,
    position: [set.lon[i], set.lat[i]],
    status,
    fields,
    notes,
    sourceTitle: ds.layerTitle,
    sourceUrl: ds.url,
  };
}
