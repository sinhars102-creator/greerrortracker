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

// wrongAttempts is a lifetime counter that never decreases, so without
// this a question you've actually mastered (passed the full short/medium/
// long retest loop, see app/review/page.js) would keep outranking genuinely
// unresolved mistakes forever in every "worst offenders first" view — new
// mistakes would never work their way to the front. Sorts uncleared (0)
// ahead of cleared (1); used as the primary key everywhere mistakes are
// ranked by severity.
function clearedRank(e) { return e.retestCleared ? 1 : 0; }

// Four-tier practice ordering — see the Review-page design conversation for
// the full rationale.
//   1. mistakes        — ever gotten wrong (worst offenders first). Permanent
//                         membership: wrongAttempts only ever increments.
//   2. recent          — logged today or in the last RECENT_DAYS days,
//                         newest first. Overlaps mistakes on purpose — a
//                         question logged today that's already wrong (e.g.
//                         the extension's "I got this wrong" checkbox,
//                         which counts it as a mistake immediately) should
//                         still show up under Recent, not just Mistakes;
//                         being freshly logged and being a mistake are two
//                         separate true facts about it, not mutually
//                         exclusive tiers.
//   3. neverAttempted  — logged earlier than the recent window, never attempted.
//   4. rest            — attempted, never gotten wrong (incl. mastered), oldest first.
//
// mistakes/neverAttempted/rest stay a strict partition among themselves (no
// entry is ever in more than one), and recent is the only one allowed to
// overlap mistakes. flattenTiers (Complete Review's queue) still needs a
// true one-entry-once ordering though, so it uses the internal
// mistakes-excluded recentExclusive list instead of the exposed, overlapping
// `recent`.
//
// "starred" is a fifth, cross-cutting bucket — every starred entry also
// belongs to exactly one of the four above (starring doesn't remove it from
// its normal tier), so it's additive, not part of the partition.
//
// "starredMistakes" (labeled "Starred + Mistakes + Relook") is a further
// narrowing of "starred": the starred entries worth the most drilling —
// either gotten wrong SINCE being starred (wrongAttemptsAtStar is a
// snapshot taken the moment starring last turned on, see QuestionCard's
// star toggle, so "since starring" = wrongAttempts has grown past that
// snapshot), or manually flagged via the Relook toggle — only shown on
// starred questions (starring already means "come back to this"; relook
// exists to flag which starred ones specifically, and gets cleared
// automatically on unstar). Also cross-cutting/additive, same as
// "starred".
export function buildTiers(entries) {
  const recentCutoff = daysAgoISO(RECENT_DAYS);
  const recentExclusive = [];
  const mistakes = [];
  const neverAttempted = [];
  const rest = [];

  for (const e of entries) {
    const createdDate = (e.createdAt || "").slice(0, 10);
    if ((e.wrongAttempts || 0) > 0) { mistakes.push(e); continue; }
    if (createdDate >= recentCutoff) { recentExclusive.push(e); continue; }
    if (!e.totalAttempts) { neverAttempted.push(e); continue; }
    rest.push(e);
  }

  const recent = entries.filter((e) => (e.createdAt || "").slice(0, 10) >= recentCutoff);

  recent.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  recentExclusive.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  mistakes.sort((a, b) => clearedRank(a) - clearedRank(b) || (b.wrongAttempts || 0) - (a.wrongAttempts || 0));
  neverAttempted.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  rest.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  const starred = entries
    .filter((e) => e.starred)
    .sort((a, b) => (b.wrongAttempts || 0) - (a.wrongAttempts || 0) || (a.createdAt || "").localeCompare(b.createdAt || ""));

  // Ranked by wrong-since-star count first (worst offenders), with
  // relook-only entries (no post-star mistake, just manually flagged)
  // trailing at the back since they carry a delta of 0.
  const starredMistakes = starred
    .filter((e) => (e.wrongAttempts || 0) > (e.wrongAttemptsAtStar ?? 0) || e.relook)
    .sort((a, b) => ((b.wrongAttempts || 0) - (b.wrongAttemptsAtStar ?? 0)) - ((a.wrongAttempts || 0) - (a.wrongAttemptsAtStar ?? 0)));

  return { recent, recentExclusive, mistakes, neverAttempted, rest, starred, starredMistakes };
}

export function flattenTiers(tiers) {
  return [...tiers.mistakes, ...tiers.recentExclusive, ...tiers.neverAttempted, ...tiers.rest];
}

export function filterLoggedWithinDays(entries, days) {
  const cutoff = daysAgoISO(days);
  return entries
    .filter((e) => (e.createdAt || "").slice(0, 10) >= cutoff)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

// Same as filterLoggedWithinDays but pinned to an exact calendar date
// (e.g. "2026-07-15") rather than a relative day count — for "show me
// everything logged since this specific day" instead of "since N days ago".
export function filterLoggedSinceDate(entries, dateISO) {
  return entries
    .filter((e) => (e.createdAt || "").slice(0, 10) >= dateISO)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}

// Both bounds are inclusive calendar dates ("YYYY-MM-DD") and either can be
// omitted for an open-ended range (from-only = "since", to-only =
// "up through", both = a closed window). Oldest-first, same as
// filterLoggedSinceDate — this is its two-sided generalization.
export function filterDateRange(entries, fromDate, toDate) {
  return entries
    .filter((e) => {
      const d = (e.createdAt || "").slice(0, 10);
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    })
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}

// "Reviewed" = actually practiced within the window (lastReviewed set and
// recent) — the direct complement of filterNotReviewedWithinDays. This is
// distinct from filterLoggedWithinDays: a question logged months ago that
// you practiced yesterday shows up here, not there — logging date and
// practice date are unrelated once a question's been sitting around a
// while, and the "Recent" tier only tracks the former.
export function filterReviewedWithinDays(entries, days) {
  const cutoff = daysAgoISO(days);
  return entries
    .filter((e) => e.lastReviewed && e.lastReviewed >= cutoff)
    .sort((a, b) => (b.lastReviewed || "").localeCompare(a.lastReviewed || ""));
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

// Entries mistaken MORE than `threshold` times, worst offenders first. A
// user-configurable sharper cut than the "mistakes" tier (which is any
// entry with wrongAttempts > 0, i.e. threshold 0) — for surfacing only the
// most persistently-wrong questions.
export function filterMoreThanMistakes(entries, threshold) {
  return entries
    .filter((e) => (e.wrongAttempts || 0) > threshold)
    .sort((a, b) => clearedRank(a) - clearedRank(b) || (b.wrongAttempts || 0) - (a.wrongAttempts || 0));
}

// All entries of one subtype (e.g. "Reading Comprehension"), still ordered
// mistakes-first/recent/never-attempted/rest within that subtype — same
// priority logic as Complete Review, just scoped to a single subtype.
export function filterBySubtype(entries, subtype) {
  return flattenTiers(buildTiers(entries.filter((e) => e.subtype === subtype)));
}

// Simpler two-tier alternative to buildTiers' four-way split: everything
// ever gotten wrong first (worst offenders first, same ranking as the
// "mistakes" tier), then everything else newest-logged first — capped to a
// user-chosen count. For "grind through N questions, wrong ones first"
// sessions where the four-tier Complete Review split is more than needed.
//
// Purely wrongAttempts/createdAt ranking is static — nothing about a
// question changes just because you got it right, so starting a fresh
// batch right after finishing one used to hand back the exact same top-N
// every time. Within each bucket, uncleared-and-not-reviewed-today sorts
// first (clearedRank ahead of reviewedToday — a mastered question should
// stay at the back regardless of when it was last touched, while an
// unresolved one just reviewed today should still yield to other
// unresolved ones first), worst-offenders/newest-logged breaking ties —
// so finishing one batch pushes those questions to the back and the next
// batch surfaces something different, until everything's been touched at
// least once today, at which point repeats are expected.
export function filterPriorityMix(entries, limit) {
  const today = todayISO();
  const reviewedToday = (e) => (e.lastReviewed === today ? 1 : 0);
  const mistakes = entries
    .filter((e) => (e.wrongAttempts || 0) > 0)
    .sort((a, b) => clearedRank(a) - clearedRank(b) || reviewedToday(a) - reviewedToday(b) || (b.wrongAttempts || 0) - (a.wrongAttempts || 0));
  const rest = entries
    .filter((e) => !((e.wrongAttempts || 0) > 0))
    .sort((a, b) => reviewedToday(a) - reviewedToday(b) || (b.createdAt || "").localeCompare(a.createdAt || ""));
  const combined = [...mistakes, ...rest];
  return typeof limit === "number" && limit > 0 ? combined.slice(0, limit) : combined;
}

// Resolves a "source" descriptor into an ordered list of entries ready to
// practice. `source` is null/undefined for "everything, tiered" (Complete
// Review); otherwise one of:
//   { type: "tier", tier: "recent"|"mistakes"|"neverAttempted"|"rest", unattemptedOnly? }
//   { type: "loggedWindow", days }
//   { type: "loggedSince", date }
//   { type: "reviewedWindow", days }
//   { type: "staleWindow", days }
//   { type: "moreThanMistakes", threshold }
//   { type: "subtype", subtype }
//   { type: "priorityMix", limit }
//   { type: "dateRange", from?, to? }
export function resolveSource(entriesForSection, source) {
  if (!source || source.type === "all") return flattenTiers(buildTiers(entriesForSection));
  if (source.type === "tier") {
    const items = buildTiers(entriesForSection)[source.tier] || [];
    return source.unattemptedOnly ? items.filter((e) => !(e.totalAttempts > 0)) : items;
  }
  if (source.type === "loggedWindow") return filterLoggedWithinDays(entriesForSection, source.days);
  if (source.type === "loggedSince") return filterLoggedSinceDate(entriesForSection, source.date);
  if (source.type === "reviewedWindow") return filterReviewedWithinDays(entriesForSection, source.days);
  if (source.type === "staleWindow") return filterNotReviewedWithinDays(entriesForSection, source.days);
  if (source.type === "moreThanMistakes") return filterMoreThanMistakes(entriesForSection, source.threshold);
  if (source.type === "subtype") return filterBySubtype(entriesForSection, source.subtype);
  if (source.type === "priorityMix") return filterPriorityMix(entriesForSection, source.limit);
  if (source.type === "dateRange") return filterDateRange(entriesForSection, source.from, source.to);
  return [];
}

export { todayISO };
