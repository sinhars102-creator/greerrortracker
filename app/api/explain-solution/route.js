import { NextResponse } from "next/server";
import { callClaude, extractJSON } from "@/lib/anthropic";

export async function POST(request) {
  try {
    const { entry, blanks } = await request.json();
    if (!Array.isArray(blanks) || blanks.length === 0) {
      return NextResponse.json({ error: "No blanks given" }, { status: 400 });
    }

    const blankBlocks = blanks.map((b, i) => {
      const optionList = b.options.map((o, oi) => `${oi}: ${o}`).join("\n");
      return `${b.label ? `${b.label}:` : `Blank ${i + 1}:`}\nOptions:\n${optionList}\nCorrect index/indices: ${JSON.stringify(b.correctIndices || [])}`;
    }).join("\n\n");

    const promptText = `Explain the correct answer to this GRE question, for a student who just checked their answer and wants to understand the reasoning.

Question type: ${entry.section} - ${entry.subtype}
${(entry.passage || "").trim() ? `Passage:\n${entry.passage.slice(0, 4000)}\n\n` : ""}Question: ${(entry.questionText || "").slice(0, 1200)}

${blankBlocks}

For each blank, in order, write a concise, precise explanation: why the correct option(s) are right, and briefly why the others are wrong. No praise, no filler, no restating the question.

Respond with ONLY this JSON, no markdown fences:
{"explanations": ["..."]}`;

    const raw = await callClaude(promptText, 1600);
    const parsed = extractJSON(raw);
    if (!parsed || !Array.isArray(parsed.explanations)) {
      return NextResponse.json({ error: `Could not parse explanation response (got: "${raw.trim().slice(0, 140)}")` }, { status: 502 });
    }

    const explanations = blanks.map((_, i) => (typeof parsed.explanations[i] === "string" ? parsed.explanations[i] : ""));
    return NextResponse.json({ explanations });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}
