import { rewriteTileset } from "@/lib/property/tiles";

export const runtime = "nodejs";

/**
 * Server-side proxy for Google Photorealistic 3D Tiles, so the provider key
 * never reaches the browser. Works with either:
 *   GOOGLE_MAPS_API_KEY  - a Maps Platform key with the Map Tiles API enabled (metered), or
 *   CESIUM_ION_TOKEN     - a free Cesium ion token (non-commercial) with the
 *                          "Google Photorealistic 3D Tiles" asset (2275207) added.
 *
 * Tiles are streamed straight through and never stored. Tileset JSON is
 * rewritten so child tile URIs come back through this route as well.
 */

const GOOGLE_ROOT = "https://tile.googleapis.com/v1/3dtiles";
const ION_ASSET = 2275207;

let ionKey: { key: string; expires: number } | null = null;

async function resolveKey(): Promise<{ key: string; provider: "google" | "cesium-ion" } | null> {
  if (process.env.GOOGLE_MAPS_API_KEY) return { key: process.env.GOOGLE_MAPS_API_KEY, provider: "google" };
  // accept the common spellings people actually put in .env
  const token = process.env.CESIUM_ION_TOKEN || process.env.CESIUM_API_KEY || process.env.CECIUM_API_KEY;
  if (!token) return null;
  if (ionKey && ionKey.expires > Date.now()) return { key: ionKey.key, provider: "cesium-ion" };
  // ion answers with the Google tileset URL carrying a key scoped to this token
  const res = await fetch(`https://api.cesium.com/v1/assets/${ION_ASSET}/endpoint?access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Cesium ion returned HTTP ${res.status} - is the "Google Photorealistic 3D Tiles" asset added to this ion account?`);
  const endpoint = (await res.json()) as { url?: string; options?: { url?: string } };
  const url = endpoint.options?.url ?? endpoint.url;
  const key = url ? new URL(url).searchParams.get("key") : null;
  if (!key) throw new Error("Cesium ion did not return a Google tiles key.");
  ionKey = { key, expires: Date.now() + 45 * 60_000 };
  return { key, provider: "cesium-ion" };
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;

  if (path.length === 1 && path[0] === "status") {
    try {
      const resolved = await resolveKey();
      return Response.json({ available: Boolean(resolved), provider: resolved?.provider ?? null });
    } catch (e) {
      return Response.json({ available: false, provider: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // only ever forward to the 3D Tiles API: safe path segments (no dots-only, no slashes), and only the session parameter
  if (!path.every((segment) => /^[A-Za-z0-9._~-]+$/.test(segment))) return Response.json({ error: "Bad tile path." }, { status: 400 });
  if (path.some((segment) => segment === ".." || segment === ".")) return Response.json({ error: "Bad tile path." }, { status: 400 });

  let resolved: Awaited<ReturnType<typeof resolveKey>>;
  try {
    resolved = await resolveKey();
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  if (!resolved) return Response.json({ error: "Photorealistic 3D is not configured. Add CESIUM_ION_TOKEN or GOOGLE_MAPS_API_KEY to .env." }, { status: 503 });

  const upstream = new URL(`${GOOGLE_ROOT}/${path.join("/")}`);
  const session = new URL(request.url).searchParams.get("session");
  if (session) upstream.searchParams.set("session", session);
  upstream.searchParams.set("key", resolved.key);

  const res = await fetch(upstream, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!res) return Response.json({ error: "Could not reach the 3D Tiles service." }, { status: 504 });
  if (!res.ok) return Response.json({ error: `3D Tiles service returned HTTP ${res.status}.` }, { status: res.status === 404 ? 404 : 502 });

  const type = res.headers.get("content-type") ?? "application/octet-stream";
  if (type.includes("json")) {
    try {
      return Response.json(rewriteTileset(await res.json(), upstream), { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ error: "The 3D provider returned an unsupported tileset." }, { status: 502 });
    }
  }
  return new Response(res.body, { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
}
