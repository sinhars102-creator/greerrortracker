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

// Practice sessions are rarely finished in one sitting — progress is saved
// to localStorage per section so "Continue" can pick up later, independent
// of Quant vs Verbal.
const PROGRESS_KEY = (section) => `gre-practice-progress:${section}`;

function loadProgress(section) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY(section));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveProgress(section, data) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(PROGRESS_KEY(section), JSON.stringify(data)); } catch {}
}

function clearProgress(section) {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(PROGRESS_KEY(section)); } catch {}
}

export default function PracticePage() {
  const [entries, setEntries] = useState(null);
  const [section, setSection] = useState("All");
  const [session, setSession] = useState(null); // { section, queue: [entry,...], index, correct, total, streak, bestStreak }
  // Lazy initializer (not an effect) so this reads localStorage once on
  // mount without a setState-in-effect render cascade.
  const [savedProgress, setSavedProgress] = useState(() => ({ Quant: loadProgress("Quant"), Verbal: loadProgress("Verbal") }));

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
    setSession({ section, queue: shuffleGrouped(pool), index: 0, correct: 0, total: 0, streak: 0, bestStreak: 0 });
  };

  const continueSession = (s) => {
    const saved = loadProgress(s);
    if (!saved) return;
    const byId = new Map(entries.map((e) => [e.id, e]));
    const queue = saved.queueIds.map((id) => byId.get(id)).filter(Boolean);
    setSection(s);
    setSession({ section: s, queue, index: Math.min(saved.index, queue.length), correct: saved.correct, total: saved.total, streak: saved.streak, bestStreak: saved.bestStreak });
  };

  // Persist progress every time it changes, so leaving mid-session (or just
  // closing the tab) doesn't lose your place. Cleared once the queue is
  // actually finished — nothing left to continue at that point. Pure
  // localStorage side effects only; savedProgress (React state, used to
  // show the "Continue" buttons) is refreshed from handlers, not here.
  useEffect(() => {
    if (!session || session.section === "All") return;
    if (session.index >= session.queue.length) {
      clearProgress(session.section);
      return;
    }
    saveProgress(session.section, {
      queueIds: session.queue.map((e) => e.id),
      index: session.index,
      correct: session.correct,
      total: session.total,
      streak: session.streak,
      bestStreak: session.bestStreak,
    });
  }, [session]);

  const endSession = () => {
    if (session && session.section !== "All") {
      setSavedProgress((prev) => ({ ...prev, [session.section]: loadProgress(session.section) }));
    }
    setSession(null);
  };

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

          {(savedProgress.Quant || savedProgress.Verbal) && (
            <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 8 }}>
              {["Quant", "Verbal"].map((s) => savedProgress[s] && (
                <button key={s} className="btn btn-primary" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  onClick={() => continueSession(s)}>
                  <span>Continue {s} practice</span>
                  <span style={{ fontSize: 12, opacity: 0.85 }}>{savedProgress[s].index}/{savedProgress[s].queueIds.length}</span>
                </button>
              ))}
            </div>
          )}

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

          <button className="btn btn-primary" onClick={startSession} disabled={pool.length === 0}>
            {savedProgress[section] ? "Start new session (discards saved progress)" : "Start session"}
          </button>
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
