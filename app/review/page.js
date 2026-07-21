"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import QuestionCard from "@/components/QuestionCard";
import { listEntries, updateEntry, groupForSequentialPractice } from "@/lib/entries";

const INTERVALS = [1, 3, 7, 14, 30];

function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function ReviewPage() {
  const [entries, setEntries] = useState(null);
  const [started, setStarted] = useState(false);
  const [skippedIds, setSkippedIds] = useState(() => new Set());

  const refresh = () => listEntries().then(setEntries);
  useEffect(() => { refresh(); }, []);

  const due = useMemo(() => {
    if (!entries) return [];
    const today = todayISO();
    const dueEntries = entries.filter((e) => !e.mastered && e.nextReview <= today);
    // Keep Reading Comprehension batches adjacent and in sequence, rather
    // than scattered wherever they land in the due list.
    return groupForSequentialPractice(dueEntries).flat();
  }, [entries]);

  // A wrong or right answer always moves nextReview off "today", so the
  // just-answered entry naturally drops out of `due` on the next refresh —
  // no need to track "current" separately from the queue itself. Skipped
  // entries stay due but are passed over for the rest of this session.
  const remaining = due.filter((e) => !skippedIds.has(e.id));
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
    await refresh();
  };

  if (!entries) return <AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>;

  if (due.length === 0) {
    return (
      <AppShell>
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 16, marginBottom: 8, color: "var(--sage)" }}>All caught up.</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Nothing due for review right now.</div>
        </div>
      </AppShell>
    );
  }

  if (!started) {
    return (
      <AppShell>
        <div className="card" style={{ padding: 22 }}>
          <div className="serif" style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{due.length} due for review</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20 }}>Spaced-repetition queue — items you&apos;ve missed or haven&apos;t reviewed recently.</div>
          <button className="btn btn-primary" onClick={() => { setSkippedIds(new Set()); setStarted(true); }}>Start review</button>
        </div>
      </AppShell>
    );
  }

  if (!current) {
    return (
      <AppShell>
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Skipped everything due right now.</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 18 }}>{skippedIds.size} skipped this session.</div>
          <button className="btn btn-primary" onClick={() => setSkippedIds(new Set())}>Go through them again</button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>{remaining.length} due{skippedIds.size > 0 ? ` · ${skippedIds.size} skipped` : ""}</div>
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
