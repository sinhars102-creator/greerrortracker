// Server-side only. Never import this from a Client Component — it reads
// process.env.ANTHROPIC_API_KEY, which must stay off the client bundle.

export const QUANT_SUBTYPES = [
  "Arithmetic", "Algebra", "Geometry", "Number Properties",
  "Word Problems", "Data Interpretation", "Probability & Combinatorics", "Quantitative Comparison",
];
export const VERBAL_SUBTYPES = ["Sentence Equivalence", "Text Completion", "Reading Comprehension", "Vocabulary"];
export const MISTAKE_TYPES = [
  "Concept Gap", "Careless Error", "Misread Question", "Vocabulary Gap",
  "Time Pressure", "Trap Answer", "Wrong Assumption", "Calculation Error", "Pacing / Rushed",
];
export const TRAP_TAGS = ["Out of Scope", "Too Extreme", "Reverses Meaning", "Right Words/Wrong Reason", "Distorts a Detail", "Not Mentioned", "Other"];

export function extractJSON(text) {
  let t = text.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  let result = tryParse(t);
  if (result) return result;
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const slice = t.slice(start, end + 1);
    result = tryParse(slice);
    if (result) return result;
    const cleaned = slice
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/,\s*([}\]])/g, "$1");
    result = tryParse(cleaned);
    if (result) return result;
  }
  return null;
}

/**
 * Calls Claude with either a plain string prompt or a multimodal content array
 * (for image + text, e.g. [{type:"image",...}, {type:"text",...}]).
 */
export async function callClaude(content, maxTokens = 1200) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set on the server.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [{ role: "user", content }],
    }),
  });

  const data = await res.json();
  if (!res.ok || data.type === "error") {
    throw new Error((data.error && data.error.message) || `API request failed (${res.status})`);
  }
  if (data.stop_reason === "max_tokens") {
    throw new Error("Response was cut off by the token limit before it finished.");
  }
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  if (!text.trim()) throw new Error("Empty response from the model");
  return text;
}

/** Turns a Supabase Storage signed URL's fetched bytes into an image content block. */
export async function imageUrlToContentBlock(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const mediaType = res.headers.get("content-type") || "image/jpeg";
  const base64 = Buffer.from(buf).toString("base64");
  return { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
}
