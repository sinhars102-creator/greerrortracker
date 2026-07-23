"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import QuestionCard from "@/components/QuestionCard";
import { listEntries, updateEntry, groupForSequentialPractice } from "@/lib/entries";
import { buildTiers, flattenTiers, resolveSource, RECENT_DAYS } from "@/lib/practiceFilters";

const INTERVALS = [1, 3, 7, 14, 30];
const SECTIONS = ["Verbal", "Quant"];
const TIER_INFO = [
  { key: "recent", label: `Recent (last ${RECENT_DAYS} days)` },
  { key: "mistakes", label: "Mistakes" },
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
    return TIER_INFO.some((t) => t.key === tier) ? { type: "tier", tier } : null;
  }
  if (type === "loggedWindow" || type === "staleWindow") {
    const days = parseInt(params.get("days"), 10);
    return { type, days: Number.isFinite(days) && days > 0 ? days : RECENT_DAYS };
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

// A Dashboard deep link always wins and starts a fresh session; otherwise
// resume whatever was saved for this section, if anything.
function computeInitialState(searchParams) {
  const section = SECTIONS.includes(searchParams.get("section")) ? searchParams.get("section") : "Verbal";
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

  const refresh = () => listEntries().then(setEntries);
  useEffect(() => { refresh(); }, []);

  // Persist progress as it happens, so an exit mid-session (tab close,
  // reload, navigating away) can pick back up where it left off.
  useEffect(() => {
    if (!started || !source) return;
    saveSession(section, source, answeredIds, skippedIds);
  }, [section, source, started, answeredIds, skippedIds]);

  const bySection = useMemo(() => (entries || []).filter((e) => e.section === section && !e.pending), [entries, section]);
  const tiers = useMemo(() => buildTiers(bySection), [bySection]);

  const queue = useMemo(() => {
    if (!entries) return [];
    const ordered = resolveSource(bySection, source);
    // Keep Reading Comprehension batches adjacent and in sequence, rather
    // than scattered wherever they land in the tiered/filtered order.
    return groupForSequentialPractice(ordered).flat();
  }, [entries, bySection, source]);

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
              <button key={s} className={"pill" + (s === section ? " active" : "")} onClick={() => setSection(s)}>{s}</button>
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
          <div className="pills" style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {SECTIONS.map((s) => (
              <button key={s} className={"pill" + (s === section ? " active" : "")} onClick={() => { setSection(s); setMode(null); }}>{s}</button>
            ))}
          </div>

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
                  const count = tiers[t.key].length;
                  return (
                    <button
                      key={t.key}
                      className="card"
                      style={{
                        padding: 16, textAlign: "left", border: "1px solid var(--border)", width: "100%",
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        cursor: count ? "pointer" : "default", opacity: count ? 1 : 0.5,
                      }}
                      onClick={() => count && startWithSource({ type: "tier", tier: t.key })}
                      disabled={!count}
                    >
                      <span style={{ fontSize: 14 }}>{t.label}</span>
                      <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: count ? "var(--amber)" : "var(--muted)" }}>{count}</span>
                    </button>
                  );
                })}
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
        <button className="btn" style={{ fontSize: 11.5, padding: "5px 10px" }} onClick={backToSetup}>Exit session</button>
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
