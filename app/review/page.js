"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { listEntries, updateEntry, getScreenshotUrl } from "@/lib/entries";

const INTERVALS = [1, 3, 7, 14, 30];

function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function ReviewPage() {
  const [entries, setEntries] = useState(null);
  const [current, setCurrent] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [blanks, setBlanks] = useState(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState("");
  const [selections, setSelections] = useState({});
  const [checked, setChecked] = useState(false);

  const refresh = () => listEntries().then(setEntries);
  useEffect(() => { refresh(); }, []);

  const due = useMemo(() => {
    if (!entries) return [];
    const today = todayISO();
    return entries.filter((e) => !e.mastered && e.nextReview <= today);
  }, [entries]);

  const pickNext = async (excludeId) => {
    const pool = due.filter((e) => e.id !== excludeId);
    const next = pool[0] || null;
    setCurrent(next);
    setBlanks(null);
    setSelections({});
    setChecked(false);
    setError("");
    setImageUrl(null);
    if (!next) return;

    if (next.hasImage && next.imagePath) {
      getScreenshotUrl(next.imagePath).then(setImageUrl).catch(() => {});
    }

    if (next.blanks) {
      setBlanks(next.blanks);
      return;
    }
    setLoadingOptions(true);
    try {
      let signedUrl = null;
      if (next.hasImage && next.imagePath) {
        signedUrl = await getScreenshotUrl(next.imagePath).catch(() => null);
      }
      const res = await fetch("/api/extract-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry: next, image: null, imageUrl: signedUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBlanks(data.blanks);
      await updateEntry(next.id, { blanks: data.blanks });
    } catch (e) {
      setError(e.message || "Couldn't extract answer choices");
    } finally {
      setLoadingOptions(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pickNext does async work (fetches answer options), not just derived state
    if (due.length > 0 && !current) pickNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due]);

  const toggleSelect = (bi, i) => {
    if (checked) return;
    const isMultiSelect = current.subtype === "Sentence Equivalence";
    setSelections((prev) => {
      const cur = prev[bi] || [];
      let next;
      if (isMultiSelect) next = cur.includes(i) ? cur.filter((x) => x !== i) : (cur.length < 2 ? [...cur, i] : cur);
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

  const handleNext = async (gotIt) => {
    const totalAttempts = (current.totalAttempts || 0) + 1;
    const wrongAttempts = (current.wrongAttempts || 0) + (gotIt ? 0 : 1);
    if (gotIt) {
      const nextCount = current.reviewCount + 1;
      const interval = INTERVALS[Math.min(nextCount - 1, INTERVALS.length - 1)];
      await updateEntry(current.id, { reviewCount: nextCount, lastReviewed: todayISO(), nextReview: addDays(todayISO(), interval), mastered: nextCount >= INTERVALS.length, totalAttempts, wrongAttempts });
    } else {
      await updateEntry(current.id, { reviewCount: 0, lastReviewed: todayISO(), nextReview: addDays(todayISO(), 1), mastered: false, totalAttempts, wrongAttempts });
    }
    await refresh();
    pickNext(current.id);
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

  if (!current) return <AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>;

  const accent = current.section === "Quant" ? "var(--quant)" : "var(--verbal)";

  return (
    <AppShell>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>{due.length} due</div>
      <div className="card" style={{ padding: 18, borderLeft: `3px solid ${accent}` }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <span className="pill" style={{ background: accent, color: "#0F1115" }}>{current.section}</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{current.subtype}</span>
        </div>

        {current.passage && (
          <div style={{ marginBottom: 14, border: "1px solid var(--border)", borderRadius: 5, background: "var(--panel2)", padding: 12, maxHeight: 260, overflowY: "auto", fontSize: 13 }}>
            {current.passage}
          </div>
        )}

        {imageUrl ? (
          <img src={imageUrl} alt="Question" style={{ maxWidth: "100%", borderRadius: 5, marginBottom: 12 }} />
        ) : (
          <div style={{ fontSize: 14.5, marginBottom: 14, whiteSpace: "pre-wrap" }}>{current.questionText}</div>
        )}

        {loadingOptions && <div style={{ fontSize: 13, color: "var(--muted)" }}>Reading answer choices…</div>}
        {error && <div style={{ fontSize: 12.5, color: "var(--red)" }}>{error}</div>}

        {blanks && blanks.map((b, bi) => {
          const sel = selections[bi] || [];
          return (
            <div key={bi} style={{ marginBottom: 16 }}>
              {b.label && <div style={{ fontSize: 12, color: accent, fontWeight: 700, marginBottom: 8 }}>{b.label}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {b.options.map((opt, i) => {
                  const isSelected = sel.includes(i);
                  const isCorrectOpt = checked && (b.correctIndices || []).includes(i);
                  const isWrongPick = checked && isSelected && !isCorrectOpt;
                  let border = isSelected ? accent : "var(--border)";
                  let bg = isSelected ? "var(--panel2)" : "transparent";
                  if (checked) {
                    if (isCorrectOpt) { border = "var(--sage)"; bg = "rgba(107,144,128,0.15)"; }
                    else if (isWrongPick) { border = "var(--red)"; bg = "rgba(193,85,75,0.15)"; }
                  }
                  return (
                    <button key={i} onClick={() => toggleSelect(bi, i)} disabled={checked}
                      style={{ textAlign: "left", padding: "10px 12px", borderRadius: 5, border: `1px solid ${border}`, background: bg, color: "var(--text)", fontSize: 13.5 }}>
                      <span style={{ fontWeight: 700, marginRight: 8, color: accent }}>{String.fromCharCode(65 + i)}</span>{opt}
                    </button>
                  );
                })}
              </div>
              {checked && (
                <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 8, color: isBlankCorrect(b, bi) ? "var(--sage)" : "var(--red)" }}>
                  {isBlankCorrect(b, bi) ? "Correct" : `Incorrect — correct: ${(b.correctIndices || []).map((i) => String.fromCharCode(65 + i)).join(", ")}`}
                </div>
              )}
            </div>
          );
        })}

        {blanks && !checked && (
          <button className="btn btn-primary" onClick={() => setChecked(true)} disabled={!allSelected}>Check answer</button>
        )}

        {checked && (
          <>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: allCorrect ? "var(--sage)" : "var(--red)", marginBottom: 14 }}>
              {allCorrect ? "✓ Correct" : "✗ Incorrect"}
            </div>
            <button className="btn btn-primary" onClick={() => handleNext(allCorrect)}>Next question</button>
          </>
        )}
      </div>
    </AppShell>
  );
}
