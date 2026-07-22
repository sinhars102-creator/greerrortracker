import { NextResponse } from "next/server";
import { callClaude, extractJSON, imageUrlToContentBlock } from "@/lib/anthropic";

export async function POST(request) {
  try {
    const { entry, image, imageUrl } = await request.json();
    const hasImage = !!image || !!imageUrl;

    const promptText = `Extract the answer-choice structure for this GRE question as JSON.

Question type: ${entry.subtype}
${(entry.passage || "").trim() ? `Passage:\n${entry.passage.slice(0, 4000)}\n\n` : ""}${hasImage ? "Question: attached as a screenshot image — read the question and all answer choices from it." : `Question: ${(entry.questionText || "").slice(0, 1200)}`}
The student recorded the correct answer as: ${entry.correctAnswer || "(not recorded)"}

If this question has MULTIPLE separate blanks, each with its own list of options, return one entry in "blanks" per blank, each with its own "options" array and a short "label" (e.g. "Blank (i)"). Otherwise return exactly one entry with "label" set to an empty string.

For each blank, determine the 0-based index/indices of the correct option(s), usually 1 index, except Sentence Equivalence, which always needs exactly 2. Also determine "multiSelect": true if this is a checkbox-style "select all that apply" / "indicate all such..." question where the student can check any number of options (not a fixed count), false otherwise (standard single-answer multiple choice, or Sentence Equivalence's fixed pair).

Respond with ONLY this JSON — no markdown fences, no preamble or explanation before or after it:
{"blanks": [{"label": "", "options": ["choice 1", "choice 2", "..."], "correctIndices": [0], "multiSelect": false}]}`;

    let content = promptText;
    if (image) {
      content = [{ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } }, { type: "text", text: promptText }];
    } else if (imageUrl) {
      const block = await imageUrlToContentBlock(imageUrl);
      content = [block, { type: "text", text: promptText }];
    }

    const raw = await callClaude(content, 1600);
    const parsed = extractJSON(raw);
    if (!parsed || !Array.isArray(parsed.blanks) || parsed.blanks.length === 0) {
      return NextResponse.json({ error: `Could not extract answer choices (got: "${raw.trim().slice(0, 140)}")` }, { status: 502 });
    }
    const blanks = parsed.blanks
      .filter((b) => b && Array.isArray(b.options) && b.options.length >= 2)
      .map((b) => ({
        label: typeof b.label === "string" ? b.label : "",
        options: b.options.map(String),
        correctIndices: Array.isArray(b.correctIndices) ? b.correctIndices.filter((i) => Number.isInteger(i)) : [],
        multiSelect: b.multiSelect === true,
      }));
    if (blanks.length === 0) {
      return NextResponse.json({ error: "Options list came back empty" }, { status: 502 });
    }
    return NextResponse.json({ blanks });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}
