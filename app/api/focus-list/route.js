import { NextResponse } from "next/server";
import { callClaude, extractJSON } from "@/lib/anthropic";

export async function POST(request) {
  try {
    const { entries, wordTraps } = await request.json();
    const quantMistakes = entries.filter((m) => m.section === "Quant");
    const verbalMistakes = entries.filter((m) => m.section === "Verbal");

    const subtypeFreq = (list) => {
      const counts = {};
      list.forEach((m) => (counts[m.subtype] = (counts[m.subtype] || 0) + 1));
      return counts;
    };

    const prompt = `You are helping a GRE student build a focused pre-test review list. Be selective — short enough to actually review, not a dump of everything.

QUANT MISTAKES (${quantMistakes.length} total): ${JSON.stringify(quantMistakes)}
QUANT SUBTYPE FREQUENCY: ${JSON.stringify(subtypeFreq(quantMistakes))}

VERBAL MISTAKES (${verbalMistakes.length} total): ${JSON.stringify(verbalMistakes)}
VERBAL SUBTYPE FREQUENCY: ${JSON.stringify(subtypeFreq(verbalMistakes))}

WORD TRAPS (${(wordTraps || []).length} total — always Verbal): ${JSON.stringify(wordTraps || [])}

Select up to 12 highest-priority SPECIFIC items total. Reserve roughly HALF the slots for Quant if there are enough eligible Quant mistakes — word traps are Verbal-only and will crowd out Quant unless you deliberately budget for it. Use subtype frequency as recurrence evidence even when repeatCount is 0. Skip already-mastered mistakes unless their topic is still frequently missed.

For each item, write one short, specific "note" — the exact thing to remember, not a category restatement.

Respond with ONLY this JSON, no markdown fences:
{"items": [{"id": "...", "kind": "mistake", "note": "..."}, {"id": "...", "kind": "wordTrap", "note": "..."}]}`;

    const raw = await callClaude(prompt, 3200);
    const parsed = extractJSON(raw);
    if (!parsed || !Array.isArray(parsed.items)) {
      return NextResponse.json({ error: "Could not parse focus list response" }, { status: 502 });
    }
    const validIds = new Set([...entries.map((e) => e.id), ...(wordTraps || []).map((w) => w.id)]);
    const items = parsed.items
      .filter((it) => it && validIds.has(it.id) && (it.kind === "mistake" || it.kind === "wordTrap"))
      .map((it) => ({ id: it.id, kind: it.kind, note: typeof it.note === "string" ? it.note : "", checked: false }));
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}
