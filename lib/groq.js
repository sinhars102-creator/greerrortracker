// Server-side only. Third manual provider option alongside Anthropic and
// Gemini (see lib/anthropic.js's callClaude dispatch) — mainly for cost
// savings on high-volume text calls (classify, grade-vocab, etc).
//
// Groq has no vision-capable model on a standard API key (checked via
// GET /openai/v1/models), so it can only serve text-only prompts. callClaude
// routes image/document content elsewhere automatically — this file isn't
// expected to ever see a non-text block, but throws clearly if it does
// rather than silently mishandling it.

// OpenAI-compatible chat completions — translates the Anthropic-shaped
// content (plain string, or an array of {type:"text", ...} blocks) into a
// single user message string.
function toGroqMessageContent(content) {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (block.type === "text") return block.text;
      throw new Error(`Groq provider doesn't support content type "${block.type}" (text-only)`);
    })
    .join("\n\n");
}

export async function callGroq(content, maxTokens = 1200) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set on the server.");
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: toGroqMessageContent(content) }],
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error((data.error && data.error.message) || `Groq request failed (${res.status})`);
  }
  const choice = (data.choices || [])[0];
  if (choice && choice.finish_reason === "length") {
    throw new Error("Response was cut off by the token limit before it finished.");
  }
  const text = (choice && choice.message && choice.message.content) || "";
  if (!text.trim()) throw new Error("Empty response from the model");
  return text;
}
