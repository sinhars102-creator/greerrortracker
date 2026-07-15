import { NextResponse } from "next/server";
import { callClaude, extractJSON, MISTAKE_TYPES } from "@/lib/anthropic";

export async function POST(request) {
  try {
    const { form, priorEntries, image } = await request.json();
    // form: { section, subtype, questionText, passage, yourAnswer, correctAnswer, notes }
    // priorEntries: [{ id, section, subtype, mistakeTypes, notes }, ...] (compact, for repeat-detection)
    // image: { mediaType, base64 } | null

    const hasImage = !!image;
    const isRC = form.subtype === "Reading Comprehension";
    const needsPassage = isRC && !(form.passage || "").trim();

    const promptText = `You are helping a GRE student analyze their error log.

CATEGORIES (a mistake can belong to more than one): ${MISTAKE_TYPES.join(", ")}

NEW MISTAKE TO CLASSIFY:
Section: ${form.section}
Question type: ${form.subtype}
${(form.passage || "").trim() ? `Passage:\n${form.passage.slice(0, 4000)}\n` : ""}${hasImage ? "Question: attached as a screenshot image — read the question, blanks, and answer choices from it." : `Question: ${(form.questionText || "").slice(0, 800)}`}
Their answer: ${form.yourAnswer || "(not given)"}
Correct answer: ${form.correctAnswer || "(not given)"}
Their explanation of what went wrong: ${form.notes || "(none given)"}

PRIOR LOGGED MISTAKES (for repeat-pattern detection only, JSON array): ${JSON.stringify((priorEntries || []).slice(0, 60))}

TASKS:
1. Assign 1-3 of the categories above that best describe the root cause of this mistake, based mainly on their explanation.
2. Compare the underlying root cause (not just the topic) against the prior mistakes list. Identify IDs of any prior entries that reflect the SAME recurring root cause — not just the same question subtype.
3. Write one short, direct, second-person sentence of diagnostic insight about this specific mistake. No praise, no filler.
${hasImage ? '4. Transcribe the specific question stem, blanks, and answer choices concisely into a "questionText" field.\n' : ""}${needsPassage ? '5. This is a Reading Comprehension question with no passage text given separately — transcribe the ENTIRE reading passage VERBATIM from the screenshot into a "passage" field. If there truly is no passage visible, set "passage" to an empty string.\n' : ""}6. Check: is the root cause that they applied a LITERAL or PRIMARY dictionary meaning of one specific word, when the question actually required a different, valid, SECONDARY or FIGURATIVE meaning of that same word? If yes, extract a "wordTrap" object naming that word, the meaning they applied, and the meaning actually required. Otherwise set "wordTrap" to null.
7. If this is Quant and the root cause is a specific recurring conceptual/formula mistake (not vocabulary-related), extract a "quantTrap" object: {"trapName": short label, "whatHappened": what they did wrong, "correctRule": the correct rule/formula, "checkpoint": one thing to verify next time}. Otherwise set "quantTrap" to null.

Respond with ONLY this JSON object, nothing else, no markdown fences:
{"mistakeTypes": ["..."], "relatedEntryIds": ["..."], "insight": "...", "questionText": ${hasImage ? '"..."' : '""'}, "passage": ${needsPassage ? '"..."' : '""'}, "wordTrap": {"word": "...", "literalMeaning": "...", "actualMeaning": "..."} or null, "quantTrap": {"trapName": "...", "whatHappened": "...", "correctRule": "...", "checkpoint": "..."} or null}`;

    const content = hasImage
      ? [{ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } }, { type: "text", text: promptText }]
      : promptText;

    const raw = await callClaude(content, 2000);
    const parsed = extractJSON(raw);
    if (!parsed || !Array.isArray(parsed.mistakeTypes)) {
      return NextResponse.json({ error: "Could not parse classification response" }, { status: 502 });
    }

    const priorIds = new Set((priorEntries || []).map((e) => e.id));
    const wt = parsed.wordTrap;
    const wordTrap = wt && typeof wt === "object" && wt.word && wt.literalMeaning && wt.actualMeaning
      ? { word: String(wt.word).trim(), literalMeaning: String(wt.literalMeaning).trim(), actualMeaning: String(wt.actualMeaning).trim() }
      : null;
    const qt = parsed.quantTrap;
    const quantTrap = qt && typeof qt === "object" && qt.trapName && qt.whatHappened && qt.correctRule
      ? { trapName: String(qt.trapName).trim(), whatHappened: String(qt.whatHappened).trim(), correctRule: String(qt.correctRule).trim(), checkpoint: String(qt.checkpoint || "").trim() }
      : null;

    return NextResponse.json({
      mistakeTypes: parsed.mistakeTypes.filter((m) => MISTAKE_TYPES.includes(m)).slice(0, 3),
      relatedEntryIds: Array.isArray(parsed.relatedEntryIds) ? parsed.relatedEntryIds.filter((id) => priorIds.has(id)) : [],
      insight: typeof parsed.insight === "string" ? parsed.insight : "",
      questionText: typeof parsed.questionText === "string" ? parsed.questionText : "",
      passage: typeof parsed.passage === "string" ? parsed.passage : "",
      wordTrap,
      quantTrap,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}
