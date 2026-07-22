// Server-side only. Manual fallback provider for lib/anthropic.js's callClaude,
// switched on via the AI_PROVIDER env var — flip it to "gemini" when Anthropic
// credits are out, flip back to "anthropic" (or unset) when they're restored.
// Never imported directly by API routes — always go through callClaude so the
// provider choice stays in one place.

// Translates the Anthropic-shaped content blocks already used throughout
// lib/anthropic.js (plain string, or an array of {type:"text"|"image"|"document", ...})
// into Gemini's `contents[].parts[]` shape, so none of the prompt-building
// code has to know which provider is active.
function toGeminiParts(content) {
  if (typeof content === "string") return [{ text: content }];
  return content.map((block) => {
    if (block.type === "text") return { text: block.text };
    if (block.type === "image" || block.type === "document") {
      return { inline_data: { mime_type: block.source.media_type, data: block.source.data } };
    }
    throw new Error(`Unsupported content block type for Gemini: ${block.type}`);
  });
}

export async function callGemini(content, maxTokens = 1200) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set on the server.");
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: toGeminiParts(content) }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    }
  );

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error((data.error && data.error.message) || `Gemini request failed (${res.status})`);
  }
  const candidate = (data.candidates || [])[0];
  if (candidate && candidate.finishReason === "MAX_TOKENS") {
    throw new Error("Response was cut off by the token limit before it finished.");
  }
  const text = ((candidate && candidate.content && candidate.content.parts) || [])
    .map((p) => p.text || "")
    .join("\n");
  if (!text.trim()) throw new Error("Empty response from the model");
  return text;
}
