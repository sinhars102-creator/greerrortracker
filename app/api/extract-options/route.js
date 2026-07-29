import { NextResponse } from "next/server";
import { callClaude, extractJSON, imageUrlToContentBlock } from "@/lib/anthropic";
import { EXTRACTION_VERSION } from "@/lib/extractionVersion";

function letterIndex(letter) {
  const c = letter.toUpperCase().charCodeAt(0) - 65;
  return c >= 0 && c <= 25 ? c : -1;
}

function normalizeText(s) {
  return (s || "").toLowerCase().trim().replace(/[.,;:!?]+$/, "");
}

function matchTextIndex(raw, options) {
  const target = normalizeText(raw);
  if (!target) return -1;
  let idx = options.findIndex((o) => normalizeText(o) === target);
  if (idx === -1) idx = options.findIndex((o) => normalizeText(o).includes(target) || target.includes(normalizeText(o)));
  return idx;
}

// Splits a recorded answer like "B, D", "B and D", "A B C", or "B & D" into
// its individual letter tokens. Splitting (rather than a blind global
// /[A-Za-z]/g match) matters because the connector word "and" itself
// contains letters — a naive match would wrongly pull "a", "n", "d" out of
// "B and D" as if they were extra answer letters.
function splitLetterTokens(str) {
  return str.split(/\s*,\s*|\s+and\s+|\s*&\s*|\s+/i).map((t) => t.trim()).filter(Boolean);
}

// Deterministically resolves which option(s) are correct from the
// student's own recorded answer — no AI judgment involved. The recorded
// answer is already ground truth; it's never re-derived or "rechecked",
// only matched to a transcribed option index in plain code.
function resolveCorrectIndices(rawAnswer, blanksOptions) {
  const trimmed = (rawAnswer || "").trim();
  const numBlanks = blanksOptions.length;
  if (!trimmed) return blanksOptions.map(() => []);

  if (numBlanks > 1) {
    // One letter per blank, however delimited ("B, C", "B C", "B and C"),
    // or a bare run with no separator at all ("BC") where each character
    // is one blank's letter, in order.
    let tokens = splitLetterTokens(trimmed);
    if (tokens.length !== numBlanks || !tokens.every((t) => /^[A-Za-z]$/.test(t))) {
      tokens = /^[A-Za-z]+$/.test(trimmed) && trimmed.length === numBlanks ? trimmed.split("") : null;
    }
    if (tokens) {
      const indices = tokens.map((L, i) => {
        const idx = letterIndex(L);
        return idx >= 0 && idx < blanksOptions[i].length ? idx : -1;
      });
      if (indices.every((i) => i >= 0)) return indices.map((i) => [i]);
    }
    // Can't confidently split one recorded string across multiple blanks —
    // leave unmapped rather than guess.
    return blanksOptions.map(() => []);
  }

  const options = blanksOptions[0];
  // Any number of letters separated by commas/"and"/"&"/whitespace (single
  // or multi-select), or a short bare run with no separator ("BD"/"C").
  const tokens = splitLetterTokens(trimmed);
  let letters = tokens.length > 0 && tokens.every((t) => /^[A-Za-z]$/.test(t)) ? tokens : null;
  if (!letters && /^[A-Za-z]{1,2}$/.test(trimmed)) letters = trimmed.toUpperCase().split("");

  if (letters) {
    const indices = letters.map((L) => letterIndex(L)).filter((i) => i >= 0 && i < options.length);
    if (indices.length === letters.length) return [indices];
  }

  const idx = matchTextIndex(trimmed, options);
  return [idx >= 0 ? [idx] : []];
}

export async function POST(request) {
  try {
    const { entry, image, imageUrl } = await request.json();
    const hasImage = !!image || !!imageUrl;

    // No screenshot and no real transcribed text (this entry's original
    // transcription failed and left the "(see screenshot)" placeholder) —
    // there's nothing here to extract options from. Calling the model on
    // this would just produce garbage (it tends to echo the prompt's own
    // JSON example, "choice 1"/"choice 2"/...), so fail clearly instead.
    const questionText = (entry.questionText || "").trim();
    if (!hasImage && (!questionText || questionText === "(see screenshot)")) {
      return NextResponse.json({ error: "This entry has no screenshot and no transcribed question text to work from — edit it manually to add the question, or delete and re-log it." }, { status: 422 });
    }

    // This prompt is transcription-only — it never asks the model to judge
    // or re-derive which option is correct. The recorded correctAnswer is
    // the student's own ground truth; matching it to an option index is
    // done deterministically in code below (see resolveCorrectIndices),
    // not by asking the model to "recheck" an answer that's already known.
    const promptText = `Transcribe the answer-choice structure for this GRE question as JSON. This is transcription only — do not determine or judge which option is correct.

Question type: ${entry.subtype}
${(entry.passage || "").trim() ? `Passage:\n${entry.passage.slice(0, 4000)}\n\n` : ""}${hasImage ? "Question: attached as a screenshot image — read the question and all answer choices from it." : `Question: ${(entry.questionText || "").slice(0, 1200)}`}

If this question has MULTIPLE separate blanks, each with its own list of options, return one entry in "blanks" per blank, each with its own "options" array and a short "label" (e.g. "Blank (i)"). Otherwise return exactly one entry with "label" set to an empty string.

For each blank with visible lettered answer choices, transcribe the options in the exact order they appear on screen (first option = A, second = B, and so on) — this order is required for matching against the recorded answer afterward, so do not reorder or omit any.

Also determine "multiSelect": true if this is a checkbox-style "select all that apply" / "indicate all such..." question where the student can check any number of options (not a fixed count), false otherwise (standard single-answer multiple choice, or Sentence Equivalence's fixed pair).

If this is a Quant "numeric entry" question — the student types a number or fraction into a box, with NO listed answer choices at all — do not invent options; return that blank as {"label": "", "options": [], "multiSelect": false}.

Respond with ONLY this JSON — no markdown fences, no preamble or explanation before or after it, and no "correctIndices" or answer-correctness field of any kind:
{"blanks": [{"label": "", "options": ["choice 1", "choice 2", "..."], "multiSelect": false}]}`;

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
      .filter((b) => b && Array.isArray(b.options))
      .map((b) => {
        const isNumeric = b.options.length < 2;
        if (isNumeric) {
          const numericAnswer = (entry.correctAnswer || "").trim();
          if (!numericAnswer) return null;
          return { label: typeof b.label === "string" ? b.label : "", options: [], correctIndices: [], multiSelect: false, numericAnswer, _v: EXTRACTION_VERSION };
        }
        return {
          label: typeof b.label === "string" ? b.label : "",
          options: b.options.map(String),
          correctIndices: [],
          multiSelect: b.multiSelect === true,
          numericAnswer: null,
          _v: EXTRACTION_VERSION,
        };
      })
      .filter(Boolean);
    if (blanks.length === 0) {
      return NextResponse.json({ error: "Options list came back empty" }, { status: 502 });
    }

    // Fill in correctIndices deterministically from the recorded answer —
    // a single recorded string covers every lettered blank in order, so
    // this runs once across all of them, not per-blank.
    const letteredIdxs = blanks.map((b, i) => (b.options.length >= 2 ? i : -1)).filter((i) => i >= 0);
    if (letteredIdxs.length > 0) {
      const resolved = resolveCorrectIndices(entry.correctAnswer, letteredIdxs.map((i) => blanks[i].options));
      letteredIdxs.forEach((bi, k) => { blanks[bi].correctIndices = resolved[k]; });
    }

    return NextResponse.json({ blanks });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}
