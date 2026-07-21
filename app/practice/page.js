"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import QuestionCard from "@/components/QuestionCard";
import { listEntries, updateEntry, groupForSequentialPractice } from "@/lib/entries";

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Shuffles which Reading Comprehension batch (or standalone question) comes
// next, but never splits up a batch — its questions always stay adjacent
// and in original order.
function shuffleGrouped(entries) {
  return shuffle(groupForSequentialPractice(entries)).flat();
}

export default function PracticePage() {
  const [entries, setEntries] = useState(null);
  const [section, setSection] = useState("All");
  const [session, setSession] = useState(null); // { queue: [entry,...], index, correct, total, streak, bestStreak }

  const refresh = () => listEntries().then(setEntries);
  useEffect(() => { refresh(); }, []);

  const pool = useMemo(() => {
    if (!entries) return [];
    return entries.filter((e) => section === "All" || e.section === section);
  }, [entries, section]);

  const patchEntry = (id, patch) => {
    updateEntry(id, patch).catch(() => {});
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const startSession = () => {
    setSession({ queue: shuffleGrouped(pool), index: 0, correct: 0, total: 0, streak: 0, bestStreak: 0 });
  };

  const endSession = () => setSession(null);

  const handleSkip = () => setSession((s) => ({ ...s, index: s.index + 1 }));

  const handleFinish = async ({ correct }) => {
    const current = session.queue[session.index];
    const totalAttempts = (current.totalAttempts || 0) + 1;
    const wrongAttempts = (current.wrongAttempts || 0) + (correct ? 0 : 1);
    patchEntry(current.id, { totalAttempts, wrongAttempts });

    setSession((s) => {
      const nextStreak = correct ? s.streak + 1 : 0;
      return {
        ...s,
        index: s.index + 1,
        correct: s.correct + (correct ? 1 : 0),
        total: s.total + 1,
        streak: nextStreak,
        bestStreak: Math.max(s.bestStreak, nextStreak),
      };
    });
  };

  if (!entries) return <AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>;

  // Pre-session config screen
  if (!session) {
    return (
      <AppShell>
        <div className="card" style={{ padding: 22 }}>
          <div className="serif" style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Practice Arena</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20 }}>Pull from your whole question bank, not just what&apos;s due for review.</div>

          <div style={{ marginBottom: 16 }}>
            <label>Section</label>
            <div style={{ display: "flex", gap: 10 }}>
              {["All", "Quant", "Verbal"].map((s) => (
                <button key={s} className="btn" style={{ flex: 1, background: section === s ? (s === "Quant" ? "var(--quant)" : s === "Verbal" ? "var(--verbal)" : "var(--amber)") : "var(--panel2)", color: section === s ? "#0F1115" : "var(--text)", fontWeight: section === s ? 700 : 400 }}
                  onClick={() => setSection(s)}>{s}</button>
              ))}
            </div>
          </div>

          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 16 }}>{pool.length} question{pool.length === 1 ? "" : "s"} in this pool.</div>

          <button className="btn btn-primary" onClick={startSession} disabled={pool.length === 0}>Start session</button>
        </div>
      </AppShell>
    );
  }

  const current = session.queue[session.index];

  if (!current) {
    return (
      <AppShell>
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 16, marginBottom: 8, color: "var(--sage)" }}>Session complete.</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 18 }}>
            {session.correct}/{session.total} correct · best streak {session.bestStreak}
          </div>
          <button className="btn btn-primary" onClick={endSession}>Back to setup</button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, fontSize: 13, color: "var(--muted)" }}>
        <span>{session.index + 1} / {session.queue.length}</span>
        <span>
          <span style={{ color: "var(--sage)" }}>{session.correct} correct</span>
          {" · "}
          <span style={{ color: session.streak > 0 ? "var(--amber)" : "var(--muted)" }}>streak {session.streak}</span>
        </span>
        <button className="btn" style={{ fontSize: 12, padding: "5px 10px" }} onClick={endSession}>End session</button>
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
