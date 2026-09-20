/** Keep provider credentials out of nested tileset links sent to the browser. */
export function rewriteTileset(value: unknown, upstream: URL): unknown {
  if (Array.isArray(value)) return value.map(v => rewriteTileset(v, upstream));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if ((key === "uri" || key === "url") && typeof item === "string") {
      const url = new URL(item, upstream);
      if (url.origin !== "https://tile.googleapis.com" || !url.pathname.startsWith("/v1/3dtiles/")) throw new Error("Unexpected tile resource.");
      const session = url.searchParams.get("session") ?? upstream.searchParams.get("session");
      return [key, `/api/tiles3d/${url.pathname.slice("/v1/3dtiles/".length)}${session ? `?session=${encodeURIComponent(session)}` : ""}`];
    }
    return [key, rewriteTileset(item, upstream)];
  }));
}
