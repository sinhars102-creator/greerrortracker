import { NextResponse } from "next/server";
import { callClaude, extractJSON } from "@/lib/anthropic";

export const maxDuration = 45;

export async function POST(request) {
  try {
    const { taskType, prompt: essayPrompt, essayText } = await request.json();
    if (!essayPrompt || typeof essayPrompt !== "string" || !essayPrompt.trim()) {
      return NextResponse.json({ error: "Missing the GRE prompt" }, { status: 400 });
    }
    if (!essayText || typeof essayText !== "string" || !essayText.trim()) {
      return NextResponse.json({ error: "Essay is empty" }, { status: 400 });
    }

    const isArgument = taskType === "Argument";
    const rubric = isArgument
      ? `This is a GRE Analytical Writing "Analyze an Argument" task. Score based on how well the response identifies and analyzes the argument's actual logical flaws, unstated assumptions, and questionable reasoning (not whether the writer agrees or disagrees with the argument's conclusion), the organization and development of that critique, relevant support for each point, control of standard written English, and syntactic variety.`
      : `This is a GRE Analytical Writing "Analyze an Issue" task. Score based on the quality and clarity of the writer's position and reasoning, the organization and development of ideas, use of relevant reasons and examples, control of standard written English, and syntactic variety.`;

    const gradingPrompt = `You are an official GRE Analytical Writing rater. ${rubric}

Score strictly on the real GRE 0-6 scale in 0.5-point increments (0, 0.5, 1, 1.5, ... 6), applying official ETS scoring-guide standards. Most competent essays score in the 3.5-4.5 range — do not grade generously. Only score 0 if the response is blank, entirely off-topic, or not in English.

GRE prompt given to the writer:
"""
${essayPrompt.trim()}
"""

Writer's essay:
"""
${essayText.trim()}
"""

Also do a copy-editing pass: find the specific grammar, sentence-structure, agreement, or usage mistakes actually present in the essay (not style preferences, not the content/argument itself — pure mechanics and sentence construction). For each one, "quote" MUST be copied EXACTLY, character-for-character, from the essay above (same spelling, punctuation, and capitalization) so it can be located automatically — never paraphrase or summarize the quote. Keep each quote short (a phrase or clause, not a whole sentence) and precisely bounded around the actual error. If the essay has no real grammar/structure mistakes, return an empty array — do not invent issues to fill it.

Respond with ONLY valid JSON, no markdown fences, no preamble:
{
  "score": 4.5,
  "scoreSummary": "one sentence overall verdict, naming the score band",
  "feedback": "3-5 sentences of specific, actionable feedback that references actual content or wording from this essay — not generic writing advice",
  "structure": {
    "thesis": "a strong one-sentence position/thesis tailored to this exact prompt",
    "boxes": [
      { "role": "Introduction", "content": "short, concrete note on what to say here for this prompt" },
      { "role": "Body Paragraph 1", "content": "..." },
      { "role": "Body Paragraph 2", "content": "..." },
      { "role": "Conclusion", "content": "..." }
    ]
  },
  "issues": [
    { "quote": "exact substring copied from the essay", "issue": "short description of the grammar/sentence-structure problem", "suggestion": "the corrected version of that phrase" }
  ]
}
Use 4 to 6 total boxes in "boxes" (always including Introduction and Conclusion), each tailored specifically to this prompt so it works as a rewrite outline — not generic essay-structure advice. Use up to 10 "issues", ordered by how much they hurt the writing.`;

    const raw = await callClaude(gradingPrompt, 3000);
    const parsed = extractJSON(raw);
    if (!parsed || typeof parsed.score !== "number") {
      return NextResponse.json({ error: "Could not parse grading response" }, { status: 502 });
    }

    const score = Math.max(0, Math.min(6, Math.round(parsed.score * 2) / 2));
    const boxes = Array.isArray(parsed.structure?.boxes)
      ? parsed.structure.boxes
          .filter((b) => b && typeof b.role === "string" && typeof b.content === "string" && b.role.trim() && b.content.trim())
          .slice(0, 8)
          .map((b) => ({ role: b.role.trim(), content: b.content.trim() }))
      : [];
    // Only keep issues whose quote is actually findable in the submitted
    // text — an un-locatable quote can't be highlighted and would just be
    // a confusing, unverifiable claim.
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues
          .filter((i) => i && typeof i.quote === "string" && i.quote.trim() && essayText.includes(i.quote))
          .slice(0, 10)
          .map((i) => ({
            quote: i.quote,
            issue: typeof i.issue === "string" ? i.issue : "",
            suggestion: typeof i.suggestion === "string" ? i.suggestion : "",
          }))
      : [];

    return NextResponse.json({
      score,
      scoreSummary: typeof parsed.scoreSummary === "string" ? parsed.scoreSummary : "",
      feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
      structure: {
        thesis: typeof parsed.structure?.thesis === "string" ? parsed.structure.thesis : "",
        boxes,
        issues,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}
