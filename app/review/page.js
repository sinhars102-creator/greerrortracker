"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import QuestionCard from "@/components/QuestionCard";
import { listEntries, updateEntry, groupForSequentialPractice } from "@/lib/entries";

const INTERVALS = [1, 3, 7, 14, 30];
const RECENT_DAYS = 3;
const SECTIONS = ["Verbal", "Quant"];

function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Practice ordering (no due-date gating, replaces spaced-repetition
// scheduling as the thing that decides order — see conversation for the
// full rationale):
//   1. Logged today or in the last RECENT_DAYS days — newest first.
//   2. "Mistakes" — ever gotten wrong (worst offenders first), then never
//      attempted at all. Membership here is permanent: once wrongAttempts
//      is > 0 it stays a mistake even after later correct reviews.
//   3. Everything else (attempted, never gotten wrong, including mastered
//      entries which never drop out) — oldest-logged first.
// No cap: the full pool is included every session, just reordered.
function buildPracticeQueue(entries) {
  const recentCutoff = addDays(todayISO(), -RECENT_DAYS);
  const tier1 = [];
  const tier2Missed = [];
  const tier2New = [];
  const tier3 = [];

  for (const e of entries) {
    const createdDate = (e.createdAt || "").slice(0, 10);
    if (createdDate >= recentCutoff) { tier1.push(e); continue; }
    if ((e.wrongAttempts || 0) > 0) { tier2Missed.push(e); continue; }
    if (!e.totalAttempts) { tier2New.push(e); continue; }
    tier3.push(e);
  }

  tier1.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  tier2Missed.sort((a, b) => (b.wrongAttempts || 0) - (a.wrongAttempts || 0));
  tier2New.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  tier3.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  return [...tier1, ...tier2Missed, ...tier2New, ...tier3];
}

export default function ReviewPage() {
  const [entries, setEntries] = useState(null);
  const [section, setSection] = useState("Verbal");
  const [started, setStarted] = useState(false);
  const [skippedIds, setSkippedIds] = useState(() => new Set());
  const [answeredIds, setAnsweredIds] = useState(() => new Set());

  const refresh = () => listEntries().then(setEntries);
  useEffect(() => { refresh(); }, []);

  const queue = useMemo(() => {
    if (!entries) return [];
    const bySection = entries.filter((e) => e.section === section && !e.pending);
    const ordered = buildPracticeQueue(bySection);
    // Keep Reading Comprehension batches adjacent and in sequence, rather
    // than scattered wherever they land in the tiered order.
    return groupForSequentialPractice(ordered).flat();
  }, [entries, section]);

  // Answering a question doesn't remove it from the underlying pool (there's
  // no due-date gating anymore to naturally push it out), so track what's
  // been answered this session separately and filter it out of `remaining`.
  // Skipped entries stay in the pool but are passed over for the rest of
  // this session.
  const remaining = queue.filter((e) => !answeredIds.has(e.id) && !skippedIds.has(e.id));
  const current = started ? remaining[0] : null;

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

  if (!entries) return <AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>;

  if (queue.length === 0) {
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
          <div className="pills" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {SECTIONS.map((s) => (
              <button key={s} className={"pill" + (s === section ? " active" : "")} onClick={() => setSection(s)}>{s}</button>
            ))}
          </div>
          <div className="serif" style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{queue.length} to practice</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20 }}>Recent + mistakes first, then the rest oldest-first. No due dates — the whole {section} pool, reordered.</div>
          <button className="btn btn-primary" onClick={() => { setSkippedIds(new Set()); setAnsweredIds(new Set()); setStarted(true); }}>Start practice</button>
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
            <button className="btn" onClick={() => setStarted(false)}>Back to setup</button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>{remaining.length} left{skippedIds.size > 0 ? ` · ${skippedIds.size} skipped` : ""}</div>
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
