import { NextResponse } from "next/server";
import { callClaude, extractJSON } from "@/lib/anthropic";

export async function POST(request) {
  try {
    const { image, subtype, needsPassage } = await request.json();
    if (!image) {
      return NextResponse.json({ error: "No image given" }, { status: 400 });
    }

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
      return NextResponse.json({ error: `Could not parse extraction response (got: "${raw.trim().slice(0, 140)}")` }, { status: 502 });
    }

    return NextResponse.json({
      questionText: typeof parsed.questionText === "string" ? parsed.questionText : "",
      passage: typeof parsed.passage === "string" ? parsed.passage : "",
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}
