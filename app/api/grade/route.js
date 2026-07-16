import { NextResponse } from "next/server";
import { callClaude, extractJSON, TRAP_TAGS } from "@/lib/anthropic";

export async function POST(request) {
  try {
    const { entry, blanks, selections, reasons, rejectionTags, closestTraps, rejectionElaboration, isVerbal, image } = await request.json();
    const hasImage = !!image;

    const blankBlocks = blanks.map((b, bi) => {
      const optionList = b.options.map((o, i) => `${i}: ${o}`).join("\n");
      const sel = selections[bi] || [];
      const tags = rejectionTags[bi] || {};
      const closest = closestTraps[bi] || [];
      const elabs = rejectionElaboration[bi] || {};
      const rejectionBlock = isVerbal
        ? b.options.map((o, i) => {
            if (sel.includes(i)) return null;
            const isClosest = closest.includes(i);
            return `Option ${i} ("${o}") — student tagged this as: "${tags[i] || "(no tag)"}"${isClosest ? ` [flagged as a closest/tempting trap] — elaboration: ${elabs[i] || "(none given)"}` : ""}`;
          }).filter(Boolean).join("\n")
        : "";
      return `${b.label ? `${b.label}:\n` : `Blank ${bi + 1}:\n`}Options:\n${optionList}\nCorrect index/indices: ${JSON.stringify(b.correctIndices)}\nStudent selected: ${JSON.stringify(sel)}\nStudent's stated reason for selecting: ${reasons[bi] || "(none given)"}\n${isVerbal ? `Student's rejection tags/elaboration for the other options:\n${rejectionBlock}` : ""}`;
    }).join("\n\n---\n\n");

    const promptText = `You are grading a GRE practice attempt. Be precise and direct, no praise for its own sake.

Canonical wrong-answer trap categories the student is tagging against: ${TRAP_TAGS.join(", ")}.

Question type: ${entry.section} - ${entry.subtype}
${(entry.passage || "").trim() ? `Passage:\n${entry.passage.slice(0, 4000)}\n\n` : ""}${hasImage ? "Question: see attached screenshot." : `Question: ${(entry.questionText || "").slice(0, 1200)}`}

This question has ${blanks.length} blank${blanks.length > 1 ? "s" : ""}:

${blankBlocks}

For EACH blank:
1. Is the student's selection for that blank exactly correct?
2. Evaluate the QUALITY of their selection reasoning — is it logically sound and specific, or superficial/keyword-matching/lucky? Give one precise, direct correction sentence regardless of whether the answer happened to be right.
${isVerbal ? "3. For EACH rejected option: judge whether the trap TAG accurately describes why that option is wrong; if wrong, give the correct tag from the list above. If flagged as a closest trap with elaboration, judge whether that elaboration is accurate and precise." : ""}

Respond with ONLY this JSON object, no markdown fences:
{"blankResults": [{"blankIndex": 0, "correct": true, "selectionVerdict": "...", "selectionCorrection": "...", "perOption": [{"index": 0, "tagGiven": "...", "tagCorrect": true, "correctTag": "", "elaborationVerdict": "", "correction": "..."}]}]}`;

    const content = hasImage
      ? [{ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } }, { type: "text", text: promptText }]
      : promptText;

    const raw = await callClaude(content, 3600);
    const parsed = extractJSON(raw);
    if (!parsed || !Array.isArray(parsed.blankResults)) {
      return NextResponse.json({ error: `Could not parse grading response (got: "${raw.trim().slice(0, 140)}")` }, { status: 502 });
    }
    const blankResults = parsed.blankResults
      .filter((r) => r && Number.isInteger(r.blankIndex) && typeof r.correct === "boolean")
      .map((r) => ({
        blankIndex: r.blankIndex,
        correct: r.correct,
        selectionVerdict: typeof r.selectionVerdict === "string" ? r.selectionVerdict : "",
        selectionCorrection: typeof r.selectionCorrection === "string" ? r.selectionCorrection : "",
        perOption: Array.isArray(r.perOption) ? r.perOption.filter((p) => p && Number.isInteger(p.index)).map((p) => ({
          index: p.index,
          tagGiven: typeof p.tagGiven === "string" ? p.tagGiven : "",
          tagCorrect: typeof p.tagCorrect === "boolean" ? p.tagCorrect : null,
          correctTag: typeof p.correctTag === "string" ? p.correctTag : "",
          elaborationVerdict: typeof p.elaborationVerdict === "string" ? p.elaborationVerdict : "",
          correction: typeof p.correction === "string" ? p.correction : "",
        })) : [],
      }));
    return NextResponse.json({ answerCorrect: blankResults.length > 0 && blankResults.every((r) => r.correct), blankResults });
  } catch (e) {
    return NextResponse.json({ error: e.message || "unknown error" }, { status: 500 });
  }
}
