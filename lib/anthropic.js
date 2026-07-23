// Server-side only. Never import this from a Client Component — it reads
// process.env.ANTHROPIC_API_KEY, which must stay off the client bundle.

import { createClient } from "@supabase/supabase-js";
import { callGemini } from "@/lib/gemini";
import { callGroq } from "@/lib/groq";
import { callOpenAI } from "@/lib/openai";

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

// Groq has no vision-capable model on a standard key — routing an
// image/document call there would just fail. Rather than let picking Groq
// in the header switch silently break screenshot transcription, non-text
// content always falls back to Anthropic regardless of the switch.
function hasNonTextContent(content) {
  return Array.isArray(content) && content.some((block) => block.type !== "text");
}

// OpenAI's chat/completions API handles images fine (see lib/openai.js) but
// has no native inline-PDF content type, so document calls (PDF import)
// still need to fall back to Anthropic even when OpenAI is selected.
function hasDocumentContent(content) {
  return Array.isArray(content) && content.some((block) => block.type === "document");
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
 * app_settings table) — "anthropic", "gemini", "openai", or "groq" — with
 * the AI_PROVIDER env var as a hard local override for testing. Every caller
 * in this file (and every API route) goes through this one function, so the
 * switch affects the whole app from one place. Groq is text-only (see
 * hasNonTextContent above) — image/document calls stay on Anthropic even
 * when Groq is selected. OpenAI handles images but not documents (see
 * hasDocumentContent above) — PDF import stays on Anthropic even when
 * OpenAI is selected.
 */
export async function callClaude(content, maxTokens = 1200) {
  const provider = await getConfiguredProvider();
  if (provider === "gemini") {
    return callGemini(content, maxTokens);
  }
  if (provider === "openai" && !hasDocumentContent(content)) {
    return callOpenAI(content, maxTokens);
  }
  if (provider === "groq" && !hasNonTextContent(content)) {
    return callGroq(content, maxTokens);
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

/**
 * First pass over a full GRE practice-test PDF: identifies its section
 * structure so the caller can ask "which question numbers from Section N"
 * instead of needing to already know PDF page numbers. One call, cheap
 * relative to the per-question extraction pass.
 */
export async function scanPdfSections({ pdfBase64 }) {
  const promptText = `You are attached a full GRE practice-test PDF (screenshots of an on-screen test).

Scan the ENTIRE document and report every section. Each page prints a header like "Section N of 5 | Question X of Y" (N = the section's absolute position in the document; Y = total questions in that section). An essay/writing section instead shows "Question 1 of 1" with a written-response prompt, not multiple choice.

For each section, report:
- sectionNumber: the absolute N from the header.
- subject: "Quant", "Verbal", or "Essay" (or "Other" if neither fits).
- totalQuestions: the printed Y (0 or 1 for an essay section).
- keyLabel: if the document has a labeled Answer Key at the end (blocks like "1st Quant Section", "2nd (Hard) Verbal Section"), give this section's best-guess matching label by ordering — otherwise "".

Respond with ONLY this JSON object, no markdown fences:
{"sections": [{"sectionNumber": 1, "subject": "Essay", "totalQuestions": 1, "keyLabel": ""}]}`;

  const content = [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
    { type: "text", text: promptText },
  ];

  const raw = await callClaude(content, 2000);
  const parsed = extractJSON(raw);
  if (!parsed || !Array.isArray(parsed.sections)) {
    return { error: `Could not parse scan response (got: "${raw.trim().slice(0, 200)}")` };
  }
  return { sections: parsed.sections };
}

/**
 * Reads specific (section, question number) selections out of a full GRE
 * practice-test PDF and logs them as entries, matched against the answer
 * key printed elsewhere in the same document. See the PDF-import design
 * conversation for the full rationale — summary of what this one call has
 * to do:
 *   - The PDF is sent as a single document content block; Claude reads the
 *     specific pages directly rather than us rasterizing pages ourselves.
 *   - Every GRE PowerPrep-style page prints "Section N of 5 | Question X of Y"
 *     — an absolute section number plus a question number that resets per
 *     section — so page/question identity is unambiguous on its own, and
 *     the caller never needs to know raw PDF page numbers.
 *   - The answer key at the end is split into labeled blocks ("1st Quant
 *     Section", "1st Verbal Section", "2nd (Hard) Quant Section", "2nd
 *     (Hard) Verbal Section") in the same order the sections physically
 *     appear in the document (skipping the essay section, which has no
 *     answer key). Claude has to align "Section N" to the right block itself.
 *   - If a requested question turns out to be part of a Reading
 *     Comprehension set ("Questions 4 and 5 are based on this passage"),
 *     every other question in that set must be included too, even if the
 *     caller didn't ask for it — Claude can look at neighboring pages in the
 *     same attached document to find them.
 */
export async function extractQuestionsFromPdf({ pdfBase64, selections }) {
  const selectionLines = selections
    .map((s) => `Section ${s.sectionNumber}: questions ${s.questionNumbers.join(", ")}`)
    .join("\n");

  const promptText = `You are attached a full GRE practice-test PDF (screenshots of an on-screen test, one page per question, plus an Answer Key on the final page(s)).

I want to log these questions as mistake-tracker entries, identified by their printed "Section N of 5 | Question X of Y" header:
${selectionLines}

For EACH requested (section, question) pair, do the following:
1. Find the page in the document with that exact section number and question number in its header.
2. Determine the section subject ("Quant" or "Verbal") and the specific question subtype from these lists — pick exactly one:
   - Quant subtypes: ${QUANT_SUBTYPES.join(", ")}
   - Verbal subtypes: ${VERBAL_SUBTYPES.join(", ")}
3. If that page's header/banner says something like "Questions 4 and 5 are based on this passage" (i.e. it's a Reading Comprehension set), this question is part of a linked group. Look at the OTHER pages in this same document (in the same section) to find every other question in that same range, even ones not in my requested list, and include ALL of them as their own entries in the output — transcribe the shared passage once and reuse it for each.
4. Transcribe the question stem and all answer options verbatim into "questionText" and an "options" array (in on-screen order, so the first option is "A", second is "B", etc — for checkbox questions the order shown is still A, B, C...). For Reading Comprehension, also fill "passage" with the full passage text verbatim; leave "passage" empty for non-RC questions.
5. Find the Answer Key section (usually the last page(s)). It's split into labeled blocks in the same order the actual sections appear in this document (excluding any essay/writing section, which has no key). Match this question's Section N to the correct labeled block by that ordering, then look up this question's number within that block to get the correct answer letter(s) (e.g. "B" or "B, C").
6. Resolve the letter(s) to the actual option text(s) from the "options" array you transcribed, joined with "; " if more than one. If the question has no lettered options (a numeric fill-in-blank Quant question), the key gives a literal value directly (e.g. "ans is 22") — use that raw value as "answerValue" instead, and leave "answerLetters" as an empty array.
7. If you can't confidently find or match an answer, still include the question with "answerLetters": [] and "answerValue": "", and explain why in "issue".

Respond with ONLY this JSON object, no markdown fences:
{
  "questions": [
    {
      "pdfPage": 0,
      "requested": true,
      "section": "Verbal",
      "subtype": "Sentence Equivalence",
      "sectionNumber": 3,
      "questionNumberInSection": 2,
      "totalInSection": 12,
      "isRC": false,
      "rcQuestionNumbers": [],
      "passage": "",
      "questionText": "...",
      "options": ["...", "..."],
      "answerLetters": ["B", "C"],
      "answerValue": "",
      "issue": ""
    }
  ]
}
"requested" is true only for (section, question) pairs I explicitly listed above; set it to false for any extra Reading Comprehension companion questions you pulled in yourself. "rcQuestionNumbers" should list every question number in the linked set (e.g. [4, 5]) for RC questions, or be empty otherwise. "pdfPage" is whatever physical page number you found it on, for reference.`;

  const content = [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
    { type: "text", text: promptText },
  ];

  const totalQuestions = selections.reduce((sum, s) => sum + s.questionNumbers.length, 0);
  const raw = await callClaude(content, Math.max(4000, totalQuestions * 900));
  const parsed = extractJSON(raw);
  if (!parsed || !Array.isArray(parsed.questions)) {
    return { error: `Could not parse import response (got: "${raw.trim().slice(0, 200)}")` };
  }
  return { questions: parsed.questions };
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
