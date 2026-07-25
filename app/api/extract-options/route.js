import { NextResponse } from "next/server";
import { callClaude, extractJSON, imageUrlToContentBlock } from "@/lib/anthropic";

export async function POST(request) {
  try {
    const { entry, image, imageUrl } = await request.json();
    const hasImage = !!image || !!imageUrl;

    const promptText = `Extract the answer-choice structure for this GRE question as JSON.

Question type: ${entry.subtype}
${(entry.passage || "").trim() ? `Passage:\n${entry.passage.slice(0, 4000)}\n\n` : ""}${hasImage ? "Question: attached as a screenshot image — read the question and all answer choices from it." : `Question: ${(entry.questionText || "").slice(0, 1200)}`}
The student recorded the correct answer, from the official answer key, as: ${entry.correctAnswer || "(not recorded)"}

If this question has MULTIPLE separate blanks, each with its own list of options, return one entry in "blanks" per blank, each with its own "options" array and a short "label" (e.g. "Blank (i)"). Otherwise return exactly one entry with "label" set to an empty string.

For each blank, determine the 0-based index/indices of the correct option(s), usually 1 index, except Sentence Equivalence, which always needs exactly 2.

IMPORTANT — the recorded answer above is ground truth from the official key, not a guess. Do NOT independently re-solve the question and substitute your own judgment, even if you think a different option reads better — GRE questions are frequently subtle enough that a plausible-sounding option is a deliberate trap, and the recorded answer is correct. Your job is to MATCH the recorded answer to the right option index/indices in what you transcribe, not to re-derive it. Parse the recorded answer as follows:
- One blank, one letter (e.g. "C"): that option is correct.
- One blank, multiple letters/values (e.g. "B and D", "B, C"): all of those options are correct (multiSelect).
- Multiple blanks: the recorded answer should give one letter per blank, in the same left-to-right/top-to-bottom order as the blanks appear — however it's delimited, whether "B, B, C", "B B C", or run together with no separator at all like "BBC" (in that case each character is one blank's letter, in order).
- If the recorded answer doesn't look like letters at all (e.g. it's the literal answer text, or a number for a numeric-entry question), match it by meaning/value instead.
- Only if the recorded answer is genuinely missing, empty, or you truly cannot map it to any option should you fall back to determining the correct answer yourself.

Also determine "multiSelect": true if this is a checkbox-style "select all that apply" / "indicate all such..." question where the student can check any number of options (not a fixed count), false otherwise (standard single-answer multiple choice, or Sentence Equivalence's fixed pair).

If this is a Quant "numeric entry" question — the student types a number or fraction into a box, with NO listed answer choices at all — do not invent options. Instead return that blank as {"label": "", "options": [], "correctIndices": [], "multiSelect": false, "numericAnswer": "the correct value exactly as it should be entered, e.g. \"22\" or \"3/4\""}, using the student's recorded correct answer above as the value if it looks valid.

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
      .filter((b) => b && (
        (Array.isArray(b.options) && b.options.length >= 2)
        || (typeof b.numericAnswer === "string" && b.numericAnswer.trim())
      ))
      .map((b) => {
        const isNumeric = !(Array.isArray(b.options) && b.options.length >= 2);
        return isNumeric
          ? { label: typeof b.label === "string" ? b.label : "", options: [], correctIndices: [], multiSelect: false, numericAnswer: b.numericAnswer.trim() }
          : {
              label: typeof b.label === "string" ? b.label : "",
              options: b.options.map(String),
              correctIndices: Array.isArray(b.correctIndices) ? b.correctIndices.filter((i) => Number.isInteger(i)) : [],
              multiSelect: b.multiSelect === true,
              numericAnswer: null,
            };
      });
    if (blanks.length === 0) {
      return NextResponse.json({ error: "Options list came back empty" }, { status: 502 });
    }
    return NextResponse.json({ blanks });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}
