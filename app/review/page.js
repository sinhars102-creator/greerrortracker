"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import QuestionCard from "@/components/QuestionCard";
import { listEntries, updateEntry, groupForSequentialPractice } from "@/lib/entries";
import { buildTiers, flattenTiers, resolveSource, filterMoreThanMistakes, filterLoggedSinceDate, RECENT_DAYS } from "@/lib/practiceFilters";

const MISTAKE_THRESHOLD_OPTIONS = [0, 1, 2, 3, 4, 5, 7, 10];
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
  if (type === "subtype") {
    const subtype = params.get("subtype");
    return subtype ? { type, subtype } : null;
  }
  return null;
}

// In-progress sessions survive a tab close/reload/nav-away — closing mid-way
// through 125 questions and losing the "already answered" set meant they'd
// all resurface next time (no due-date gating to naturally push them out).
function sessionKey(section) { return `review_session_${section}`; }
function loadSavedSession(section) {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(sessionKey(section)));
    return parsed && parsed.source ? parsed : null;
  } catch { return null; }
}
function saveSession(section, source, answeredIds, skippedIds) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(sessionKey(section), JSON.stringify({ source, answeredIds: [...answeredIds], skippedIds: [...skippedIds] }));
  } catch { /* storage full/unavailable — session just won't resume */ }
}
function clearSession(section) {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(sessionKey(section)); } catch {}
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

// The "Logged since" date picker lives on the setup screen, before any
// session has started — remembered separately so picking a date and then
// refreshing (without yet clicking Start) doesn't lose the pick.
function loggedSinceKey(section) { return `review_logged_since_${section}`; }
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

// A Dashboard deep link always wins and starts a fresh session; otherwise
// resume whatever was saved for this section, if anything.
function computeInitialState(searchParams) {
  const section = SECTIONS.includes(searchParams.get("section")) ? searchParams.get("section") : (loadLastSection() || "Verbal");
  const deepLinkSource = parseSourceFromParams(searchParams);
  const saved = deepLinkSource ? null : loadSavedSession(section);
  return {
    section,
    source: deepLinkSource || (saved && saved.source) || null,
    started: !!deepLinkSource || !!saved,
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
  const [mistakeThreshold, setMistakeThreshold] = useState(2);
  const [loggedSinceDate, setLoggedSinceDate] = useState(() => loadLoggedSinceDate(initial.section));
  const dateInputRef = useRef(null);

  const refresh = () => listEntries().then(setEntries);
  useEffect(() => { refresh(); }, []);

  useEffect(() => { saveLastSection(section); }, [section]);
  useEffect(() => { saveLoggedSinceDate(section, loggedSinceDate); }, [section, loggedSinceDate]);

  // Each section remembers its own "logged since" pick — switching sections
  // should load that section's own saved date, not carry over the other's.
  const switchSection = (s) => {
    setSection(s);
    setLoggedSinceDate(loadLoggedSinceDate(s));
  };

  // Persist progress as it happens, so an exit mid-session (tab close,
  // reload, navigating away) can pick back up where it left off.
  useEffect(() => {
    if (!started || !source) return;
    saveSession(section, source, answeredIds, skippedIds);
  }, [section, source, started, answeredIds, skippedIds]);

  const bySection = useMemo(() => (entries || []).filter((e) => e.section === section && !e.pending), [entries, section]);
  // When a "logged since" date is picked, every number in the tier-wise
  // section (tiers, subtype breakdown, mistake-threshold count) scopes down
  // to just entries logged on/after it — same convention as Dashboard's
  // Window selector scoping its stats. Unset (null) means no scoping, the
  // original full pool.
  const scopedBySection = useMemo(
    () => (loggedSinceDate ? filterLoggedSinceDate(bySection, loggedSinceDate) : bySection),
    [bySection, loggedSinceDate]
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
    if (started && entries && !current && skippedIds.size === 0) clearSession(section);
  }, [started, entries, current, skippedIds.size, section]);

  const handleSkip = () => setSkippedIds((prev) => new Set(prev).add(current.id));

  const patchEntry = (id, patch) => {
    updateEntry(id, patch).catch(() => {});
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

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
    await refresh();
  };

  const startWithSource = (src) => {
    setSource(src);
    setSkippedIds(new Set());
    setAnsweredIds(new Set());
    setStarted(true);
  };

  const backToSetup = () => {
    clearSession(section);
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
    return (
      <AppShell>
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
            <div className="pills" style={{ display: "flex", gap: 8 }}>
              {SECTIONS.map((s) => (
                <button key={s} className={"pill" + (s === section ? " active" : "")} onClick={() => { switchSection(s); setMode(null); }}>{s}</button>
              ))}
            </div>
            <div
              onClick={() => { try { dateInputRef.current?.showPicker?.(); } catch { /* unsupported browser — native click still works */ } }}
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--muted)", cursor: "pointer" }}
            >
              <span>Logged since</span>
              <input
                ref={dateInputRef}
                type="date"
                value={loggedSinceDate || ""}
                max={todayISO()}
                onChange={(e) => setLoggedSinceDate(e.target.value || null)}
                onClick={(e) => e.stopPropagation()}
                style={{ width: "auto", cursor: "pointer" }}
              />
              <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: loggedSinceDate ? "var(--amber)" : "var(--muted)" }}>
                {loggedSinceCount}
              </span>
              <button
                className="btn"
                style={{ fontSize: 11.5, padding: "5px 10px" }}
                disabled={!loggedSinceDate}
                onClick={(e) => { e.stopPropagation(); loggedSinceDate && startWithSource({ type: "loggedSince", date: loggedSinceDate }); }}
              >
                Start
              </button>
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
            {skippedIds.size > 0 && <button className="btn btn-primary" onClick={() => setSkippedIds(new Set())}>Go through skipped again</button>}
            <button className="btn" onClick={backToSetup}>Back to setup</button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>{remaining.length} left{skippedIds.size > 0 ? ` · ${skippedIds.size} skipped` : ""}</div>
        <button
          className="btn"
          onClick={backToSetup}
          style={{ fontSize: 13, padding: "8px 16px", color: "var(--red)", borderColor: "var(--red)", fontWeight: 600 }}
        >
          Exit session
        </button>
      </div>
      <QuestionCard
        key={current.id}
        entry={current}
        onBlanksExtracted={(blanks) => patchEntry(current.id, { blanks })}
        onSolutionExtracted={(solution) => patchEntry(current.id, { solution })}
        onEdited={(patch) => patchEntry(current.id, patch)}
        onFinish={handleFinish}
        onSkip={handleSkip}
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
