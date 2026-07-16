import { NextResponse } from "next/server";
import { callClaude, extractJSON } from "@/lib/anthropic";

export async function POST(request) {
  try {
    const { words } = await request.json();
    if (!Array.isArray(words) || words.length < 2) {
      return NextResponse.json({ error: "Not enough words to group" }, { status: 400 });
    }

    const wordList = words.map((w) => `${w.w}: ${w.m}`).join("\n");

    const prompt = `You are helping a GRE student organize their vocabulary list into clusters of near-synonyms — words that mean similar things and are easy to confuse with each other, especially on Sentence Equivalence questions.

WORD LIST (word: meaning):
${wordList}

Identify clusters of 2 to 5 words each that share closely related or overlapping meanings. Not every word needs to be grouped — skip words with no good match in the list. A word should not appear in more than one group. Give each group a short descriptive name (e.g., "words for arrogant", "words for concealment"). Only use words from the list above, spelled EXACTLY as given.

Respond with ONLY this JSON, no markdown fences:
{"groups": [{"name": "...", "words": ["...", "..."]}]}`;

    const raw = await callClaude(prompt, 3000);
    const parsed = extractJSON(raw);
    if (!parsed || !Array.isArray(parsed.groups)) {
      return NextResponse.json({ error: "Could not parse groups" }, { status: 502 });
    }

    const validWords = new Set(words.map((w) => w.w.toLowerCase()));
    const seen = new Set();
    const groups = parsed.groups
      .filter((g) => g && typeof g.name === "string" && Array.isArray(g.words))
      .map((g) => ({
        name: g.name.trim(),
        words: g.words.filter((w) => typeof w === "string" && validWords.has(w.toLowerCase()) && !seen.has(w.toLowerCase())),
      }))
      .filter((g) => g.name && g.words.length >= 2);

    // Enforce "a word appears in at most one group" across the whole response.
    const deduped = [];
    for (const g of groups) {
      const fresh = g.words.filter((w) => !seen.has(w.toLowerCase()));
      if (fresh.length < 2) continue;
      fresh.forEach((w) => seen.add(w.toLowerCase()));
      deduped.push({ name: g.name, words: fresh });
    }

    return NextResponse.json({ groups: deduped });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}
