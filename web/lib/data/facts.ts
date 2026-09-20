import { promises as fs } from "node:fs";
import path from "node:path";
import { LAYER_ORDER, LAYERS } from "@/lib/geo/constants";
import { layerSeries, per1k, permitCategories, sumRange, type YearRange } from "./stats";
import type { Aggregates, NeighborhoodCollection, Summary } from "./types";

/**
 * Server-only. Builds the fact sheet "Ask Baltimore" is allowed to talk about.
 * The model never sees raw records and is never asked to recall anything: every
 * number it may cite is computed here from the same files the map uses.
 */

interface Loaded {
  summary: Summary;
  aggregates: Aggregates;
  neighborhoods: NeighborhoodCollection;
}

let cache: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  cache ??= (async () => {
    const dir = path.join(process.cwd(), "public", "data");
    const read = async <T,>(file: string) => JSON.parse(await fs.readFile(path.join(dir, file), "utf8")) as T;
    const [summary, aggregates, neighborhoods] = await Promise.all([
      read<Summary>("summary.json"),
      read<Aggregates>("aggregates.json"),
      read<NeighborhoodCollection>("neighborhoods.geojson"),
    ]);
    return { summary, aggregates, neighborhoods };
  })();
  cache.catch(() => (cache = null));
  return cache;
}

function scopeFacts(data: Loaded, neighborhood: number | null, range: YearRange) {
  const series = layerSeries(data.aggregates, data.summary, neighborhood);
  const props = neighborhood === null ? null : data.neighborhoods.features[neighborhood]?.properties;
  const parcels = neighborhood === null ? data.summary.parcels.total_parcels : (props?.parcels ?? null);
  const totals = neighborhood === null ? data.aggregates.cityTotals : (data.aggregates.totals[String(neighborhood)] ?? {});
  const layers = Object.fromEntries(
    LAYER_ORDER.map((k) => {
      const inRange = sumRange(series, k, range);
      const rate = per1k(inRange, parcels);
      return [
        LAYERS[k].label,
        {
          records_in_selected_years: inRange,
          records_per_1000_parcels_in_selected_years: rate === null ? null : Number(rate.toFixed(1)),
          all_years_records: totals[k]?.[0] ?? 0,
          all_years_distinct_parcels: totals[k]?.[1] ?? 0,
          records_by_year: Object.fromEntries(series.years.map((y, i) => [y, series.byLayer[k][i]]).filter(([, n]) => (n as number) > 0)),
        },
      ];
    }),
  );
  return {
    scope: props ? `${props.name} (neighborhood)` : "Baltimore City (citywide)",
    parcels,
    census_housing_units: props?.housingUnits ?? null,
    layers,
    permit_categories_in_selected_years: Object.fromEntries(permitCategories(data.aggregates, neighborhood, range).map((c) => [c.label, c.records])),
  };
}

export async function buildFactSheet(neighborhood: number | null, compare: number | null, range: YearRange) {
  const data = await load();
  const count = data.neighborhoods.features.length;
  const valid = (i: number | null) => (i !== null && Number.isInteger(i) && i >= 0 && i < count ? i : null);
  const [min, max] = data.summary.yearRange;
  const clean: YearRange = [Math.max(min, Math.min(range[0], range[1])), Math.min(max, Math.max(range[0], range[1]))];
  const a = valid(neighborhood);
  const b = valid(compare);

  return {
    selected_years: clean,
    data_downloaded: data.summary.datasets.vacant.downloadedAt.slice(0, 10),
    scopes: [scopeFacts(data, a, clean), ...(b !== null && b !== a ? [scopeFacts(data, b, clean)] : []), ...(a !== null ? [scopeFacts(data, null, clean)] : [])],
    metric_definitions: Object.fromEntries(LAYER_ORDER.map((k) => [LAYERS[k].label, LAYERS[k].counts])),
    source_coverage: Object.fromEntries(LAYER_ORDER.map((k) => [LAYERS[k].label, { first_date: data.summary.datasets[k].dateRange[0], last_date: data.summary.datasets[k].dateRange[1], source_layer: data.summary.datasets[k].layerTitle }])),
    caveats: [
      "The vacancy source contains only notices still open when downloaded. Closed notices are absent, so counts by year are NOT the number of vacant buildings in that year.",
      "Rehab records are use & occupancy permits and also appear in the building permit layer; never add rehab and permit counts.",
      "Permits are records, not buildings; one parcel can have many. A permit does not confirm completed work.",
      "City demolitions are one-time events; private demolitions are not included.",
      `${max} is a partial year. The permit system changed in early 2025 and permit counts dip that year.`,
      "Sources start in different years; a year before a source's first_date is unobserved, not zero.",
      "The records are descriptive and cannot establish why anything changed.",
    ],
    citywide_verified_findings: data.summary.findings.map((f) => f.text),
  };
}
