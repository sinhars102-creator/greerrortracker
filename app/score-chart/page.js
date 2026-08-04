"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase/client";
import { listScores, createScore, updateScore, deleteScore } from "@/lib/scores";

const eyebrow = { fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" };

// Official adaptive-GRE score-conversion tables. Row = # correct in Section
// 1, Column = # correct in Section 2, value = scaled score (130-170).
// Difficulty is which Section 2 you get routed to based on Section 1
// performance, so it's a property of the row, not the individual cell.
const QUANT_SCORES = [
  [130, 130, 130, 131, 134, 136, 138, 139, 141, 142, 143, 144, 145, 146, 147, 148],
  [130, 130, 131, 134, 136, 138, 139, 141, 142, 143, 144, 145, 146, 147, 148, 149],
  [130, 131, 134, 136, 138, 139, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150],
  [131, 134, 136, 138, 139, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151],
  [136, 138, 140, 141, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154],
  [138, 140, 141, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 156],
  [140, 141, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 156, 157],
  [141, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 156, 157, 158],
  [146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 160, 161, 162],
  [147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 160, 161, 162, 164],
  [148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 160, 161, 162, 164, 166],
  [149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 160, 161, 162, 164, 166, 168],
  [150, 151, 152, 153, 154, 155, 156, 157, 158, 160, 161, 162, 164, 166, 168, 170],
];

const VERBAL_SCORES = [
  [130, 130, 130, 131, 134, 136, 138, 140, 142, 143, 145, 146, 147, 148, 150, 151],
  [130, 130, 131, 134, 136, 138, 140, 142, 143, 145, 146, 147, 148, 150, 151, 152],
  [130, 131, 134, 136, 138, 140, 142, 143, 145, 146, 147, 148, 150, 151, 152, 153],
  [131, 134, 136, 138, 140, 142, 143, 145, 146, 147, 148, 150, 151, 152, 153, 154],
  [134, 136, 138, 140, 142, 143, 145, 146, 147, 148, 150, 151, 152, 153, 154, 155],
  [141, 143, 144, 146, 147, 149, 150, 151, 152, 153, 154, 155, 156, 157, 159, 160],
  [143, 144, 146, 147, 149, 150, 151, 153, 153, 154, 155, 156, 157, 159, 160, 161],
  [144, 146, 147, 149, 150, 151, 153, 153, 154, 155, 156, 157, 159, 160, 161, 162],
  [146, 147, 149, 150, 151, 153, 153, 154, 155, 156, 157, 159, 160, 161, 162, 164],
  [149, 150, 152, 153, 154, 155, 156, 157, 158, 160, 161, 162, 163, 165, 166, 168],
  [150, 152, 153, 154, 155, 156, 157, 158, 160, 161, 162, 163, 165, 166, 168, 169],
  [152, 153, 154, 155, 156, 157, 158, 160, 161, 162, 163, 165, 166, 168, 169, 170],
  [153, 154, 155, 156, 157, 158, 160, 161, 162, 163, 165, 166, 168, 169, 170, 170],
];

// Row-index cutoffs (inclusive upper bound) for each difficulty tier — the
// two sections use different cutoffs since they have different question
// counts in Section 1 (Quant maxes its "easy" band at row 3, Verbal at 4).
function difficultyFor(section, section1Correct) {
  const bands = section === "Quant"
    ? [{ max: 3, label: "EASY" }, { max: 7, label: "MEDIUM" }, { max: 12, label: "HARD" }]
    : [{ max: 4, label: "EASY" }, { max: 8, label: "MEDIUM" }, { max: 12, label: "HARD" }];
  return bands.find((b) => section1Correct <= b.max)?.label || "HARD";
}

const DIFFICULTY_COLOR = { EASY: "#F2E14C", MEDIUM: "#E0954A", HARD: "#D9534F" };

function ScoreGrid({ section, scores, s1, s2 }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, whiteSpace: "nowrap" }}>
        <thead>
          <tr>
            <th style={{ padding: "6px 8px" }}></th>
            <th colSpan={16} style={{ padding: "6px 8px", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>
              # correct in Section 2
            </th>
          </tr>
          <tr>
            <th style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}></th>
            {scores[0].map((_, c) => (
              <th key={c} style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)", color: c === s2 ? "var(--amber)" : "var(--muted)" }}>{c}</th>
            ))}
            <th style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>Difficulty</th>
          </tr>
        </thead>
        <tbody>
          {scores.map((row, r) => {
            const label = difficultyFor(section, r);
            return (
              <tr key={r} style={{ background: r === s1 ? "rgba(232,163,61,0.10)" : "transparent" }}>
                <td style={{ padding: "4px 8px", fontWeight: 700, color: r === s1 ? "var(--amber)" : "var(--muted)", borderRight: "1px solid var(--border)" }}>{r}</td>
                {row.map((val, c) => {
                  const isCurrent = r === s1 && c === s2;
                  return (
                    <td
                      key={c}
                      className="mono"
                      style={{
                        padding: "4px 8px", textAlign: "center",
                        background: isCurrent ? "var(--amber)" : "transparent",
                        color: isCurrent ? "#0F1115" : "var(--text)",
                        fontWeight: isCurrent ? 700 : 400,
                        borderRadius: isCurrent ? 4 : 0,
                      }}
                    >
                      {val}
                    </td>
                  );
                })}
                <td style={{ padding: "4px 8px", fontSize: 11, fontWeight: 700, color: DIFFICULTY_COLOR[label] }}>{label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

// Total (260-340) lives on a completely different scale than Quant/Verbal
// (130-170) — plotting it on the same axis would either clip it off the top
// or flatten Quant/Verbal into an unreadable sliver. Quant/Verbal use the
// left axis, Total gets its own right-hand axis.
function ScoreTrendChart({ testScores }) {
  const data = testScores.map((s) => ({
    date: s.testDate, Quant: s.quantScore, Verbal: s.verbalScore, Total: s.quantScore + s.verbalScore,
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted)" }} />
        <YAxis yAxisId="left" domain={[130, 170]} tick={{ fontSize: 11, fill: "var(--muted)" }} />
        <YAxis yAxisId="right" orientation="right" domain={[260, 340]} tick={{ fontSize: 11, fill: "var(--muted)" }} />
        <Tooltip
          contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12.5 }}
          labelStyle={{ color: "var(--text)", fontWeight: 700, marginBottom: 4 }}
          formatter={(value, name) => [value, name]}
        />
        <Legend wrapperStyle={{ fontSize: 12.5 }} />
        <Line yAxisId="left" type="monotone" dataKey="Quant" stroke="var(--quant)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
        <Line yAxisId="left" type="monotone" dataKey="Verbal" stroke="var(--verbal)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
        <Line yAxisId="right" type="monotone" dataKey="Total" stroke="var(--amber)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function LogScoreForm({ onLogged }) {
  const [testDate, setTestDate] = useState(todayISO());
  const [quantScore, setQuantScore] = useState("");
  const [verbalScore, setVerbalScore] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    const q = parseInt(quantScore, 10);
    const v = parseInt(verbalScore, 10);
    if (q < 130 || q > 170 || v < 130 || v > 170) {
      setError("Scores must be between 130 and 170.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const saved = await createScore({ testDate, quantScore: q, verbalScore: v, notes }, user.id);
      onLogged(saved);
      setQuantScore("");
      setVerbalScore("");
      setNotes("");
    } catch (err) {
      setError(err.message || "Couldn't save this score.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div>
        <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Test date</label>
        <input type="date" value={testDate} max={todayISO()} onChange={(e) => setTestDate(e.target.value)} required style={{ width: "auto" }} />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Quant score</label>
        <input type="number" min={130} max={170} value={quantScore} onChange={(e) => setQuantScore(e.target.value)} required style={{ width: 80 }} />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Verbal score</label>
        <input type="number" min={130} max={170} value={verbalScore} onChange={(e) => setVerbalScore(e.target.value)} required style={{ width: 80 }} />
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Notes (optional)</label>
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Manhattan practice test 3" style={{ width: "100%" }} />
      </div>
      <button className="btn btn-primary" type="submit" disabled={submitting}>{submitting ? "Saving…" : "Log score"}</button>
      {error && <div style={{ fontSize: 12, color: "var(--red)", width: "100%" }}>{error}</div>}
    </form>
  );
}

function ScoreRow({ score, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [testDate, setTestDate] = useState(score.testDate);
  const [quantScore, setQuantScore] = useState(score.quantScore);
  const [verbalScore, setVerbalScore] = useState(score.verbalScore);
  const [notes, setNotes] = useState(score.notes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const startEdit = () => {
    setTestDate(score.testDate);
    setQuantScore(score.quantScore);
    setVerbalScore(score.verbalScore);
    setNotes(score.notes);
    setError("");
    setEditing(true);
  };

  const save = async () => {
    const q = parseInt(quantScore, 10);
    const v = parseInt(verbalScore, 10);
    if (q < 130 || q > 170 || v < 130 || v > 170) {
      setError("Scores must be between 130 and 170.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onUpdate(score.id, { testDate, quantScore: q, verbalScore: v, notes });
      setEditing(false);
    } catch (err) {
      setError(err.message || "Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input type="date" value={testDate} max={todayISO()} onChange={(e) => setTestDate(e.target.value)} style={{ width: "auto", fontSize: 12.5 }} />
          <input type="number" min={130} max={170} value={quantScore} onChange={(e) => setQuantScore(e.target.value)} style={{ width: 70, fontSize: 12.5 }} />
          <input type="number" min={130} max={170} value={verbalScore} onChange={(e) => setVerbalScore(e.target.value)} style={{ width: 70, fontSize: 12.5 }} />
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="notes" style={{ flex: 1, minWidth: 120, fontSize: 12.5 }} />
          <button className="btn btn-primary" style={{ fontSize: 11, padding: "4px 10px" }} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          <button className="btn" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
        </div>
        {error && <div style={{ fontSize: 12, color: "var(--red)" }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12.5 }}>
      <span className="mono" style={{ color: "var(--muted)", width: 90 }}>{score.testDate}</span>
      <span className="mono" style={{ color: "var(--quant)", fontWeight: 700 }}>Q {score.quantScore}</span>
      <span className="mono" style={{ color: "var(--verbal)", fontWeight: 700 }}>V {score.verbalScore}</span>
      <span className="mono" style={{ fontWeight: 700 }}>Σ {score.quantScore + score.verbalScore}</span>
      {score.notes && <span style={{ color: "var(--muted)", flex: 1 }}>{score.notes}</span>}
      <button className="btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={startEdit}>Edit</button>
      <button className="btn" style={{ fontSize: 11, padding: "3px 8px", color: "var(--red)" }} onClick={() => onDelete(score.id)}>Delete</button>
    </div>
  );
}

export default function ScoreChartPage() {
  const [section, setSection] = useState("Quant");
  const [s1, setS1] = useState(null);
  const [s2, setS2] = useState(null);
  const [testScores, setTestScores] = useState(null);

  useEffect(() => { listScores().then(setTestScores).catch(() => setTestScores([])); }, []);

  const handleLogged = (saved) => {
    setTestScores((prev) => [...(prev || []), saved].sort((a, b) => a.testDate.localeCompare(b.testDate)));
  };

  const handleDelete = async (id) => {
    setTestScores((prev) => prev.filter((s) => s.id !== id));
    deleteScore(id).catch(() => {});
  };

  const handleUpdate = async (id, patch) => {
    const saved = await updateScore(id, patch);
    setTestScores((prev) => prev.map((s) => (s.id === id ? saved : s)).sort((a, b) => a.testDate.localeCompare(b.testDate)));
  };

  const scores = section === "Quant" ? QUANT_SCORES : VERBAL_SCORES;
  const maxS1 = scores.length - 1;
  const maxS2 = scores[0].length - 1;
  const clampedS1 = s1 === null ? null : Math.min(Math.max(s1, 0), maxS1);
  const clampedS2 = s2 === null ? null : Math.min(Math.max(s2, 0), maxS2);
  const result = clampedS1 !== null && clampedS2 !== null ? scores[clampedS1][clampedS2] : null;
  const resultDifficulty = clampedS1 !== null ? difficultyFor(section, clampedS1) : null;

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={eyebrow}>Score Chart</div>
        <div className="pills" style={{ display: "flex", gap: 8 }}>
          {["Quant", "Verbal"].map((s) => (
            <button
              key={s}
              className={"pill" + (s === section ? " active" : "")}
              onClick={() => { setSection(s); setS1(null); setS2(null); }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 20 }}>
        <div style={{ ...eyebrow, marginBottom: 12 }}>Look up your score</div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              Correct in Section 1 (0-{maxS1})
            </label>
            <input
              type="number"
              min={0}
              max={maxS1}
              value={s1 ?? ""}
              onChange={(e) => setS1(e.target.value === "" ? null : parseInt(e.target.value, 10))}
              style={{ width: 90 }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              Correct in Section 2 (0-{maxS2})
            </label>
            <input
              type="number"
              min={0}
              max={maxS2}
              value={s2 ?? ""}
              onChange={(e) => setS2(e.target.value === "" ? null : parseInt(e.target.value, 10))}
              style={{ width: 90 }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            {result !== null ? (
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 2 }}>
                  Scaled score
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span className="mono" style={{ fontSize: 32, fontWeight: 700, color: "var(--amber)" }}>{result}</span>
                  <span className="pill" style={{ background: DIFFICULTY_COLOR[resultDifficulty], color: "#0F1115", fontWeight: 700 }}>
                    {resultDifficulty}
                  </span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>Enter both values to see your scaled score.</div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 20 }}>
        <div style={{ ...eyebrow, marginBottom: 12 }}>Log a practice test score</div>
        <LogScoreForm onLogged={handleLogged} />
      </div>

      {testScores === null ? (
        <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 20 }}>Loading scores…</div>
      ) : testScores.length > 0 && (
        <div className="card" style={{ padding: 18, marginBottom: 20 }}>
          <div style={{ ...eyebrow, marginBottom: 12 }}>Score trend</div>
          <ScoreTrendChart testScores={testScores} />
          <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {[...testScores].reverse().map((s) => (
              <ScoreRow key={s.id} score={s} onUpdate={handleUpdate} onDelete={handleDelete} />
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 18 }}>
        <div style={{ ...eyebrow, marginBottom: 12 }}>{section} reference table</div>
        <ScoreGrid section={section} scores={scores} s1={clampedS1} s2={clampedS2} />
      </div>
    </AppShell>
  );
}
