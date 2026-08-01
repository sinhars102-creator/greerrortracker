import { NextResponse } from "next/server";
import { callClaude, extractJSON } from "@/lib/anthropic";

export async function POST(request) {
  try {
    const { word, meaning, userAnswer, clarification, fastMode } = await request.json();

    // Shown on every verdict regardless of correct/partial/incorrect — 3-4
    // example sentences plus a note on the specific contexts where this
    // exact word is the sharpest, most common choice versus near-synonyms.
    const usageFields = `"examples":["one natural sentence using the word correctly","a second, different sentence","a third, different sentence","optionally a fourth"],"usageNote":"1-2 sentences on the specific situations where this exact word is the most precise and common choice, contrasted with close synonyms"`;

    let prompt;
    if (!clarification) {
      const clarifyOption = fastMode
        ? `If the answer is ambiguous, make your best judgment call anyway — do not ask for clarification.`
        : `If the answer is too short, vague, or ambiguous for you to confidently judge either way, don't guess — instead ask them to use the word correctly in a sentence, tailored to what specifically is unclear about their answer.`;
      const responseFormat = fastMode
        ? `Respond with ONLY valid JSON, no markdown fences, no preamble: {"decision":"verdict","verdict":"correct"|"partial"|"incorrect","feedback":"one short sentence, max 15 words","hook":"a sticky memory aid if verdict is partial or incorrect, else empty string",${usageFields}}`
        : `Respond with ONLY valid JSON, no markdown fences, no preamble. Either:\n{"decision":"verdict","verdict":"correct"|"partial"|"incorrect","feedback":"one short sentence, max 15 words","hook":"a sticky memory aid if verdict is partial or incorrect, else empty string",${usageFields}}\nor:\n{"decision":"clarify","question":"a short, specific request to use the word in a sentence"}`;
      prompt = `Word: "${word}"\nCorrect definition: "${meaning}"\nUser's stated meaning: "${userAnswer}"\n\nJudge the core idea, not exact wording. Accept paraphrases and informal phrasing. Only use "partial" when something essential is missing or reversed, not for wording differences.\n\n${clarifyOption}\n\n${responseFormat}`;
    } else {
      prompt = `Word: "${word}"\nCorrect definition: "${meaning}"\nUser's first answer: "${userAnswer}"\nTheir sentence using it: "${clarification}"\n\nBased on both, judge the core idea, not exact wording. Only use "partial" when something essential is missing or reversed. Give a verdict now.\n\nRespond with ONLY valid JSON, no markdown fences, no preamble: {"decision":"verdict","verdict":"correct"|"partial"|"incorrect","feedback":"one short sentence, max 15 words","hook":"a sticky memory aid if verdict is partial or incorrect, else empty string",${usageFields}}`;
    }

    const raw = await callClaude(prompt, 700);
    const parsed = extractJSON(raw);
    if (!parsed || !parsed.decision) {
      return NextResponse.json({ error: "Could not parse grading response" }, { status: 502 });
    }

    if (parsed.decision === "clarify") {
      if (typeof parsed.question !== "string" || !parsed.question.trim()) {
        return NextResponse.json({ error: "Malformed clarify response" }, { status: 502 });
      }
      return NextResponse.json({ decision: "clarify", question: parsed.question });
    }

    const verdict = ["correct", "partial", "incorrect"].includes(parsed.verdict) ? parsed.verdict : "incorrect";
    const examples = Array.isArray(parsed.examples)
      ? parsed.examples.filter((s) => typeof s === "string" && s.trim()).slice(0, 4)
      : [];
    return NextResponse.json({
      decision: "verdict",
      verdict,
      feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
      hook: typeof parsed.hook === "string" ? parsed.hook : "",
      examples,
      usageNote: typeof parsed.usageNote === "string" ? parsed.usageNote : "",
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}
