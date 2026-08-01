// Shared between app/api/extract-options/route.js (server) and
// components/QuestionCard.js (client) — bump whenever the extraction
// prompt's grading logic changes meaningfully. QuestionCard's
// blanksAreUsable() rejects any cached blanks stamped with an older
// version, so a prompt fix quietly self-heals every previously-wrong
// cached extraction the next time each question comes up in Review,
// instead of leaving stale bad grading stuck forever.
export const EXTRACTION_VERSION = 8;
