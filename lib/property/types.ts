import type { RecordDetail, RecordRef } from "@/lib/data/types";

export interface PropertyRef extends RecordRef { neighborhood?: number }
export type GroundPoint = [number, number];
export interface Building {
  id: number;
  name: string;
  outline: GroundPoint[];
  height: number;
  heightSource: "mapped" | "levels" | "estimated";
}
export interface PropertyContext {
  record: RecordDetail;
  buildings: Building[];
  roads: { points: GroundPoint[]; name: string }[];
  selectedId: number | null;
  fetchedAt: string;
  warning: string | null;
}
export interface Proposal {
  title: string;
  summary: string;
  narration: string;
  changes: string[];
  facadeColor: string;
  trimColor: string;
  roof: "plain" | "green" | "solar";
  model: string;
}

export function containsPoint(ring: GroundPoint[], [x, y]: GroundPoint): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function validateProposal(value: unknown): Omit<Proposal, "model"> {
  if (!value || typeof value !== "object") throw new Error("Gemini returned an invalid concept.");
  const p = value as Record<string, unknown>;
  for (const [key, limit] of [["title", 100], ["summary", 1200], ["narration", 850]] as const) {
    if (typeof p[key] !== "string" || !p[key].trim() || p[key].length > limit) throw new Error("Gemini returned an invalid description.");
  }
  if (!Array.isArray(p.changes) || p.changes.length < 1 || p.changes.length > 5 || p.changes.some(v => typeof v !== "string" || !v.trim() || v.length > 240)) throw new Error("Gemini returned invalid concept details.");
  if (![p.facadeColor, p.trimColor].every(v => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v))) throw new Error("Gemini returned invalid material colors.");
  if (!["plain", "green", "solar"].includes(p.roof as string)) throw new Error("Gemini returned an invalid roof treatment.");
  return { title: p.title as string, summary: p.summary as string, narration: p.narration as string, changes: p.changes as string[], facadeColor: p.facadeColor as string, trimColor: p.trimColor as string, roof: p.roof as Proposal["roof"] };
}
