"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import QuestionCard from "@/components/QuestionCard";
import { listEntries, updateEntry } from "@/lib/entries";

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
  const [mode, setMode] = useState("quick");
  const [skippedIds, setSkippedIds] = useState(() => new Set());

  const refresh = () => listEntries().then(setEntries);
  useEffect(() => { refresh(); }, []);

  const due = useMemo(() => {
    if (!entries) return [];
    const today = todayISO();
    return entries.filter((e) => !e.mastered && e.nextReview <= today);
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

  const handleFinish = async ({ correct, deepAttempt, gradeResult }) => {
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
    if (deepAttempt) {
      patch.lastAttempt = { mode: "deep", ...deepAttempt, feedback: gradeResult, attemptedAt: todayISO() };
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

          <div style={{ marginBottom: 20 }}>
            <label>Mode</label>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" style={{ flex: 1, background: mode === "quick" ? "var(--amber)" : "var(--panel2)", color: mode === "quick" ? "#0F1115" : "var(--text)", fontWeight: mode === "quick" ? 700 : 400 }} onClick={() => setMode("quick")}>Quick Check</button>
              <button className="btn" style={{ flex: 1, background: mode === "deep" ? "var(--amber)" : "var(--panel2)", color: mode === "deep" ? "#0F1115" : "var(--text)", fontWeight: mode === "deep" ? 700 : 400 }} onClick={() => setMode("deep")}>Deep Practice</button>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 6 }}>
              {mode === "quick" ? "Pick an answer, get graded instantly." : "Write your reasoning and tag traps — graded by AI."}
            </div>
          </div>

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
        mode={mode}
        onBlanksExtracted={(blanks) => patchEntry(current.id, { blanks })}
        onFinish={handleFinish}
        onSkip={handleSkip}
      />
    </AppShell>
  );
}
