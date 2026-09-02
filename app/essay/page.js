"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase/client";
import { listEssays, createEssay, deleteEssay } from "@/lib/essays";

const eyebrow = { fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" };

const TASK_TYPES = ["Issue", "Argument"];

function scoreTier(score) {
  if (score >= 5) return { label: "Strong", color: "var(--sage)" };
  if (score >= 3.5) return { label: "Adequate", color: "var(--amber)" };
  return { label: "Needs work", color: "var(--red)" };
}

function wordCount(text) {
  const trimmed = (text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

async function gradeEssay(taskType, prompt, essayText) {
  const res = await fetch("/api/grade-essay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskType, prompt, essayText }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Grading failed");
  return data;
}

// The structural outline as a top-to-bottom chain of connected boxes — a
// quick-glance diagram meant to be remembered while rewriting, not a full
// re-read of the feedback paragraph.
function StructureDiagram({ structure }) {
  if (!structure || (!structure.thesis && (!structure.boxes || structure.boxes.length === 0))) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", maxWidth: 520, margin: "0 auto" }}>
      {structure.thesis && (
        <>
          <div
            style={{
              border: "1px solid var(--amber)", background: "rgba(232,163,61,0.1)", borderRadius: 8,
              padding: "12px 14px", textAlign: "center",
            }}
          >
            <div style={{ ...eyebrow, color: "var(--amber)", marginBottom: 4 }}>Thesis</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{structure.thesis}</div>
          </div>
          {structure.boxes?.length > 0 && (
            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 18, margin: "2px 0" }}>↓</div>
          )}
        </>
      )}
      {(structure.boxes || []).map((b, i) => (
        <div key={i}>
          <div style={{ border: "1px solid var(--border)", background: "var(--panel2)", borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--quant)", marginBottom: 4 }}>{b.role}</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>{b.content}</div>
          </div>
          {i < (structure.boxes || []).length - 1 && (
            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 18, margin: "2px 0" }}>↓</div>
          )}
        </div>
      ))}
    </div>
  );
}

function EssayHistoryRow({ essay, onDelete }) {
  const tier = essay.score != null ? scoreTier(essay.score) : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12.5, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <span className="mono" style={{ color: "var(--muted)", width: 90 }}>{(essay.createdAt || "").slice(0, 10)}</span>
      <span className="pill" style={{ background: "var(--panel2)", color: "var(--muted)" }}>{essay.taskType}</span>
      {tier && (
        <span className="mono" style={{ fontWeight: 700, color: tier.color }}>{essay.score}/6</span>
      )}
      <span style={{ color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {essay.prompt}
      </span>
      <button className="btn" style={{ fontSize: 11, padding: "3px 8px", color: "var(--red)" }} onClick={() => onDelete(essay.id)}>Delete</button>
    </div>
  );
}

export default function EssayPage() {
  const [stage, setStage] = useState("setup"); // setup | writing | result
  const [taskType, setTaskType] = useState("Issue");
  const [prompt, setPrompt] = useState("");
  const [essayText, setEssayText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(null);

  useEffect(() => { listEssays().then(setHistory).catch(() => setHistory([])); }, []);

  const startWriting = () => {
    if (!prompt.trim()) return;
    setEssayText("");
    setError("");
    setStage("writing");
  };

  const submit = async () => {
    if (!essayText.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const graded = await gradeEssay(taskType, prompt, essayText);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const saved = await createEssay({
        taskType, prompt, essayText,
        score: graded.score, scoreSummary: graded.scoreSummary, feedback: graded.feedback, structure: graded.structure,
      }, user.id);
      setResult(saved);
      setHistory((prev) => (prev ? [saved, ...prev] : [saved]));
      setStage("result");
    } catch (e) {
      setError(e.message || "Couldn't grade this essay. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const rewriteAgain = () => {
    setEssayText("");
    setResult(null);
    setError("");
    setStage("writing");
  };

  const newEssay = () => {
    setPrompt("");
    setEssayText("");
    setResult(null);
    setError("");
    setStage("setup");
  };

  const handleDeleteEssay = async (id) => {
    setHistory((prev) => (prev || []).filter((e) => e.id !== id));
    deleteEssay(id).catch(() => {});
  };

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={eyebrow}>Essay</div>
      </div>

      {stage === "setup" && (
        <div className="card" style={{ padding: 22, marginBottom: 20 }}>
          <div style={{ ...eyebrow, marginBottom: 12 }}>New essay</div>
          <div className="pills" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {TASK_TYPES.map((t) => (
              <button key={t} className={"pill" + (t === taskType ? " active" : "")} onClick={() => setTaskType(t)}>
                {t}
              </button>
            ))}
          </div>
          <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
            Paste the GRE prompt
          </label>
          <textarea
            rows={6}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={taskType === "Argument"
              ? "Paste the argument passage and instructions here…"
              : "Paste the issue statement and instructions here…"}
          />
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary" onClick={startWriting} disabled={!prompt.trim()}>Start writing</button>
          </div>
        </div>
      )}

      {stage === "writing" && (
        <div className="card" style={{ padding: 22, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span className="pill" style={{ background: "var(--panel2)", color: "var(--muted)" }}>{taskType}</span>
            <button className="btn" style={{ fontSize: 11.5, padding: "4px 10px" }} onClick={() => setStage("setup")}>← Change prompt</button>
          </div>
          <div style={{ marginBottom: 16, border: "1px solid var(--border)", borderRadius: 5, background: "var(--panel2)", padding: 12, maxHeight: 200, overflowY: "auto", fontSize: 13, whiteSpace: "pre-wrap" }}>
            {prompt}
          </div>
          <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
            Your essay — no spelling/grammar suggestions, same as the real GRE interface
          </label>
          <textarea
            rows={18}
            value={essayText}
            onChange={(e) => setEssayText(e.target.value)}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            placeholder="Write your essay here…"
            style={{ fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{wordCount(essayText)} words</span>
          </div>
          {error && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{error}</div>}
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary" onClick={submit} disabled={submitting || !essayText.trim()}>
              {submitting ? "Grading…" : "Submit for grading"}
            </button>
          </div>
        </div>
      )}

      {stage === "result" && result && (
        <div className="card" style={{ padding: 22, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 6 }}>
            <span className="mono" style={{ fontSize: 34, fontWeight: 700, color: scoreTier(result.score).color }}>{result.score}</span>
            <span style={{ fontSize: 15, color: "var(--muted)" }}>/ 6</span>
            <span className="pill" style={{ background: scoreTier(result.score).color, color: "#0F1115", fontWeight: 700 }}>
              {scoreTier(result.score).label}
            </span>
          </div>
          <div style={{ fontSize: 13.5, marginBottom: 14 }}>{result.scoreSummary}</div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginBottom: 22 }}>{result.feedback}</div>

          <div style={{ ...eyebrow, marginBottom: 14, textAlign: "center" }}>Structure for your rewrite</div>
          <StructureDiagram structure={result.structure} />

          <div style={{ display: "flex", gap: 10, marginTop: 22, justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={rewriteAgain}>Rewrite this essay</button>
            <button className="btn" onClick={newEssay}>New essay</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 18 }}>
        <div style={{ ...eyebrow, marginBottom: 12 }}>Past essays</div>
        {history === null ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div>
        ) : history.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Nothing logged yet.</div>
        ) : (
          <div>
            {history.map((e) => (
              <EssayHistoryRow key={e.id} essay={e} onDelete={handleDeleteEssay} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
