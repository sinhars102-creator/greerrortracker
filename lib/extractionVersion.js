// Shared between app/api/extract-options/route.js (server) and
// components/QuestionCard.js (client) — bump whenever the extraction
// prompt's grading logic changes meaningfully. blanksAreUsable() rejects
// any cached blanks stamped with an older version, so a prompt fix quietly
// self-heals every previously-wrong cached extraction the next time each
// question comes up in Review, instead of leaving stale bad grading stuck
// forever.
export const EXTRACTION_VERSION = 8;

// Also used by app/review/page.js's prefetcher to decide whether the next
// question in the queue needs a fresh extraction warmed in the background
// — same check QuestionCard itself uses, kept in one place so they can't
// drift out of sync.
export function blanksAreUsable(blanks) {
  return Array.isArray(blanks) && blanks.length > 0 && blanks.every((b) => (
    b._v === EXTRACTION_VERSION
    && ((Array.isArray(b.options) && b.options.length >= 2) || (typeof b.numericAnswer === "string" && b.numericAnswer.trim()))
  ));
}
