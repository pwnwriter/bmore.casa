import { buildFactSheet } from "@/lib/data/facts";

export const runtime = "nodejs";

// Newest first. Falls through when a model is retired (404), rate limited (429)
// or overloaded (500/503), so one busy model cannot take the feature down mid-demo.
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-3.5-flash", "gemini-2.5-flash"].filter((m): m is string => Boolean(m));
const RETRYABLE = new Set([404, 429, 500, 503]);

const SYSTEM = `You are "Ask Baltimore", a careful civic-data assistant inside a Baltimore housing-records explorer.

You receive a FACT SHEET (JSON) computed from Baltimore City DHCD open data, and a QUESTION.

Rules:
- Use ONLY numbers that appear in the fact sheet. Never use outside knowledge of Baltimore, never estimate, never invent a figure.
- Always name the metric, the place, and the time period you are citing (e.g. "rehab permit records in Oliver, 2015-2024").
- Respect every caveat. In particular: open-notice counts by year are NOT historical vacancy; never say a specific building is vacant today; never add rehab and permit counts; treat the partial final year and 2025 permit dip with care.
- Describe what the records show. Do NOT explain causes, motives, or policy effects, and do not predict.
- If the fact sheet cannot answer the question, say so plainly and say what it can answer instead.
- Plain prose, no markdown, at most 110 words.`;

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: "Ask Baltimore is not configured (GEMINI_API_KEY is missing). The rest of the app works without it." }, { status: 503 });

  let body: { question?: unknown; neighborhood?: unknown; compare?: unknown; range?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 300) : "";
  if (question.length < 3) return Response.json({ error: "Ask a question first." }, { status: 400 });
  const asIndex = (v: unknown) => (typeof v === "number" ? v : null);
  const range = Array.isArray(body.range) && body.range.length === 2 && body.range.every((n) => typeof n === "number") ? (body.range as [number, number]) : ([0, 9999] as [number, number]);

  let facts: Awaited<ReturnType<typeof buildFactSheet>>;
  try {
    facts = await buildFactSheet(asIndex(body.neighborhood), asIndex(body.compare), range);
  } catch {
    return Response.json({ error: "Processed data is missing. Run `uv run bmore-casa refresh`." }, { status: 500 });
  }

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: `FACT SHEET:\n${JSON.stringify(facts)}\n\nQUESTION: ${question}` }] }],
    // generous: thinking tokens count against this budget on newer models
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
  };

  let lastError = "Gemini request failed.";
  for (const model of MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      const json = await res.json();
      if (!res.ok) {
        lastError = json?.error?.message ?? `Gemini returned HTTP ${res.status}`;
        if (RETRYABLE.has(res.status)) continue;
        break;
      }
      let answer = (json?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
      // never show half a sentence if the budget still ran out
      if (json?.candidates?.[0]?.finishReason === "MAX_TOKENS") answer = answer.slice(0, answer.lastIndexOf(".") + 1).trim();
      if (!answer) {
        lastError = "Gemini returned an empty answer.";
        break;
      }
      return Response.json({ answer, model, grounding: { selectedYears: facts.selected_years, scopes: facts.scopes.map((s) => s.scope), dataDownloaded: facts.data_downloaded } });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      break;
    }
  }
  return Response.json({ error: lastError }, { status: 502 });
}
