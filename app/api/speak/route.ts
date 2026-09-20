export const runtime = "nodejs";

// "River - Relaxed, Neutral, Informative" (ElevenLabs premade); override with ELEVENLABS_VOICE_ID.
const DEFAULT_VOICE = "SAz9YHcvj6GT2YYXdXww";
const MAX_CHARS = 900;

/** Reads a grounded Ask Baltimore answer aloud. Text-to-speech only - it never generates content. */
export async function POST(request: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return Response.json({ error: "Narration is not configured (ELEVENLABS_API_KEY is missing)." }, { status: 503 });

  let text = "";
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!text) return Response.json({ error: "Nothing to read." }, { status: 400 });
  if (text.length > MAX_CHARS) return Response.json({ error: `Text is longer than ${MAX_CHARS} characters.` }, { status: 413 });

  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": key },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5" }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);

  if (!res || !res.ok || !res.body) {
    const detail = res ? await res.text().catch(() => "") : "";
    return Response.json({ error: `ElevenLabs request failed${res ? ` (HTTP ${res.status})` : ""}.`, detail: detail.slice(0, 200) }, { status: 502 });
  }
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
