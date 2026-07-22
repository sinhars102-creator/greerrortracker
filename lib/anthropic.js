// Server-side only. Never import this from a Client Component — it reads
// process.env.ANTHROPIC_API_KEY, which must stay off the client bundle.

import { createClient } from "@supabase/supabase-js";
import { callGemini } from "@/lib/gemini";

// Reads the on-screen provider switch (components/AppShell.js writes it via
// lib/settings.js). The row's select policy is public — no auth needed — so
// a plain anon client works from any server route. Falls back to Anthropic
// on any lookup failure so a settings-table hiccup never blocks AI calls.
async function getConfiguredProvider() {
  if (process.env.AI_PROVIDER) return process.env.AI_PROVIDER;
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data } = await supabase.from("app_settings").select("ai_provider").eq("id", true).maybeSingle();
    return (data && data.ai_provider) || "anthropic";
  } catch {
    return "anthropic";
  }
}

export const QUANT_SUBTYPES = [
  "Arithmetic", "Algebra", "Geometry", "Number Properties",
  "Word Problems", "Data Interpretation", "Probability & Combinatorics", "Quantitative Comparison",
];
export const VERBAL_SUBTYPES = ["Sentence Equivalence", "Text Completion", "Reading Comprehension", "Vocabulary"];
export const MISTAKE_TYPES = [
  "Concept Gap", "Careless Error", "Misread Question", "Vocabulary Gap",
  "Time Pressure", "Trap Answer", "Wrong Assumption", "Calculation Error", "Pacing / Rushed",
];
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
 * Calls the active AI provider with either a plain string prompt or a
 * multimodal content array (for image/document + text, e.g.
 * [{type:"image",...}, {type:"text",...}]) — same content shape either way.
 *
 * Provider is whatever the header switch is set to (persisted in the
 * app_settings table) — "anthropic" or "gemini" — with the AI_PROVIDER env
 * var as a hard local override for testing. Every caller in this file (and
 * every API route) goes through this one function, so the switch affects
 * the whole app from one place.
 */
export async function callClaude(content, maxTokens = 1200) {
  const provider = await getConfiguredProvider();
  if (provider === "gemini") {
    return callGemini(content, maxTokens);
  }

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

function normalizeWord(w) {
  return w.replace(/\(.*?\)/g, "").trim().toLowerCase();
}

function buildDefinePrompt(words) {
  return `Define these GRE-vocabulary-level words. For each, give ONE concise, precise, dictionary-style sentence. If a word commonly has a notable secondary or figurative meaning (the kind the GRE likes to test), include it briefly in the same sentence.

You MUST define every single word listed below — do not skip any, even ones that seem obscure. Echo the "word" field back EXACTLY as given: same spelling and capitalization, no added notes or parentheses.

Words (${words.length} total):
${words.map((w, i) => `${i + 1}. ${w}`).join("\n")}

Respond with ONLY this JSON, no markdown fences:
{"definitions": [{"word": "...", "meaning": "..."}]}`;
}

async function fetchWordDefinitions(words) {
  const raw = await callClaude(buildDefinePrompt(words), Math.max(2000, words.length * 220));
  const parsed = extractJSON(raw);
  if (!parsed || !Array.isArray(parsed.definitions)) return [];
  return parsed.definitions
    .filter((d) => d && typeof d.word === "string" && typeof d.meaning === "string" && d.meaning.trim())
    .map((d) => ({ word: d.word.trim(), meaning: d.meaning.trim() }));
}

/**
 * Looks up dictionary-style definitions for GRE vocab words. Returns only
 * the words it could define, matched back to the caller's exact original
 * spelling — words the model couldn't define are simply absent. Shared by
 * /api/define-words (web app) and /api/extension/vocab (Chrome extension).
 */
export async function defineWords(words) {
  let found = await fetchWordDefinitions(words);
  let missing = words.filter((w) => !found.some((d) => normalizeWord(d.word) === normalizeWord(w)));

  // Large batches sometimes miss a handful of words — retry just the
  // leftovers in a smaller, more focused call, which is far more reliable.
  if (missing.length > 0) {
    const retry = await fetchWordDefinitions(missing);
    found = [...found, ...retry];
  }

  const byNormalized = new Map(found.map((d) => [normalizeWord(d.word), d.meaning]));
  return words
    .filter((w) => byNormalized.has(normalizeWord(w)))
    .map((w) => ({ word: w, meaning: byNormalized.get(normalizeWord(w)) }));
}

/** Turns a Supabase Storage signed URL's fetched bytes into an image content block. */
export async function imageUrlToContentBlock(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const mediaType = res.headers.get("content-type") || "image/jpeg";
  const base64 = Buffer.from(buf).toString("base64");
  return { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
}

/**
 * Transcribes a GRE question screenshot into { questionText, passage }.
 * Shared by /api/extract-question (web app) and /api/extension/capture
 * (Chrome extension) so the prompt only lives in one place.
 */
export async function extractQuestionFromImage({ image, subtype, needsPassage }) {
  const promptText = `Transcribe this GRE question screenshot.

Question type: ${subtype}

Transcribe the specific question stem, blanks, and answer choices concisely into a "questionText" field.${needsPassage ? ' This is a Reading Comprehension question — also transcribe the ENTIRE reading passage VERBATIM from the screenshot into a "passage" field. If there truly is no passage visible, set "passage" to an empty string.' : ""}

Respond with ONLY this JSON object, nothing else, no markdown fences:
{"questionText": "...", "passage": ${needsPassage ? '"..."' : '""'}}`;

  const content = [
    { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
    { type: "text", text: promptText },
  ];

  const raw = await callClaude(content, 1600);
  const parsed = extractJSON(raw);
  if (!parsed) {
    return { error: `Could not parse extraction response (got: "${raw.trim().slice(0, 140)}")` };
  }
  return {
    questionText: typeof parsed.questionText === "string" ? parsed.questionText : "",
    passage: typeof parsed.passage === "string" ? parsed.passage : "",
  };
}
