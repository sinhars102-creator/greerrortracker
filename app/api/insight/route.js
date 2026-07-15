import { NextResponse } from "next/server";
import { callClaude, extractJSON } from "@/lib/anthropic";

export async function POST(request) {
  try {
    const { entries } = await request.json();
    const prompt = `You are a blunt, precise GRE prep coach reviewing a student's error log (JSON below). No encouragement, no fluff, no hedging, no generic test-prep advice.

ERROR LOG: ${JSON.stringify(entries)}

For EACH distinct question subtype that appears, write a "diagnosis": 1-2 sentences naming the SPECIFIC recurring root cause, grounded in their notes.

Then, depending on section:
- Quant: produce "keyFacts" — 2-6 standalone, scannable facts/formulas/rules they got wrong or forgot. Not a sequential process. Set "framework" to [].
- Verbal: produce "framework" — an ORDERED 3-5 step process to run every time they hit this subtype, countering their exact failure pattern. Set "keyFacts" to [].

Keep every subtype separate. Also write one overall cross-cutting sentence ONLY if a pattern spans multiple subtypes; otherwise empty string.

Respond with ONLY this JSON, no markdown fences:
{"overall": "...", "bySubtype": [{"section": "Quant", "subtype": "...", "diagnosis": "...", "keyFacts": ["..."], "framework": []}]}`;

    const raw = await callClaude(prompt, 4000);
    const parsed = extractJSON(raw);
    if (!parsed || !Array.isArray(parsed.bySubtype)) {
      return NextResponse.json({ error: "Could not parse insight response" }, { status: 502 });
    }
    return NextResponse.json({
      overall: typeof parsed.overall === "string" ? parsed.overall : "",
      bySubtype: parsed.bySubtype
        .filter((i) => i && i.section && i.subtype && i.diagnosis)
        .map((i) => ({
          ...i,
          keyFacts: Array.isArray(i.keyFacts) ? i.keyFacts.filter((s) => typeof s === "string") : [],
          framework: Array.isArray(i.framework) ? i.framework.filter((s) => typeof s === "string") : [],
        })),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}
