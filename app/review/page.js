"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import QuestionCard from "@/components/QuestionCard";
import { listEntries, updateEntry, groupForSequentialPractice, getScreenshotUrlCached } from "@/lib/entries";
import { buildTiers, flattenTiers, resolveSource, filterMoreThanMistakes, filterPriorityMix, filterDateRange, RECENT_DAYS } from "@/lib/practiceFilters";
import { blanksAreUsable } from "@/lib/extractionVersion";

const MISTAKE_THRESHOLD_OPTIONS = [0, 1, 2, 3, 4, 5, 7, 10];
const PRIORITY_MIX_COUNT_OPTIONS = [10, 20, 30, 40, 50, 75, 100];
const VERBAL_BREAKDOWN_SUBTYPES = ["Reading Comprehension", "Text Completion", "Sentence Equivalence", "Vocabulary"];

const INTERVALS = [1, 3, 7, 14, 30];
const SECTIONS = ["Verbal", "Quant"];
const TIER_INFO = [
  { key: "starred", label: "★ Starred (important)" },
  { key: "mistakes", label: "Mistakes" },
  { key: "recent", label: `Recent (last ${RECENT_DAYS} days)` },
  { key: "neverAttempted", label: "Never attempted" },
  { key: "rest", label: "Rest (oldest first)" },
];

function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Reads a Dashboard deep-link, e.g. /review?section=Quant&source=staleWindow&days=5
function parseSourceFromParams(params) {
  const type = params.get("source");
  if (!type || type === "all") return type === "all" ? { type: "all" } : null;
  if (type === "tier") {
    const tier = params.get("tier");
    if (!TIER_INFO.some((t) => t.key === tier)) return null;
    return { type: "tier", tier, unattemptedOnly: params.get("unattempted") === "1" };
  }
  if (type === "loggedWindow" || type === "staleWindow") {
    const days = parseInt(params.get("days"), 10);
    return { type, days: Number.isFinite(days) && days > 0 ? days : RECENT_DAYS };
  }
  if (type === "moreThanMistakes") {
    const threshold = parseInt(params.get("threshold"), 10);
    return { type, threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 2 };
  }
  if (type === "loggedSince") {
    const date = params.get("date");
    return /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? { type, date } : null;
  }
  if (type === "dateRange") {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = params.get("from");
    const to = params.get("to");
    const validFrom = dateRe.test(from || "") ? from : null;
    const validTo = dateRe.test(to || "") ? to : null;
    return validFrom || validTo ? { type, from: validFrom, to: validTo } : null;
  }
  if (type === "subtype") {
    const subtype = params.get("subtype");
    return subtype ? { type, subtype } : null;
  }
  return null;
}

// In-progress sessions survive a tab close/reload/nav-away — closing mid-way
// through 125 questions and losing the "already answered" set meant they'd
// all resurface next time (no due-date gating to naturally push them out).
//
// Keyed by (section, source) rather than just section, so pausing a
// Mistakes session and then starting a Recent one keeps BOTH resumable
// independently instead of the second overwriting the first. A separate
// "active" pointer per section tracks which one (if any) is the currently
// live session, so a plain refresh mid-review still resumes that exact one
// with no picking required — the multi-session list is only for sessions
// you've explicitly paused.
function sessionPrefix(section) { return `review_session::${section}::`; }
function sessionKeyFor(section, source) { return sessionPrefix(section) + JSON.stringify(source); }

function loadSessionFor(section, source) {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(sessionKeyFor(section, source)));
    return parsed && parsed.source ? parsed : null;
  } catch { return null; }
}
function saveSessionFor(section, source, answeredIds, skippedIds) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(sessionKeyFor(section, source), JSON.stringify({ source, answeredIds: [...answeredIds], skippedIds: [...skippedIds] }));
  } catch { /* storage full/unavailable — session just won't resume */ }
}
function clearSessionKey(key) {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(key); } catch {}
}

// Every paused (or live) session stored for this section, for the setup
// screen's "resume one of these" list.
function listSessionsFor(section) {
  if (typeof window === "undefined") return [];
  const prefix = sessionPrefix(section);
  const results = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key));
        if (parsed && parsed.source) results.push({ key, ...parsed });
      } catch { /* corrupted entry — skip it */ }
    }
  } catch { return []; }
  return results;
}

function activeKey(section) { return `review_active_${section}`; }
function loadActiveSource(section) {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(activeKey(section));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveActiveSource(section, source) {
  if (typeof window === "undefined") return;
  try {
    if (source) localStorage.setItem(activeKey(section), JSON.stringify(source));
    else localStorage.removeItem(activeKey(section));
  } catch {}
}

// Human-readable label for a paused session's source, for the resume list.
function describeSource(source) {
  if (!source || source.type === "all") return "Complete Review";
  if (source.type === "tier") {
    const info = TIER_INFO.find((t) => t.key === source.tier);
    return (info ? info.label : source.tier) + (source.unattemptedOnly ? " — not attempted" : "");
  }
  if (source.type === "loggedWindow") return `Logged in the last ${source.days} day${source.days === 1 ? "" : "s"}`;
  if (source.type === "staleWindow") return `Not reviewed in the last ${source.days} day${source.days === 1 ? "" : "s"}`;
  if (source.type === "moreThanMistakes") return `Mistaken more than ${source.threshold} time${source.threshold === 1 ? "" : "s"}`;
  if (source.type === "subtype") return source.subtype;
  if (source.type === "loggedSince") return `Logged since ${source.date}`;
  if (source.type === "priorityMix") return `Priority set (${source.limit})`;
  if (source.type === "dateRange") {
    if (source.from && source.to) return `Logged ${source.from} to ${source.to}`;
    if (source.from) return `Logged from ${source.from}`;
    if (source.to) return `Logged up to ${source.to}`;
    return "Review session";
  }
  return "Review session";
}

// Without a ?section= URL param (a plain refresh, or just navigating to
// /review from a nav link), the section always used to default to
// "Verbal" before ever checking localStorage — so a Quant session in
// progress looked up the wrong storage key and appeared lost even though
// it was sitting there correctly. Remembering the last-used section fixes
// resuming any in-progress session regardless of which section it's in.
function lastSectionKey() { return "review_last_section"; }
function loadLastSection() {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(lastSectionKey());
    return SECTIONS.includes(v) ? v : null;
  } catch { return null; }
}
function saveLastSection(section) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(lastSectionKey(), section); } catch {}
}

// The "Logged between" From/To date pickers live on the setup screen,
// before any session has started — remembered separately so picking a date
// and then refreshing (without yet clicking Start) doesn't lose the pick.
function loggedSinceKey(section) { return `review_logged_since_${section}`; }
function loggedToKey(section) { return `review_logged_to_${section}`; }
function loadLoggedSinceDate(section) {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(loggedSinceKey(section)) || null; } catch { return null; }
}
function saveLoggedSinceDate(section, date) {
  if (typeof window === "undefined") return;
  try {
    if (date) localStorage.setItem(loggedSinceKey(section), date);
    else localStorage.removeItem(loggedSinceKey(section));
  } catch { /* storage full/unavailable — pick just won't be remembered */ }
}
function loadLoggedToDate(section) {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(loggedToKey(section)) || null; } catch { return null; }
}
function saveLoggedToDate(section, date) {
  if (typeof window === "undefined") return;
  try {
    if (date) localStorage.setItem(loggedToKey(section), date);
    else localStorage.removeItem(loggedToKey(section));
  } catch { /* storage full/unavailable — pick just won't be remembered */ }
}

// A Dashboard deep link always wins and starts a fresh session. Otherwise,
// only the section's "active" (currently-live, not explicitly paused)
// session auto-resumes — this is what makes a plain refresh mid-review
// seamless without picking anything. Any other paused sessions for this
// section stay in storage and show up as a resume list on the setup screen
// instead of fighting to be "the" one that auto-loads.
function computeInitialState(searchParams) {
  const section = SECTIONS.includes(searchParams.get("section")) ? searchParams.get("section") : (loadLastSection() || "Verbal");
  const deepLinkSource = parseSourceFromParams(searchParams);
  if (deepLinkSource) {
    return { section, source: deepLinkSource, started: true, answeredIds: new Set(), skippedIds: new Set() };
  }
  const activeSource = loadActiveSource(section);
  const saved = activeSource ? loadSessionFor(section, activeSource) : null;
  return {
    section,
    source: saved ? saved.source : null,
    started: !!saved,
    answeredIds: new Set(saved ? saved.answeredIds : []),
    skippedIds: new Set(saved ? saved.skippedIds : []),
  };
}

function ReviewPageInner() {
  const searchParams = useSearchParams();
  const [entries, setEntries] = useState(null);
  const [initial] = useState(() => computeInitialState(searchParams));
  const [section, setSection] = useState(initial.section);
  const [mode, setMode] = useState(null); // null | "tierwise" — only used for the setup UI, not deep links
  const [source, setSource] = useState(initial.source);
  const [started, setStarted] = useState(initial.started);
  const [skippedIds, setSkippedIds] = useState(initial.skippedIds);
  const [answeredIds, setAnsweredIds] = useState(initial.answeredIds);
  // Ordered history of entry ids that have left `remaining` this session
  // (answered or skipped), oldest first — powers the "Previous" button.
  // Session-only, not persisted across pause/resume/refresh.
  const [passedIds, setPassedIds] = useState([]);
  // 0 = viewing the live front of the queue. N>0 = looking back N steps
  // into passedIds instead.
  const [backSteps, setBackSteps] = useState(0);
  const [mistakeThreshold, setMistakeThreshold] = useState(2);
  const [priorityMixCount, setPriorityMixCount] = useState(40);
  const [loggedSinceDate, setLoggedSinceDate] = useState(() => loadLoggedSinceDate(initial.section));
  const [loggedToDate, setLoggedToDate] = useState(() => loadLoggedToDate(initial.section));
  const dateInputRef = useRef(null);
  const toDateInputRef = useRef(null);
  // Bumped after an explicit "Discard" so the paused-session banner
  // recomputes — localStorage writes alone don't trigger a re-render.
  const [pausedVersion, setPausedVersion] = useState(0);

  const refresh = () => listEntries().then(setEntries);
  useEffect(() => { refresh(); }, []);

  // Every session paused for this section — the setup screen lists these so
  // any of them can be resumed individually, not just the most recent one.
  const pausedList = useMemo(
    () => (started ? [] : listSessionsFor(section)),
    // pausedVersion isn't read in the body — it's a pure invalidation
    // trigger, bumped after "Discard" so this recomputes even though the
    // underlying localStorage write itself doesn't cause a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [section, started, pausedVersion]
  );

  useEffect(() => { saveLastSection(section); }, [section]);
  useEffect(() => { saveLoggedSinceDate(section, loggedSinceDate); }, [section, loggedSinceDate]);
  useEffect(() => { saveLoggedToDate(section, loggedToDate); }, [section, loggedToDate]);

  // Each section remembers its own "logged between" pick and its own active
  // session — switching sections auto-resumes whatever was LIVE there (not
  // explicitly paused), same as a plain refresh would. Anything explicitly
  // paused shows up in that section's resume list instead.
  const switchSection = (s) => {
    setSection(s);
    setLoggedSinceDate(loadLoggedSinceDate(s));
    setLoggedToDate(loadLoggedToDate(s));
    const activeSource = loadActiveSource(s);
    const saved = activeSource ? loadSessionFor(s, activeSource) : null;
    setSource(saved ? saved.source : null);
    setAnsweredIds(new Set(saved ? saved.answeredIds : []));
    setSkippedIds(new Set(saved ? saved.skippedIds : []));
    setPassedIds([]);
    setBackSteps(0);
    setStarted(!!saved);
    setMode(null);
  };

  // Persist progress as it happens, so an exit mid-session (tab close,
  // reload, navigating away) can pick back up where it left off. Also marks
  // this (section, source) as the section's "active" session, so a plain
  // refresh resumes it directly without needing the resume list.
  useEffect(() => {
    if (!started || !source) return;
    saveSessionFor(section, source, answeredIds, skippedIds);
    saveActiveSource(section, source);
  }, [section, source, started, answeredIds, skippedIds]);

  const bySection = useMemo(() => (entries || []).filter((e) => e.section === section && !e.pending), [entries, section]);
  // When a From and/or To date is picked, every number in the tier-wise
  // section (tiers, subtype breakdown, mistake-threshold count, Priority
  // Set) scopes down to just entries logged in that range — same
  // convention as Dashboard's Window selector scoping its stats. Both
  // unset means no scoping, the original full pool; either bound alone is
  // open-ended on the other side.
  const scopedBySection = useMemo(
    () => (loggedSinceDate || loggedToDate ? filterDateRange(bySection, loggedSinceDate, loggedToDate) : bySection),
    [bySection, loggedSinceDate, loggedToDate]
  );
  const tiers = useMemo(() => buildTiers(scopedBySection), [scopedBySection]);
  const tierAttemptStats = useMemo(() => {
    const stats = {};
    for (const t of TIER_INFO) {
      const items = tiers[t.key];
      const notAttempted = items.filter((e) => !(e.totalAttempts > 0)).length;
      stats[t.key] = { total: items.length, notAttempted, attempted: items.length - notAttempted };
    }
    return stats;
  }, [tiers]);
  const mistakeThresholdCount = useMemo(
    () => filterMoreThanMistakes(scopedBySection, mistakeThreshold).length,
    [scopedBySection, mistakeThreshold]
  );
  const priorityMixCountAvailable = useMemo(
    () => filterPriorityMix(scopedBySection, priorityMixCount).length,
    [scopedBySection, priorityMixCount]
  );
  const loggedSinceCount = scopedBySection.length;
  const verbalSubtypeBreakdown = useMemo(() => {
    if (section !== "Verbal") return [];
    return VERBAL_BREAKDOWN_SUBTYPES.map((subtype) => {
      const items = scopedBySection.filter((e) => e.subtype === subtype);
      return { subtype, logged: items.length, errors: items.filter((e) => (e.wrongAttempts || 0) > 0).length };
    });
  }, [scopedBySection, section]);

  const queue = useMemo(() => {
    if (!entries) return [];
    // scopedBySection (not the raw bySection) so what actually gets
    // practiced matches whatever the setup screen displayed as the count —
    // if "logged since" narrowed the pool, starting a session honors that.
    const ordered = resolveSource(scopedBySection, source);
    // Keep Reading Comprehension batches adjacent and in sequence, rather
    // than scattered wherever they land in the tiered/filtered order.
    return groupForSequentialPractice(ordered).flat();
  }, [entries, scopedBySection, source]);

  // Answering a question doesn't remove it from the underlying pool (there's
  // no due-date gating anymore to naturally push it out), so track what's
  // been answered this session separately and filter it out of `remaining`.
  // Skipped entries stay in the pool but are passed over for the rest of
  // this session.
  const remaining = queue.filter((e) => !answeredIds.has(e.id) && !skippedIds.has(e.id));
  const current = started ? remaining[0] : null;

  // Truly nothing left (not even skipped ones to revisit) — no reason to
  // keep a resumable session around for an empty queue.
  useEffect(() => {
    if (started && entries && !current && skippedIds.size === 0 && source) {
      clearSessionKey(sessionKeyFor(section, source));
      saveActiveSource(section, null);
    }
  }, [started, entries, current, skippedIds.size, section, source]);

  // "Previous" steps back through passedIds instead of the live front of
  // the queue. Looking up by id in `entries` (not `remaining`, which has
  // already filtered it out) — it's still there, just answered/skipped.
  const viewingEntry = backSteps > 0
    ? (entries || []).find((e) => e.id === passedIds[passedIds.length - backSteps]) || current
    : current;
  const canGoBack = backSteps < passedIds.length;
  const handlePrevious = () => { if (canGoBack) setBackSteps((b) => b + 1); };

  const handleSkip = () => {
    setSkippedIds((prev) => new Set(prev).add(current.id));
    setPassedIds((prev) => [...prev, current.id]);
  };

  const patchEntry = (id, patch) => {
    updateEntry(id, patch).catch(() => {});
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  // Prefetch the next several questions' screenshot URLs and, for any
  // whose cached extraction is missing or stale, their answer options —
  // while the current one is still on screen. Review already enforces a
  // minimum reading time per question, so this overlaps real dead time
  // with what would otherwise be a live round-trip (signed-URL fetch, or
  // a full AI extraction call) each time "Next" is clicked, which is what
  // made moving between questions feel slow. Done one at a time (not all
  // at once) so it naturally spreads across the reading window instead of
  // bursting several AI calls simultaneously; each one still lands well
  // before you'd reach it at normal reading pace.
  const PREFETCH_AHEAD = 5;
  const upcoming = remaining.slice(1, 1 + PREFETCH_AHEAD);
  const upcomingKey = upcoming.map((e) => e.id).join(",");
  useEffect(() => {
    if (upcoming.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const entry of upcoming) {
        if (cancelled) return;
        let imageUrl = null;
        if (entry.hasImage && entry.imagePath) {
          imageUrl = await getScreenshotUrlCached(entry.imagePath).catch(() => null);
        }
        if (cancelled || blanksAreUsable(entry.blanks)) continue;
        try {
          const res = await fetch("/api/extract-options", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entry, image: null, imageUrl }),
          });
          if (cancelled || !res.ok) continue;
          const data = await res.json();
          if (data.blanks) patchEntry(entry.id, { blanks: data.blanks });
        } catch {
          // Silent — this is only a warm-up. QuestionCard retries for
          // real (with its own visible loading/error state) once you
          // actually get there.
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcomingKey]);

  const handleFinish = async ({ correct }) => {
    const totalAttempts = (current.totalAttempts || 0) + 1;
    const wrongAttempts = (current.wrongAttempts || 0) + (correct ? 0 : 1);
    const patch = { totalAttempts, wrongAttempts };

    if (correct) {
      const nextCount = current.reviewCount + 1;
      const interval = INTERVALS[Math.min(nextCount - 1, INTERVALS.length - 1)];
      Object.assign(patch, { reviewCount: nextCount, lastReviewed: todayISO(), nextReview: addDays(todayISO(), interval), mastered: nextCount >= INTERVALS.length });
    } else {
      Object.assign(patch, { reviewCount: 0, lastReviewed: todayISO(), nextReview: addDays(todayISO(), 1), mastered: false });
    }

    await updateEntry(current.id, patch);
    setAnsweredIds((prev) => new Set(prev).add(current.id));
    setPassedIds((prev) => [...prev, current.id]);
    await refresh();
  };

  // Re-answering/re-skipping a question you've stepped back to via
  // "Previous" isn't a new attempt — it doesn't touch stats or the live
  // queue, it just steps forward again toward the front.
  const handleViewingFinish = backSteps > 0 ? () => setBackSteps((b) => Math.max(0, b - 1)) : handleFinish;
  const handleViewingSkip = backSteps > 0 ? () => setBackSteps((b) => Math.max(0, b - 1)) : handleSkip;

  // If this exact filter already has a paused session, resume its progress
  // instead of silently wiping it — clicking "Mistakes" again after having
  // paused a Mistakes session should continue it, not restart from zero.
  const startWithSource = (src) => {
    const existing = loadSessionFor(section, src);
    setSource(src);
    setSkippedIds(new Set(existing ? existing.skippedIds : []));
    setAnsweredIds(new Set(existing ? existing.answeredIds : []));
    setPassedIds([]);
    setBackSteps(0);
    setStarted(true);
  };

  // Pauses, doesn't discard — the in-progress session (source/answeredIds/
  // skippedIds) stays saved in localStorage so it can be resumed later from
  // the setup screen's resume list. Clearing the "active" pointer (but not
  // the session data itself) is what stops it from auto-resuming on a
  // future refresh — it becomes just another paused session to pick from.
  const backToSetup = () => {
    saveActiveSource(section, null);
    setStarted(false);
    setSource(null);
    setMode(null);
  };

  if (!entries) return <AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>;

  if (bySection.length === 0 && !started) {
    return (
      <AppShell>
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 16, marginBottom: 8, color: "var(--sage)" }}>Nothing logged in {section} yet.</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20 }}>Log a few mistakes first, or switch section.</div>
          <div className="pills" style={{ display: "inline-flex", gap: 8 }}>
            {SECTIONS.map((s) => (
              <button key={s} className={"pill" + (s === section ? " active" : "")} onClick={() => switchSection(s)}>{s}</button>
            ))}
          </div>
        </div>
      </AppShell>
    );
  }

  if (!started) {
    const resumeSession = (saved) => {
      setSource(saved.source);
      setAnsweredIds(new Set(saved.answeredIds));
      setSkippedIds(new Set(saved.skippedIds));
      setPassedIds([]);
      setBackSteps(0);
      setStarted(true);
    };
    const discardPaused = (key) => {
      clearSessionKey(key);
      setPausedVersion((v) => v + 1);
    };
    return (
      <AppShell>
        {pausedList.length > 0 && (
          <div className="card" style={{ padding: 16, marginBottom: 16, border: "1px solid var(--amber)" }}>
            <div style={{ fontSize: 11, color: "var(--amber)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>
              Paused {section} session{pausedList.length === 1 ? "" : "s"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {pausedList.map((p) => (
                <div key={p.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ fontSize: 13 }}>
                    {describeSource(p.source)} — {p.answeredIds.length} answered
                    {p.skippedIds.length > 0 ? `, ${p.skippedIds.length} skipped` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" style={{ fontSize: 12, padding: "6px 12px", color: "var(--red)" }} onClick={() => discardPaused(p.key)}>
                      Discard
                    </button>
                    <button className="btn btn-primary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => resumeSession(p)}>
                      Resume
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
            <div className="pills" style={{ display: "flex", gap: 8 }}>
              {SECTIONS.map((s) => (
                <button key={s} className={"pill" + (s === section ? " active" : "")} onClick={() => { switchSection(s); setMode(null); }}>{s}</button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--muted)", flexWrap: "wrap" }}>
              <span>Logged</span>
              <div
                onClick={() => { try { dateInputRef.current?.showPicker?.(); } catch { /* unsupported browser — native click still works */ } }}
                style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
              >
                <span>from</span>
                <input
                  ref={dateInputRef}
                  type="date"
                  value={loggedSinceDate || ""}
                  max={loggedToDate || todayISO()}
                  onChange={(e) => setLoggedSinceDate(e.target.value || null)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: "auto", cursor: "pointer" }}
                />
              </div>
              <div
                onClick={() => { try { toDateInputRef.current?.showPicker?.(); } catch { /* unsupported browser — native click still works */ } }}
                style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
              >
                <span>to</span>
                <input
                  ref={toDateInputRef}
                  type="date"
                  value={loggedToDate || ""}
                  min={loggedSinceDate || undefined}
                  max={todayISO()}
                  onChange={(e) => setLoggedToDate(e.target.value || null)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: "auto", cursor: "pointer" }}
                />
              </div>
              <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: (loggedSinceDate || loggedToDate) ? "var(--amber)" : "var(--muted)" }}>
                {loggedSinceCount}
              </span>
              <button
                className="btn"
                style={{ fontSize: 11.5, padding: "5px 10px" }}
                disabled={!loggedSinceDate && !loggedToDate}
                onClick={() => (loggedSinceDate || loggedToDate) && startWithSource({ type: "dateRange", from: loggedSinceDate || null, to: loggedToDate || null })}
              >
                Start
              </button>
              {(loggedSinceDate || loggedToDate) && (
                <button
                  className="btn"
                  style={{ fontSize: 11.5, padding: "5px 10px" }}
                  onClick={() => { setLoggedSinceDate(null); setLoggedToDate(null); }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {section === "Verbal" && (
            <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
              {verbalSubtypeBreakdown.map((s) => (
                <button
                  key={s.subtype}
                  className="card"
                  disabled={!s.logged}
                  onClick={() => s.logged && startWithSource({ type: "subtype", subtype: s.subtype })}
                  style={{
                    padding: "16px 18px", border: "1px solid var(--border)", borderLeft: "3px solid var(--verbal)", flex: "1 1 200px",
                    textAlign: "left", cursor: s.logged ? "pointer" : "default", opacity: s.logged ? 1 : 0.5,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--verbal)", marginBottom: 10 }}>{s.subtype}</div>
                  <div style={{ display: "flex", gap: 20 }}>
                    <div>
                      <div className="mono" style={{ fontSize: 26, fontWeight: 700 }}>{s.logged}</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>logged</div>
                    </div>
                    <div>
                      <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: s.errors ? "var(--red)" : "var(--muted)" }}>{s.errors}</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>errors</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {mode === null && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <button
                className="card"
                style={{ padding: 18, textAlign: "left", cursor: "pointer", border: "1px solid var(--border)", width: "100%" }}
                onClick={() => startWithSource({ type: "all" })}
              >
                <div className="serif" style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Complete Review</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  {flattenTiers(tiers).length} to practice — recent + mistakes first, then the rest oldest-first. No cap.
                </div>
              </button>
              <button
                className="card"
                style={{ padding: 18, textAlign: "left", cursor: "pointer", border: "1px solid var(--border)", width: "100%" }}
                onClick={() => setMode("tierwise")}
              >
                <div className="serif" style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Tier-wise Review</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>Pick exactly one tier to practice today.</div>
              </button>
              <div className="card" style={{ padding: 18, border: "1px solid var(--border)" }}>
                <div className="serif" style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Priority Set</div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
                  Wrong ones first (worst offenders first), then the rest newest-logged first.
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <select
                    value={priorityMixCount}
                    onChange={(e) => setPriorityMixCount(parseInt(e.target.value, 10))}
                    style={{ width: "auto" }}
                  >
                    {PRIORITY_MIX_COUNT_OPTIONS.map((n) => <option key={n} value={n}>{n} questions</option>)}
                  </select>
                  <span className="mono" style={{ fontSize: 14, color: "var(--muted)", marginLeft: "auto" }}>
                    {priorityMixCountAvailable} available
                  </span>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ width: "100%", marginTop: 12 }}
                  disabled={!priorityMixCountAvailable}
                  onClick={() => priorityMixCountAvailable && startWithSource({ type: "priorityMix", limit: priorityMixCount })}
                >
                  Start ({priorityMixCountAvailable})
                </button>
              </div>
            </div>
          )}

          {mode === "tierwise" && (
            <div>
              <button className="btn" onClick={() => setMode(null)} style={{ marginBottom: 14, fontSize: 12 }}>← Back</button>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {TIER_INFO.map((t) => {
                  const stat = tierAttemptStats[t.key];
                  const count = stat.total;
                  return (
                    <div key={t.key} className="card" style={{ padding: 16, border: "1px solid var(--border)", opacity: count ? 1 : 0.5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: 14 }}>{t.label}</span>
                        <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: count ? "var(--amber)" : "var(--muted)" }}>{count}</span>
                      </div>
                      {count > 0 && (
                        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 10 }}>
                          {stat.attempted} attempted · {stat.notAttempted} not attempted
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="btn"
                          style={{ fontSize: 12, padding: "6px 10px" }}
                          disabled={!stat.notAttempted}
                          onClick={() => startWithSource({ type: "tier", tier: t.key, unattemptedOnly: true })}
                        >
                          Practice not attempted ({stat.notAttempted})
                        </button>
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: 12, padding: "6px 10px" }}
                          disabled={!count}
                          onClick={() => startWithSource({ type: "tier", tier: t.key })}
                        >
                          Practice all ({count})
                        </button>
                      </div>
                    </div>
                  );
                })}
                <div className="card" style={{ padding: 16, border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10 }}>
                    <span style={{ fontSize: 14 }}>Mistaken more than</span>
                    <select
                      value={mistakeThreshold}
                      onChange={(e) => setMistakeThreshold(parseInt(e.target.value, 10))}
                      style={{ width: "auto" }}
                    >
                      {MISTAKE_THRESHOLD_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <span style={{ fontSize: 14 }}>time{mistakeThreshold === 1 ? "" : "s"}</span>
                    <span className="mono" style={{ fontSize: 18, fontWeight: 700, marginLeft: "auto", color: mistakeThresholdCount ? "var(--amber)" : "var(--muted)" }}>
                      {mistakeThresholdCount}
                    </span>
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ width: "100%" }}
                    disabled={!mistakeThresholdCount}
                    onClick={() => mistakeThresholdCount && startWithSource({ type: "moreThanMistakes", threshold: mistakeThreshold })}
                  >
                    Start
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  if (!current) {
    return (
      <AppShell>
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>{skippedIds.size > 0 ? "Skipped everything left in this session." : "Session complete."}</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 18 }}>{answeredIds.size} answered{skippedIds.size > 0 ? ` · ${skippedIds.size} skipped` : ""} this session.</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            {skippedIds.size > 0 && (
              <button
                className="btn btn-primary"
                onClick={() => { setSkippedIds(new Set()); setPassedIds([]); setBackSteps(0); }}
              >
                Go through skipped again
              </button>
            )}
            <button className="btn" onClick={backToSetup}>Back to setup</button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{remaining.length} left{skippedIds.size > 0 ? ` · ${skippedIds.size} skipped` : ""}</div>
          <button
            className="btn"
            onClick={handlePrevious}
            disabled={!canGoBack}
            style={{ fontSize: 13, padding: "6px 12px" }}
          >
            ← Previous
          </button>
        </div>
        <button
          className="btn"
          onClick={backToSetup}
          title="Your progress is saved — pick this section back up any time"
          style={{ fontSize: 13, padding: "8px 16px", color: "var(--amber)", borderColor: "var(--amber)", fontWeight: 600 }}
        >
          Pause session
        </button>
      </div>
      {backSteps > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--amber)", marginBottom: 10 }}>
          Reviewing a previous question — checking or skipping here does not count as a new attempt, it just moves back toward where you left off.
        </div>
      )}
      <QuestionCard
        key={viewingEntry.id}
        entry={viewingEntry}
        onBlanksExtracted={(blanks) => patchEntry(viewingEntry.id, { blanks })}
        onSolutionExtracted={(solution) => patchEntry(viewingEntry.id, { solution })}
        onEdited={(patch) => patchEntry(viewingEntry.id, patch)}
        onFinish={handleViewingFinish}
        onSkip={handleViewingSkip}
        minAnswerSeconds={backSteps > 0 ? 0 : 25}
      />
    </AppShell>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>}>
      <ReviewPageInner />
    </Suspense>
  );
}
