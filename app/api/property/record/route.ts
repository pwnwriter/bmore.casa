import { getPropertyRecord, parsePropertyRef } from "@/lib/property/context";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  let ref;
  try { ref = parsePropertyRef({ layer: q.get("layer"), index: q.has("index") ? Number(q.get("index")) : null, neighborhood: q.has("neighborhood") ? Number(q.get("neighborhood")) : null }); }
  catch { return Response.json({ error: "Invalid property reference." }, { status: 400 }); }
  try { return Response.json(await getPropertyRecord(ref)); }
  catch { return Response.json({ error: "Property record not found." }, { status: 404 }); }
}
