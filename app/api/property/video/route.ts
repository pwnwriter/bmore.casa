import { getPropertyRecord, parsePropertyRef } from "@/lib/property/context";
import { readVideoOperation, signVideoOperation } from "@/lib/property/video-token";

export const runtime = "nodejs";
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_IMAGE = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: "Video generation needs GEMINI_API_KEY." }, { status: 503 });
  if (Number(request.headers.get("content-length")) > MAX_IMAGE + 100_000) return Response.json({ error: "Use a photo smaller than 8 MB." }, { status: 413 });
  let photo: File, brief: string, ref;
  try {
    const form = await request.formData();
    ref = parsePropertyRef(JSON.parse(String(form.get("property"))));
    const image = form.get("photo");
    brief = String(form.get("brief") ?? "").trim();
    if (!(image instanceof File) || image.size === 0 || image.size > MAX_IMAGE || !["image/jpeg", "image/png"].includes(image.type) || !brief || brief.length > 600) throw new Error();
    photo = image;
  } catch { return Response.json({ error: "Provide a JPEG or PNG photo under 8 MB and a renovation brief (up to 600 characters)." }, { status: 400 }); }
  try {
    const record = await getPropertyRecord(ref);
    const bytes = Buffer.from(await photo.arrayBuffer());
    const isPNG = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJPEG = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!(photo.type === "image/png" ? isPNG : isJPEG)) return Response.json({ error: "The uploaded file is not a valid JPEG or PNG photo." }, { status: 400 });
    const model = process.env.GEMINI_VIDEO_MODEL || "veo-3.1-fast-generate-preview";
    const response = await fetch(`${BASE}/models/${encodeURIComponent(model)}:predictLongRunning`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        instances: [{ prompt: `Create an 8-second photorealistic architectural renovation CONCEPT film based on the attached property photo. The property reference is ${record.title}. Preserve the identity, proportions, footprint and neighboring buildings visible in the photo. Reveal the proposed exterior changes with a slow, steady real-estate camera dolly and gentle orbit. Natural daylight, realistic materials, consistent geometry, no cuts, no invented interiors or people, no captions or spoken dialogue. This is an imagined proposal, not documentary footage. Requested exterior changes: ${brief}`, image: { inlineData: { mimeType: photo.type, data: bytes.toString("base64") } } }],
        parameters: { aspectRatio: "16:9", durationSeconds: 8, resolution: "720p", sampleCount: 1 },
      }),
    });
    if (!response.ok) return Response.json({ error: `The video provider declined the request (HTTP ${response.status}). Check that Veo is enabled with available billing/quota for this key.` }, { status: 502 });
    const json = await response.json();
    if (typeof json.name !== "string") throw new Error();
    return Response.json({ token: signVideoOperation(json.name, key), model }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "The renovation video could not be started. Please retry." }, { status: 502 }); }
}

export async function GET(request: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: "Video generation is not configured." }, { status: 503 });
  const query = new URL(request.url).searchParams;
  let operation;
  try { operation = readVideoOperation(query.get("token") ?? "", key); }
  catch { return Response.json({ error: "This video session is invalid or expired." }, { status: 400 }); }
  try {
    const response = await fetch(`${BASE}/${operation}`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if (!response.ok) throw new Error();
    const json = await response.json();
    if (json.error) return Response.json({ error: "The provider could not finish this video. Try a different photo or brief." }, { status: 502 });
    if (!json.done) return Response.json({ done: false }, { headers: { "Cache-Control": "no-store" } });
    const uri = json.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (typeof uri !== "string") return Response.json({ error: "No video was returned. The provider may have filtered the request." }, { status: 422 });
    if (query.get("media") !== "1") return Response.json({ done: true }, { headers: { "Cache-Control": "no-store" } });
    const url = new URL(uri);
    if (url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com" || !url.pathname.startsWith("/v1beta/files/")) throw new Error();
    let media = await fetch(url, { headers: { "x-goog-api-key": key }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
    // Signed media redirects need no API key, and are restricted to Google's media hosts.
    for (let n = 0; n < 3 && [301, 302, 303, 307, 308].includes(media.status); n++) {
      const location = media.headers.get("location");
      if (!location) throw new Error();
      const next = new URL(location, url);
      if (next.protocol !== "https:" || !(next.hostname === "storage.googleapis.com" || next.hostname.endsWith(".googleusercontent.com"))) throw new Error();
      media = await fetch(next, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    }
    if (!media.ok || !media.body) throw new Error();
    return new Response(media.body, { headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store", ...(query.get("download") === "1" ? { "Content-Disposition": 'attachment; filename="renovation-concept.mp4"' } : {}) } });
  } catch { return Response.json({ error: "The video status or media could not be retrieved. Please retry." }, { status: 502 }); }
}
