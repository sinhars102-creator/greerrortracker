// Shared entry-filtering logic for Review (tier-wise/complete practice) and
// Dashboard (clickable stat tiles that deep-link into a scoped session) —
// both funnel through resolveSource() so a Dashboard click and an in-app
// tier pick behave identically.

export const RECENT_DAYS = 3;

function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Four-tier practice ordering — see the Review-page design conversation for
// the full rationale. No cap: every entry in the section lands in exactly
// one tier.
//   1. recent          — logged today or in the last RECENT_DAYS days, newest first.
//   2. mistakes        — ever gotten wrong (worst offenders first). Permanent
//                         membership: wrongAttempts only ever increments.
//   3. neverAttempted  — logged earlier than the recent window, never attempted.
//   4. rest            — attempted, never gotten wrong (incl. mastered), oldest first.
export function buildTiers(entries) {
  const recentCutoff = daysAgoISO(RECENT_DAYS);
  const recent = [];
  const mistakes = [];
  const neverAttempted = [];
  const rest = [];

  for (const e of entries) {
    const createdDate = (e.createdAt || "").slice(0, 10);
    if (createdDate >= recentCutoff) { recent.push(e); continue; }
    if ((e.wrongAttempts || 0) > 0) { mistakes.push(e); continue; }
    if (!e.totalAttempts) { neverAttempted.push(e); continue; }
    rest.push(e);
  }

  recent.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  mistakes.sort((a, b) => (b.wrongAttempts || 0) - (a.wrongAttempts || 0));
  neverAttempted.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  rest.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  return { recent, mistakes, neverAttempted, rest };
}

export function flattenTiers(tiers) {
  return [...tiers.recent, ...tiers.mistakes, ...tiers.neverAttempted, ...tiers.rest];
}

export function filterLoggedWithinDays(entries, days) {
  const cutoff = daysAgoISO(days);
  return entries
    .filter((e) => (e.createdAt || "").slice(0, 10) >= cutoff)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

// "Not reviewed" = never reviewed at all, or last reviewed before the
// window — never-reviewed entries surface first (most neglected).
export function filterNotReviewedWithinDays(entries, days) {
  const cutoff = daysAgoISO(days);
  return entries
    .filter((e) => !e.lastReviewed || e.lastReviewed < cutoff)
    .sort((a, b) => (a.lastReviewed || "").localeCompare(b.lastReviewed || ""));
}

// Accuracy across a set of entries' review-attempt history so far. Entries
// with zero attempts are excluded from the percentage (nothing to measure
// yet) but reported separately so they don't just vanish from the count.
export function computeAccuracy(entries) {
  let totalAttempts = 0;
  let wrongAttempts = 0;
  let attempted = 0;
  let unattempted = 0;
  for (const e of entries) {
    const t = e.totalAttempts || 0;
    if (t === 0) { unattempted++; continue; }
    attempted++;
    totalAttempts += t;
    wrongAttempts += e.wrongAttempts || 0;
  }
  const correct = totalAttempts - wrongAttempts;
  const pct = totalAttempts > 0 ? Math.round((correct / totalAttempts) * 100) : null;
  return { pct, totalAttempts, correct, attempted, unattempted };
}

// Resolves a "source" descriptor into an ordered list of entries ready to
// practice. `source` is null/undefined for "everything, tiered" (Complete
// Review); otherwise one of:
//   { type: "tier", tier: "recent"|"mistakes"|"neverAttempted"|"rest" }
//   { type: "loggedWindow", days }
//   { type: "staleWindow", days }
export function resolveSource(entriesForSection, source) {
  if (!source || source.type === "all") return flattenTiers(buildTiers(entriesForSection));
  if (source.type === "tier") return buildTiers(entriesForSection)[source.tier] || [];
  if (source.type === "loggedWindow") return filterLoggedWithinDays(entriesForSection, source.days);
  if (source.type === "staleWindow") return filterNotReviewedWithinDays(entriesForSection, source.days);
  return [];
}

export { todayISO };
