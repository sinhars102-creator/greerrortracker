import { NextResponse } from "next/server";
import { callClaude, extractJSON } from "@/lib/anthropic";

function normalize(w) {
  return w.replace(/\(.*?\)/g, "").trim().toLowerCase();
}

function buildPrompt(words) {
  return `Define these GRE-vocabulary-level words. For each, give ONE concise, precise, dictionary-style sentence. If a word commonly has a notable secondary or figurative meaning (the kind the GRE likes to test), include it briefly in the same sentence.

You MUST define every single word listed below — do not skip any, even ones that seem obscure. Echo the "word" field back EXACTLY as given: same spelling and capitalization, no added notes or parentheses.

Words (${words.length} total):
${words.map((w, i) => `${i + 1}. ${w}`).join("\n")}

Respond with ONLY this JSON, no markdown fences:
{"definitions": [{"word": "...", "meaning": "..."}]}`;
}

async function fetchDefinitions(words) {
  const raw = await callClaude(buildPrompt(words), Math.max(2000, words.length * 220));
  const parsed = extractJSON(raw);
  if (!parsed || !Array.isArray(parsed.definitions)) return [];
  return parsed.definitions
    .filter((d) => d && typeof d.word === "string" && typeof d.meaning === "string" && d.meaning.trim())
    .map((d) => ({ word: d.word.trim(), meaning: d.meaning.trim() }));
}

export async function POST(request) {
  try {
    const { words } = await request.json();
    if (!Array.isArray(words) || words.length === 0) {
      return NextResponse.json({ error: "No words given" }, { status: 400 });
    }

    let found = await fetchDefinitions(words);
    let missing = words.filter((w) => !found.some((d) => normalize(d.word) === normalize(w)));

    // Large batches sometimes miss a handful of words — retry just the
    // leftovers in a smaller, more focused call, which is far more reliable.
    if (missing.length > 0) {
      const retry = await fetchDefinitions(missing);
      found = [...found, ...retry];
      missing = missing.filter((w) => !retry.some((d) => normalize(d.word) === normalize(w)));
    }

    // Key results off the caller's exact original spelling, not the model's
    // echo, so the client's own lookups always match.
    const byNormalized = new Map(found.map((d) => [normalize(d.word), d.meaning]));
    const definitions = words
      .filter((w) => byNormalized.has(normalize(w)))
      .map((w) => ({ word: w, meaning: byNormalized.get(normalize(w)) }));

    return NextResponse.json({ definitions });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}
