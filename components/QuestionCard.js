"use client";

import { useEffect, useState } from "react";
import { getScreenshotUrl } from "@/lib/entries";

const letter = (i) => String.fromCharCode(65 + i);

/**
 * Renders one question: pick an answer, check it, move on. Owns all UI
 * state for the current attempt; delegates persistence to the parent via
 * callbacks so Review and Practice Arena can each decide what stats to
 * update.
 *
 * The parent must render this with `key={entry.id}` so React remounts it
 * (and so all state below resets to its initial value) whenever the
 * question changes, instead of manually resetting state in an effect.
 */
export default function QuestionCard({ entry, onBlanksExtracted, onSolutionExtracted, onEdited, onFinish, onSkip }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [blanks, setBlanks] = useState(entry.blanks || null);
  const [loadingBlanks, setLoadingBlanks] = useState(!entry.blanks);
  const [error, setError] = useState("");

  const [selections, setSelections] = useState({});
  const [checked, setChecked] = useState(false);

  const [solution, setSolution] = useState(entry.solution || null);
  const [solutionVisible, setSolutionVisible] = useState(false);
  const [loadingSolution, setLoadingSolution] = useState(false);
  const [solutionError, setSolutionError] = useState("");

  const [editing, setEditing] = useState(false);
  const [editQuestionText, setEditQuestionText] = useState(entry.questionText || "");
  const [editPassage, setEditPassage] = useState(entry.passage || "");
  const [editBlanks, setEditBlanks] = useState(null);

  const accent = entry.section === "Quant" ? "var(--quant)" : "var(--verbal)";

  useEffect(() => {
    if (entry.hasImage && entry.imagePath) {
      getScreenshotUrl(entry.imagePath).then(setImageUrl).catch(() => {});
    }

    if (entry.blanks) return;

    let cancelled = false;
    (async () => {
      try {
        let signedUrl = null;
        if (entry.hasImage && entry.imagePath) {
          signedUrl = await getScreenshotUrl(entry.imagePath).catch(() => null);
        }
        const res = await fetch("/api/extract-options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entry, image: null, imageUrl: signedUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (cancelled) return;
        setBlanks(data.blanks);
        onBlanksExtracted?.(data.blanks);
      } catch (e) {
        if (!cancelled) setError(e.message || "Couldn't extract answer choices");
      } finally {
        if (!cancelled) setLoadingBlanks(false);
      }
    })();
    return () => { cancelled = true; };
    // Mount-only: the parent keys this component by entry.id, so a new
    // question means a fresh mount, not a re-run of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sentence Equivalence is always exactly 2. "Select all that apply" /
  // checkbox questions (b.multiSelect) allow any number, at least 1 — fall
  // back to treating >1 correct answers as checkbox-style for blanks cached
  // before multiSelect started being extracted. Everything else is a single
  // pick (radio-style).
  const blankIsCheckbox = (b) => entry.subtype !== "Sentence Equivalence" && (b.multiSelect || (b.correctIndices || []).length > 1);

  const toggleSelect = (bi, i) => {
    if (checked) return;
    const isSentenceEquivalence = entry.subtype === "Sentence Equivalence";
    const b = blanks[bi];
    setSelections((prev) => {
      const cur = prev[bi] || [];
      let next;
      if (isSentenceEquivalence) next = cur.includes(i) ? cur.filter((x) => x !== i) : (cur.length < 2 ? [...cur, i] : cur);
      else if (blankIsCheckbox(b)) next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i];
      else next = [i];
      return { ...prev, [bi]: next };
    });
  };

  const isBlankCorrect = (b, bi) => {
    const sel = [...(selections[bi] || [])].sort();
    const correct = [...(b.correctIndices || [])].sort();
    return sel.length === correct.length && sel.every((v, idx) => v === correct[idx]);
  };

  const allSelected = blanks && blanks.every((b, bi) => (selections[bi] || []).length > 0);
  const allCorrect = checked && blanks && blanks.every((b, bi) => isBlankCorrect(b, bi));

  const optionColors = (b, bi, i) => {
    const sel = selections[bi] || [];
    const isSelected = sel.includes(i);
    const isCorrectOpt = checked && (b.correctIndices || []).includes(i);
    const isWrongPick = checked && isSelected && !isCorrectOpt;
    let border = isSelected ? accent : "var(--border)";
    let bg = isSelected ? "var(--panel2)" : "transparent";
    if (checked) {
      if (isCorrectOpt) { border = "var(--sage)"; bg = "rgba(107,144,128,0.15)"; }
      else if (isWrongPick) { border = "var(--red)"; bg = "rgba(193,85,75,0.15)"; }
    }
    return { border, bg };
  };

  const startEdit = () => {
    setEditQuestionText(entry.questionText || "");
    setEditPassage(entry.passage || "");
    setEditBlanks(blanks.map((b) => ({ ...b, options: [...b.options], correctIndices: [...(b.correctIndices || [])] })));
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const updateOptionText = (bi, i, text) => {
    setEditBlanks((prev) => prev.map((b, idx) => (idx !== bi ? b : { ...b, options: b.options.map((o, oi) => (oi === i ? text : o)) })));
  };

  // Deliberately does NOT reuse blankIsCheckbox here: that helper falls back
  // to "correctIndices.length > 1" when multiSelect isn't set, which is
  // exactly the value you're trying to fix during editing — if the original
  // extraction only marked one correct answer on a question that actually
  // has two, that fallback would wrongly report single-select and trap you
  // at one pick. Editing needs its own explicit, user-controlled flag.
  const toggleEditMultiSelect = (bi) => {
    setEditBlanks((prev) => prev.map((b, idx) => (idx !== bi ? b : { ...b, multiSelect: !b.multiSelect, correctIndices: [] })));
  };

  const toggleEditCorrect = (bi, i) => {
    const isSentenceEquivalence = entry.subtype === "Sentence Equivalence";
    setEditBlanks((prev) => prev.map((b, idx) => {
      if (idx !== bi) return b;
      const cur = b.correctIndices || [];
      let next;
      if (isSentenceEquivalence) next = cur.includes(i) ? cur.filter((x) => x !== i) : (cur.length < 2 ? [...cur, i] : cur);
      else if (b.multiSelect) next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i];
      else next = [i];
      return { ...b, correctIndices: next };
    }));
  };

  const saveEdit = () => {
    const patch = { questionText: editQuestionText, passage: editPassage, blanks: editBlanks };
    setBlanks(editBlanks);
    onEdited?.(patch);
    setEditing(false);
  };

  const loadSolution = async () => {
    setSolutionVisible(true);
    if (solution) return; // already cached, nothing to fetch
    setLoadingSolution(true);
    setSolutionError("");
    try {
      const res = await fetch("/api/explain-solution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry: { section: entry.section, subtype: entry.subtype, questionText: entry.questionText, passage: entry.passage },
          blanks,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSolution(data.explanations);
      onSolutionExtracted?.(data.explanations);
    } catch (e) {
      setSolutionError(e.message || "Couldn't load solution");
    } finally {
      setLoadingSolution(false);
    }
  };

  if (loadingBlanks) {
    return (
      <div className="card" style={{ padding: 18, borderLeft: `3px solid ${accent}` }}>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>Reading answer choices…</div>
        <button className="btn" onClick={onSkip}>Skip</button>
      </div>
    );
  }
  if (error) {
    return (
      <div className="card" style={{ padding: 18, borderLeft: `3px solid ${accent}` }}>
        <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 14 }}>{error}</div>
        <button className="btn" onClick={onSkip}>Skip</button>
      </div>
    );
  }
  if (!blanks) return null;

  if (editing) {
    return (
      <div className="card" style={{ padding: 18, borderLeft: `3px solid ${accent}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <span className="pill" style={{ background: accent, color: "#0F1115" }}>{entry.section}</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{entry.subtype}</span>
          </div>
          <span style={{ fontSize: 11, color: "var(--amber)", textTransform: "uppercase", letterSpacing: ".04em" }}>Editing</span>
        </div>

        {(entry.subtype === "Reading Comprehension" || editPassage) && (
          <div style={{ marginBottom: 14 }}>
            <label>Passage</label>
            <textarea rows={6} value={editPassage} onChange={(e) => setEditPassage(e.target.value)} />
          </div>
        )}

        <div style={{ marginBottom: 18 }}>
          <label>Question text</label>
          <textarea rows={3} value={editQuestionText} onChange={(e) => setEditQuestionText(e.target.value)} />
        </div>

        {editBlanks.map((b, bi) => (
          <div key={bi} style={{ marginBottom: 20 }}>
            {b.label && <div style={{ fontSize: 12, color: accent, fontWeight: 700, marginBottom: 8 }}>{b.label}</div>}
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>Edit option text, and click to mark which one(s) are correct.</div>
            {entry.subtype !== "Sentence Equivalence" && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 12.5, color: "var(--muted)", cursor: "pointer", textTransform: "none" }}>
                <input type="checkbox" checked={!!b.multiSelect} onChange={() => toggleEditMultiSelect(bi)} style={{ width: "auto" }} />
                Select all that apply (more than one correct answer) — unchecking clears current marks
              </label>
            )}
            {b.options.map((opt, i) => {
              const isCorrect = (b.correctIndices || []).includes(i);
              return (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, color: accent, width: 16 }}>{letter(i)}</span>
                  <input value={opt} onChange={(ev) => updateOptionText(bi, i, ev.target.value)} style={{ flex: 1 }} />
                  <button
                    onClick={() => toggleEditCorrect(bi, i)}
                    className="btn"
                    style={{
                      padding: "7px 10px", fontSize: 11.5, whiteSpace: "nowrap",
                      background: isCorrect ? "var(--sage)" : "var(--panel2)",
                      color: isCorrect ? "#0F1115" : "var(--muted)",
                      borderColor: isCorrect ? "var(--sage)" : "var(--border)",
                    }}
                  >
                    {isCorrect ? "✓ Correct" : "Mark correct"}
                  </button>
                </div>
              );
            })}
          </div>
        ))}

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-primary" onClick={saveEdit}>Save</button>
          <button className="btn" onClick={cancelEdit}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 18, borderLeft: `3px solid ${accent}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <span className="pill" style={{ background: accent, color: "#0F1115" }}>{entry.section}</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{entry.subtype}</span>
        </div>
        <button className="btn" onClick={startEdit} style={{ padding: "4px 10px", fontSize: 11.5 }}>Edit question</button>
      </div>

      {entry.passage && (
        <div style={{ marginBottom: 14, border: "1px solid var(--border)", borderRadius: 5, background: "var(--panel2)", padding: 12, maxHeight: 260, overflowY: "auto", fontSize: 13 }}>
          {entry.passage}
        </div>
      )}

      {imageUrl ? (
        <img src={imageUrl} alt="Question" style={{ maxWidth: "100%", borderRadius: 5, marginBottom: 12 }} />
      ) : (
        <div style={{ fontSize: 14.5, marginBottom: 14, whiteSpace: "pre-wrap" }}>{entry.questionText}</div>
      )}

      {blanks.map((b, bi) => (
        <div key={bi} style={{ marginBottom: 20 }}>
          {b.label && <div style={{ fontSize: 12, color: accent, fontWeight: 700, marginBottom: 8 }}>{b.label}</div>}
          {blankIsCheckbox(b) && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".03em" }}>Select all that apply</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {b.options.map((opt, i) => {
              const { border, bg } = optionColors(b, bi, i);
              return (
                <button key={i} onClick={() => toggleSelect(bi, i)} disabled={checked}
                  style={{ textAlign: "left", padding: "10px 12px", borderRadius: 5, border: `1px solid ${border}`, background: bg, color: "var(--text)", fontSize: 13.5 }}>
                  <span style={{ fontWeight: 700, marginRight: 8, color: accent }}>{letter(i)}</span>{opt}
                </button>
              );
            })}
          </div>

          {checked && (
            <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 8, color: isBlankCorrect(b, bi) ? "var(--sage)" : "var(--red)" }}>
              {isBlankCorrect(b, bi) ? "Correct" : `Incorrect — correct: ${(b.correctIndices || []).map((i) => letter(i)).join(", ")}`}
            </div>
          )}
          {checked && solutionVisible && solution && solution[bi] && (
            <div style={{ fontSize: 12.5, marginTop: 8, padding: 10, borderRadius: 5, background: "var(--panel2)", border: "1px solid var(--border)", lineHeight: 1.5 }}>
              {solution[bi]}
            </div>
          )}
        </div>
      ))}

      {!checked && (
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-primary" onClick={() => setChecked(true)} disabled={!allSelected}>Check answer</button>
          <button className="btn" onClick={onSkip}>Skip</button>
        </div>
      )}
      {checked && (
        <>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: allCorrect ? "var(--sage)" : "var(--red)", marginBottom: 14 }}>
            {allCorrect ? "✓ Correct" : "✗ Incorrect"}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: solutionError ? 8 : 0 }}>
            <button className="btn btn-primary" onClick={() => onFinish({ correct: allCorrect })}>Next question</button>
            {solutionVisible ? (
              <button className="btn" onClick={() => setSolutionVisible(false)}>Hide solution</button>
            ) : (
              <button className="btn" onClick={loadSolution} disabled={loadingSolution}>{loadingSolution ? "Loading solution…" : "Show solution"}</button>
            )}
          </div>
          {solutionError && <div style={{ fontSize: 12, color: "var(--red)" }}>{solutionError}</div>}
        </>
      )}
    </div>
  );
}
