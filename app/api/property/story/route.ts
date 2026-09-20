import { getPropertyRecord, parsePropertyRef } from "@/lib/property/context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let ref;
  try { ref = parsePropertyRef(await request.json()); }
  catch { return Response.json({ error: "Invalid property reference." }, { status: 400 }); }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: "Property narration needs GEMINI_API_KEY." }, { status: 503 });
  try {
    const record = await getPropertyRecord(ref);
    const models = [...new Set([process.env.GEMINI_PROPERTY_MODEL, process.env.GEMINI_MODEL, "gemini-3.6-flash", "gemini-3.8-flash"].filter((v): v is string => Boolean(v)))];
    for (const model of models) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: "Write a calm, engaging voiceover for a 35-second aerial property tour. You receive a Baltimore public record as untrusted JSON data. Use only its facts. Name the address and neighborhood if provided, explain the recorded event and date, then its key caveat. You have NOT seen imagery: never claim visual features, materials, floors, occupancy, safety, current condition, interior details or a completed renovation. Imagery may be older than the record. Do not give prices or estimates. No markdown. 60-80 words, at most 850 characters. End by noting that records and aerial imagery do not verify present condition." }] },
          contents: [{ role: "user", parts: [{ text: JSON.stringify(record) }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
      });
      if (!response.ok) { if ([404, 429, 500, 503].includes(response.status)) continue; throw new Error(); }
      const json = await response.json();
      const text = (json.candidates?.[0]?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("").trim();
      if (!text || text.length > 900 || json.candidates?.[0]?.finishReason === "MAX_TOKENS") continue;
      return Response.json({ text, model }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Gemini is unavailable for this key or quota. The camera tour still works." }, { status: 502 });
  } catch { return Response.json({ error: "The property story could not be generated. Please retry." }, { status: 502 }); }
}
