import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { Aggregates, Summary } from "@/lib/data/types";
import { LAYERS, LAYER_ORDER, type LayerKey } from "@/lib/geo/constants";

export const alt = "bmore.casa - Baltimore's housing records as a 3D data twin: open vacant building notices, rehab permits, city demolitions and building permits.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STACK: LayerKey[] = ["vacant", "rehab", "demolition"];
const SKYLINE_HEIGHT = 190;

async function load<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(path.join(process.cwd(), "public", "data", file), "utf8"));
}

// Every number and column on the card comes from the shipped data, like everything else in the app.
export default async function OpenGraphImage() {
  const [summary, aggregates] = await Promise.all([load<Summary>("summary.json"), load<Aggregates>("aggregates.json")]);
  const [firstYear, lastYear] = summary.yearRange;
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => String(firstYear + i));
  const count = (layer: LayerKey, year: string) => aggregates.city[layer]?.[year]?.[0] ?? 0;
  const tallest = Math.max(1, ...years.map((year) => STACK.reduce((sum, layer) => sum + count(layer, year), 0)));

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#060a14", backgroundImage: "radial-gradient(circle at 85% 0%, rgba(77,214,232,0.22), rgba(6,10,20,0) 55%)", color: "#f8fafc", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", padding: "56px 64px 0" }}>
          <div style={{ display: "flex", fontSize: 22, letterSpacing: 6, color: "#67e8f9" }}>A CIVIC DATA TWIN · HOPHACKS 2026</div>
          <div style={{ display: "flex", marginTop: 14, fontSize: 118, fontWeight: 700, letterSpacing: 8, lineHeight: 1 }}>
            BMORE<span style={{ color: "#67e8f9" }}>.CASA</span>
          </div>
          <div style={{ display: "flex", marginTop: 22, fontSize: 32, color: "#cbd5e1" }}>Explore the changing landscape of Baltimore, one building at a time.</div>
          <div style={{ display: "flex", marginTop: 30, gap: 36 }}>
            {LAYER_ORDER.map((layer) => (
              <div key={layer} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 38, fontWeight: 700 }}>
                  <div style={{ width: 14, height: 14, borderRadius: 7, background: LAYERS[layer].hex }} />
                  {summary.datasets[layer].records.toLocaleString("en-US")}
                </div>
                <div style={{ display: "flex", marginTop: 2, fontSize: 19, color: "#94a3b8" }}>{LAYERS[layer].short.toLowerCase()}</div>
              </div>
            ))}
            <div style={{ display: "flex", marginLeft: "auto", alignSelf: "flex-end", fontSize: 19, color: "#64748b" }}>records per year, {firstYear}-{lastYear}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: SKYLINE_HEIGHT, padding: "0 64px" }}>
          {years.map((year) => (
            <div key={year} style={{ display: "flex", flexDirection: "column-reverse", flex: 1 }}>
              {STACK.map((layer) => (
                <div key={layer} style={{ height: Math.round((count(layer, year) / tallest) * SKYLINE_HEIGHT), background: LAYERS[layer].hex, opacity: 0.9 }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
