// Server-side only. Fourth manual provider option (OpenAI) alongside
// Anthropic, Gemini, and Groq — see lib/anthropic.js's callClaude dispatch.
//
// Vision-capable (images route here directly, same as Gemini) but PDF
// documents don't — OpenAI's chat/completions API has no native inline-PDF
// content type, so callClaude routes document calls (PDF import) to
// Anthropic regardless of this provider being selected.

function toOpenAIMessageContent(content) {
  if (typeof content === "string") return content;
  return content.map((block) => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "image") {
      return { type: "image_url", image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } };
    }
    throw new Error(`OpenAI provider doesn't support content type "${block.type}"`);
  });
}

export async function callOpenAI(content, maxTokens = 1200) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set on the server.");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: toOpenAIMessageContent(content) }],
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error((data.error && data.error.message) || `OpenAI request failed (${res.status})`);
  }
  const choice = (data.choices || [])[0];
  if (choice && choice.finish_reason === "length") {
    throw new Error("Response was cut off by the token limit before it finished.");
  }
  const text = (choice && choice.message && choice.message.content) || "";
  if (!text.trim()) throw new Error("Empty response from the model");
  return text;
}
