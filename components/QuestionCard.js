"use client";

import { useEffect, useState } from "react";
import { getScreenshotUrl } from "@/lib/entries";

const TRAP_TAGS = ["Out of Scope", "Too Extreme", "Reverses Meaning", "Right Words/Wrong Reason", "Distorts a Detail", "Not Mentioned", "Other"];
const letter = (i) => String.fromCharCode(65 + i);

/**
 * Renders one question in either "quick" (pick + instant check) or "deep"
 * (reasoning + trap tags, graded by /api/grade) mode. Owns all UI state for
 * the current attempt; delegates all persistence to the parent via callbacks
 * so Review and Practice Arena can each decide what stats to update.
 *
 * The parent must render this with `key={entry.id}` so React remounts it
 * (and so all state below resets to its initial value) whenever the
 * question changes, instead of manually resetting state in an effect.
 */
export default function QuestionCard({ entry, mode, onBlanksExtracted, onFinish, onSkip }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [blanks, setBlanks] = useState(entry.blanks || null);
  const [loadingBlanks, setLoadingBlanks] = useState(!entry.blanks);
  const [error, setError] = useState("");

  const [selections, setSelections] = useState({});
  const [checked, setChecked] = useState(false);

  const [reasons, setReasons] = useState({});
  const [rejectionTags, setRejectionTags] = useState({});
  const [closestTraps, setClosestTraps] = useState({});
  const [rejectionElaboration, setRejectionElaboration] = useState({});
  const [grading, setGrading] = useState(false);
  const [gradeResult, setGradeResult] = useState(null);
  const [gradeError, setGradeError] = useState("");

  const isVerbal = entry.section === "Verbal";
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
    if (checked || gradeResult) return;
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

  const setTag = (bi, i, tag) => {
    setRejectionTags((prev) => ({ ...prev, [bi]: { ...(prev[bi] || {}), [i]: tag } }));
  };

  const toggleStar = (bi, i) => {
    setClosestTraps((prev) => {
      const cur = prev[bi] || [];
      if (cur.includes(i)) return { ...prev, [bi]: cur.filter((x) => x !== i) };
      if (cur.length >= 2) return prev;
      return { ...prev, [bi]: [...cur, i] };
    });
  };

  const setElaboration = (bi, i, text) => {
    setRejectionElaboration((prev) => ({ ...prev, [bi]: { ...(prev[bi] || {}), [i]: text } }));
  };

  const allSelected = blanks && blanks.every((b, bi) => (selections[bi] || []).length > 0);
  const allCorrect = checked && blanks && blanks.every((b, bi) => isBlankCorrect(b, bi));
  const allReasonsFilled = blanks && blanks.every((b, bi) => (reasons[bi] || "").trim().length > 0);

  const submitDeep = async () => {
    setGrading(true);
    setGradeError("");
    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry: { section: entry.section, subtype: entry.subtype, questionText: entry.questionText, passage: entry.passage },
          blanks,
          selections,
          reasons,
          rejectionTags,
          closestTraps,
          rejectionElaboration,
          isVerbal,
          image: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setGradeResult(data);
    } catch (e) {
      setGradeError(e.message || "Grading failed");
    } finally {
      setGrading(false);
    }
  };

  const optionColors = (b, bi, i) => {
    const sel = selections[bi] || [];
    const isSelected = sel.includes(i);
    const revealed = checked || !!gradeResult;
    const isCorrectOpt = revealed && (b.correctIndices || []).includes(i);
    const isWrongPick = revealed && isSelected && !isCorrectOpt;
    let border = isSelected ? accent : "var(--border)";
    let bg = isSelected ? "var(--panel2)" : "transparent";
    if (revealed) {
      if (isCorrectOpt) { border = "var(--sage)"; bg = "rgba(107,144,128,0.15)"; }
      else if (isWrongPick) { border = "var(--red)"; bg = "rgba(193,85,75,0.15)"; }
    }
    return { border, bg };
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

  return (
    <div className="card" style={{ padding: 18, borderLeft: `3px solid ${accent}` }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <span className="pill" style={{ background: accent, color: "#0F1115" }}>{entry.section}</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{entry.subtype}</span>
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

      {blanks.map((b, bi) => {
        const blankResult = gradeResult?.blankResults?.find((r) => r.blankIndex === bi);
        const sel = selections[bi] || [];
        const starred = closestTraps[bi] || [];
        return (
          <div key={bi} style={{ marginBottom: 20 }}>
            {b.label && <div style={{ fontSize: 12, color: accent, fontWeight: 700, marginBottom: 8 }}>{b.label}</div>}
            {blankIsCheckbox(b) && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".03em" }}>Select all that apply</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: mode === "deep" && allSelected ? 12 : 0 }}>
              {b.options.map((opt, i) => {
                const { border, bg } = optionColors(b, bi, i);
                return (
                  <button key={i} onClick={() => toggleSelect(bi, i)} disabled={checked || !!gradeResult}
                    style={{ textAlign: "left", padding: "10px 12px", borderRadius: 5, border: `1px solid ${border}`, background: bg, color: "var(--text)", fontSize: 13.5 }}>
                    <span style={{ fontWeight: 700, marginRight: 8, color: accent }}>{letter(i)}</span>{opt}
                  </button>
                );
              })}
            </div>

            {/* Quick mode reveal */}
            {mode === "quick" && checked && (
              <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 8, color: isBlankCorrect(b, bi) ? "var(--sage)" : "var(--red)" }}>
                {isBlankCorrect(b, bi) ? "Correct" : `Incorrect — correct: ${(b.correctIndices || []).map((i) => letter(i)).join(", ")}`}
              </div>
            )}

            {/* Deep mode: reasoning + trap tags, before grading */}
            {mode === "deep" && allSelected && !gradeResult && (
              <div>
                <label>Why did you pick this?</label>
                <textarea rows={2} value={reasons[bi] || ""} onChange={(e) => setReasons((p) => ({ ...p, [bi]: e.target.value }))} style={{ marginBottom: 10 }} />

                {isVerbal && (
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Tag why each other option is wrong — star up to 2 as the closest trap</div>
                    {b.options.map((opt, i) => {
                      if (sel.includes(i)) return null;
                      const isStarred = starred.includes(i);
                      return (
                        <div key={i} style={{ marginBottom: 10, padding: 10, border: "1px solid var(--border)", borderRadius: 5, background: "var(--panel2)" }}>
                          <div style={{ fontSize: 12.5, marginBottom: 6 }}><b style={{ color: accent }}>{letter(i)}</b> {opt}</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                            {TRAP_TAGS.map((tag) => {
                              const active = rejectionTags[bi]?.[i] === tag;
                              return (
                                <button key={tag} onClick={() => setTag(bi, i, tag)} className="pill"
                                  style={{ cursor: "pointer", border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`, background: active ? "var(--amber)" : "transparent", color: active ? "#0F1115" : "var(--muted)" }}>
                                  {tag}
                                </button>
                              );
                            })}
                          </div>
                          <button onClick={() => toggleStar(bi, i)}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: isStarred ? "var(--amber)" : "var(--faint)" }}>
                            {isStarred ? "★" : "☆"} closest trap
                          </button>
                          {isStarred && (
                            <textarea rows={2} placeholder="Why is this the closest trap?" style={{ marginTop: 6 }}
                              value={rejectionElaboration[bi]?.[i] || ""} onChange={(e) => setElaboration(bi, i, e.target.value)} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Deep mode: graded feedback */}
            {mode === "deep" && gradeResult && blankResult && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6, color: blankResult.correct ? "var(--sage)" : "var(--red)" }}>
                  {blankResult.correct ? "✓ Correct" : `✗ Incorrect — correct: ${(b.correctIndices || []).map((i) => letter(i)).join(", ")}`}
                </div>

                {blankResult.selectionCorrection ? (
                  <div style={{ fontSize: 12.5, padding: 10, borderRadius: 5, background: "rgba(193,85,75,0.12)", border: "1px solid var(--red)", marginBottom: 8, lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 700, color: "var(--red)", marginBottom: 4 }}>Reasoning</div>
                    {blankResult.selectionVerdict && <div style={{ marginBottom: 4 }}>{blankResult.selectionVerdict}</div>}
                    <div>{blankResult.selectionCorrection}</div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: "var(--sage)", marginBottom: 8 }}>✓ {blankResult.selectionVerdict || "Reasoning checks out."}</div>
                )}

                {isVerbal && blankResult.perOption && blankResult.perOption.length > 0 && (() => {
                  const correct = blankResult.perOption.filter((p) => p.tagCorrect === true);
                  const mistagged = blankResult.perOption.filter((p) => p.tagCorrect !== true);
                  return (
                    <>
                      {correct.length > 0 && (
                        <div style={{ fontSize: 12, color: "var(--sage)", marginBottom: 6 }}>
                          ✓ correctly tagged: {correct.map((p) => letter(p.index)).join(", ")}
                        </div>
                      )}
                      {mistagged.map((p) => (
                        <div key={p.index} style={{ fontSize: 12.5, padding: 10, borderRadius: 5, background: "rgba(193,85,75,0.12)", border: "1px solid var(--red)", marginBottom: 6, lineHeight: 1.5 }}>
                          <div style={{ fontWeight: 700, color: "var(--red)", marginBottom: 4 }}>
                            {letter(p.index)}: tagged &quot;{p.tagGiven || "no tag"}&quot; — should be &quot;{p.correctTag || "?"}&quot;
                          </div>
                          {p.correction && <div style={{ marginBottom: 4 }}>{p.correction}</div>}
                          {p.elaborationVerdict && <div style={{ color: "var(--muted)" }}>{p.elaborationVerdict}</div>}
                        </div>
                      ))}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}

      {mode === "quick" && !checked && (
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-primary" onClick={() => setChecked(true)} disabled={!allSelected}>Check answer</button>
          <button className="btn" onClick={onSkip}>Skip</button>
        </div>
      )}
      {mode === "quick" && checked && (
        <>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: allCorrect ? "var(--sage)" : "var(--red)", marginBottom: 14 }}>
            {allCorrect ? "✓ Correct" : "✗ Incorrect"}
          </div>
          <button className="btn btn-primary" onClick={() => onFinish({ correct: allCorrect, gradeResult: null, deepAttempt: null })}>Next question</button>
        </>
      )}

      {mode === "deep" && !gradeResult && (
        <>
          {gradeError && <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 10 }}>{gradeError}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-primary" onClick={submitDeep} disabled={!allSelected || !allReasonsFilled || grading}>
              {grading ? "Grading…" : "Submit for grading"}
            </button>
            <button className="btn" onClick={onSkip} disabled={grading}>Skip</button>
          </div>
        </>
      )}
      {mode === "deep" && gradeResult && (
        <button className="btn btn-primary" onClick={() => onFinish({
          correct: gradeResult.answerCorrect,
          gradeResult,
          deepAttempt: { selections, reasons, rejectionTags, closestTraps, rejectionElaboration },
        })}>Next question</button>
      )}
    </div>
  );
}
