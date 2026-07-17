"use client";

import { useState, useRef, useEffect } from "react";
import AppShell from "@/components/AppShell";
import ImageLightbox from "@/components/ImageLightbox";
import { createClient } from "@/lib/supabase/client";
import { createEntry, updateEntry, uploadScreenshot, compressImageDataUrl, dataUrlToBlobAndParts, listEntries, findWordTrapByWord, createWordTrap, findQuantTrapByName, createQuantTrap } from "@/lib/entries";

const QUANT_SUBTYPES = ["Arithmetic", "Algebra", "Geometry", "Number Properties", "Word Problems", "Data Interpretation", "Probability & Combinatorics", "Quantitative Comparison"];
const VERBAL_SUBTYPES = ["Sentence Equivalence", "Text Completion", "Reading Comprehension", "Vocabulary"];

const emptyForm = { section: "Quant", subtype: QUANT_SUBTYPES[0], questionText: "", passage: "", yourAnswer: "", correctAnswer: "", notes: "", tags: "" };

export default function LogPage() {
  const [form, setForm] = useState(emptyForm);
  const [imageDataUrl, setImageDataUrl] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [rcQuestions, setRcQuestions] = useState([]);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const fileRef = useRef(null);
  const rcFileRef = useRef(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const isRC = form.subtype === "Reading Comprehension";

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const compressed = await compressImageDataUrl(reader.result, 1600, 0.85);
      setImageDataUrl(compressed);
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        handleFile(item.getAsFile());
        break;
      }
    }
  };

  // --- Reading Comprehension batch mode: one shared passage, N question
  // screenshots, each becoming its own entry (a passage typically has 2-3
  // questions asked in sequence, each a distinct mistake). ---

  const addRCFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    // Generated synchronously (not inside the async onload below) so it's
    // immune to ordering/timing across overlapping reads — a shared counter
    // incremented inside an async callback isn't safe for React keys.
    const localId = crypto.randomUUID();
    const reader = new FileReader();
    reader.onload = async () => {
      const compressed = await compressImageDataUrl(reader.result, 1600, 0.85);
      setRcQuestions((prev) => [...prev, { localId, imageDataUrl: compressed, yourAnswer: "", correctAnswer: "", notes: "" }]);
    };
    reader.readAsDataURL(file);
  };

  const handleRCPaste = (e) => {
    // Only take the first image item, same as the single-screenshot paste
    // handler below — a single paste can carry the same image as multiple
    // clipboard representations (e.g. both PNG and TIFF on macOS), and
    // processing all of them would add duplicate cards for one screenshot.
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        addRCFile(item.getAsFile());
        break;
      }
    }
  };

  const handleRCDrop = (e) => {
    e.preventDefault();
    Array.from(e.dataTransfer.files || []).forEach(addRCFile);
  };

  const updateRCQuestion = (localId, patch) => {
    setRcQuestions((prev) => prev.map((q) => (q.localId === localId ? { ...q, ...patch } : q)));
  };

  const removeRCQuestion = (localId) => {
    setRcQuestions((prev) => prev.filter((q) => q.localId !== localId));
  };

  const submit = async () => {
    if (!form.questionText.trim() && !imageDataUrl) return;
    setSubmitting(true);
    setSavedMsg("");

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // 1. Create the entry immediately with whatever we have — never block on classification.
    const entry = await createEntry({
      section: form.section,
      subtype: form.subtype,
      questionText: form.questionText.trim() || (imageDataUrl ? "(analyzing…)" : ""),
      passage: form.passage.trim(),
      yourAnswer: form.yourAnswer,
      correctAnswer: form.correctAnswer,
      notes: form.notes,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      mistakeTypes: ["Analyzing"],
      hasImage: false, // set true once/if the upload succeeds
      pending: true,
    }, user.id);

    const formSnapshot = { ...form };
    const imageSnapshot = imageDataUrl;
    setForm({ ...emptyForm, section: form.section, subtype: form.section === "Quant" ? QUANT_SUBTYPES[0] : VERBAL_SUBTYPES[0] });
    setImageDataUrl(null);
    setSubmitting(false);
    setSavedMsg("Logged — classifying in the background.");
    setTimeout(() => setSavedMsg(""), 4000);

    // 2. Upload the screenshot in the background (independent of classification succeeding).
    if (imageSnapshot) {
      const parts = dataUrlToBlobAndParts(imageSnapshot);
      uploadScreenshot(user.id, entry.id, parts.blob)
        .then((path) => updateEntry(entry.id, { hasImage: true, imagePath: path }))
        .catch(() => {}); // classification below doesn't depend on this succeeding
    }

    // 3. Classify in the background using the in-memory image regardless of upload success.
    (async () => {
      try {
        const priorEntries = (await listEntries())
          .filter((e) => e.id !== entry.id)
          .slice(0, 60)
          .map((e) => ({ id: e.id, section: e.section, subtype: e.subtype, mistakeTypes: e.mistakeTypes, notes: (e.notes || "").slice(0, 220) }));

        const image = imageSnapshot ? dataUrlToBlobAndParts(imageSnapshot) : null;
        const res = await fetch("/api/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            form: formSnapshot,
            priorEntries,
            image: image ? { mediaType: image.mediaType, base64: image.base64 } : null,
          }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "classification failed");

        await updateEntry(entry.id, {
          questionText: formSnapshot.questionText.trim() || result.questionText || "(see screenshot)",
          passage: formSnapshot.passage.trim() || result.passage || "",
          mistakeTypes: result.mistakeTypes.length ? result.mistakeTypes : ["Concept Gap"],
          insight: result.insight,
          relatedEntryIds: result.relatedEntryIds,
          pending: false,
        });

        if (result.wordTrap?.word) {
          const existing = await findWordTrapByWord(result.wordTrap.word).catch(() => null);
          if (!existing) {
            await createWordTrap({
              word: result.wordTrap.word,
              literalMeaning: result.wordTrap.literalMeaning,
              actualMeaning: result.wordTrap.actualMeaning,
              source: "auto",
              linkedEntryId: entry.id,
            }, user.id).catch(() => {});
          }
        }
        if (result.quantTrap?.trapName) {
          const existing = await findQuantTrapByName(result.quantTrap.trapName).catch(() => null);
          if (!existing) {
            await createQuantTrap({
              trapName: result.quantTrap.trapName,
              whatHappened: result.quantTrap.whatHappened,
              correctRule: result.quantTrap.correctRule,
              checkpoint: result.quantTrap.checkpoint,
              source: "auto",
              linkedEntryId: entry.id,
            }, user.id).catch(() => {});
          }
        }
        // NOTE: backref updates on related entries (repeatedByIds) are
        // straightforward to add here following the same pattern — see README roadmap.
      } catch (e) {
        await updateEntry(entry.id, { mistakeTypes: ["Uncategorized"], pending: false }).catch(() => {});
      }
    })();
  };

  const submitRCBatch = async () => {
    if (rcQuestions.length === 0) return;
    setSubmitting(true);
    setSavedMsg("");

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const sharedPassage = form.passage.trim();
    const questionsSnapshot = rcQuestions;

    // 1. Create every entry immediately, marked pending — same "save first,
    // enrich later" pattern as the single-screenshot flow, just per question.
    const created = [];
    for (const q of questionsSnapshot) {
      const entry = await createEntry({
        section: "Verbal",
        subtype: "Reading Comprehension",
        questionText: "(analyzing…)",
        passage: sharedPassage,
        yourAnswer: q.yourAnswer,
        correctAnswer: q.correctAnswer,
        notes: q.notes,
        tags: [],
        mistakeTypes: ["Analyzing"],
        hasImage: false,
        pending: true,
      }, user.id);
      created.push({ entry, q });
    }

    setRcQuestions([]);
    setForm((f) => ({ ...f, passage: "" }));
    setSubmitting(false);
    setSavedMsg(`Logged ${created.length} mistake${created.length > 1 ? "s" : ""} — classifying in the background.`);
    setTimeout(() => setSavedMsg(""), 4000);

    // 2 & 3. Upload + classify each question independently and concurrently.
    created.forEach(({ entry, q }) => {
      const parts = dataUrlToBlobAndParts(q.imageDataUrl);
      uploadScreenshot(user.id, entry.id, parts.blob)
        .then((path) => updateEntry(entry.id, { hasImage: true, imagePath: path }))
        .catch(() => {});

      (async () => {
        try {
          const priorEntries = (await listEntries())
            .filter((e) => e.id !== entry.id)
            .slice(0, 60)
            .map((e) => ({ id: e.id, section: e.section, subtype: e.subtype, mistakeTypes: e.mistakeTypes, notes: (e.notes || "").slice(0, 220) }));

          const image = dataUrlToBlobAndParts(q.imageDataUrl);
          const res = await fetch("/api/classify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              form: { section: "Verbal", subtype: "Reading Comprehension", questionText: "", passage: sharedPassage, yourAnswer: q.yourAnswer, correctAnswer: q.correctAnswer, notes: q.notes },
              priorEntries,
              image: { mediaType: image.mediaType, base64: image.base64 },
            }),
          });
          const result = await res.json();
          if (!res.ok) throw new Error(result.error || "classification failed");

          await updateEntry(entry.id, {
            questionText: result.questionText || "(see screenshot)",
            passage: sharedPassage || result.passage || "",
            mistakeTypes: result.mistakeTypes.length ? result.mistakeTypes : ["Concept Gap"],
            insight: result.insight,
            relatedEntryIds: result.relatedEntryIds,
            pending: false,
          });

          if (result.wordTrap?.word) {
            const existing = await findWordTrapByWord(result.wordTrap.word).catch(() => null);
            if (!existing) {
              await createWordTrap({
                word: result.wordTrap.word,
                literalMeaning: result.wordTrap.literalMeaning,
                actualMeaning: result.wordTrap.actualMeaning,
                source: "auto",
                linkedEntryId: entry.id,
              }, user.id).catch(() => {});
            }
          }
        } catch (e) {
          await updateEntry(entry.id, { mistakeTypes: ["Uncategorized"], pending: false }).catch(() => {});
        }
      })();
    });
  };

  const subtypes = form.section === "Quant" ? QUANT_SUBTYPES : VERBAL_SUBTYPES;

  const selectSubtype = (s) => {
    set("subtype", s);
    if (s !== "Reading Comprehension") setRcQuestions([]);
  };

  return (
    <AppShell>
      <div className="card" style={{ padding: 22 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          {["Quant", "Verbal"].map((s) => (
            <button key={s} className="btn" disabled={submitting}
              style={{ flex: 1, background: form.section === s ? (s === "Quant" ? "var(--quant)" : "var(--verbal)") : "var(--panel2)", color: form.section === s ? "#0F1115" : "var(--text)", fontWeight: form.section === s ? 700 : 400 }}
              onClick={() => { set("section", s); selectSubtype(s === "Quant" ? QUANT_SUBTYPES[0] : VERBAL_SUBTYPES[0]); }}>
              {s}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label>Question type</label>
          <select value={form.subtype} onChange={(e) => selectSubtype(e.target.value)} disabled={submitting}>
            {subtypes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {isRC ? (
          <>
            <div style={{ marginBottom: 14 }}>
              <label>Passage — shared across every question below</label>
              <textarea rows={6} value={form.passage} onChange={(e) => set("passage", e.target.value)} disabled={submitting}
                placeholder="Leave blank to have it transcribed automatically from the first screenshot's classification." />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label>Question screenshots — one per question, 2-3 in a typical set</label>
              <div
                tabIndex={0}
                onPaste={handleRCPaste}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleRCDrop}
                style={{ border: "1px dashed var(--border)", borderRadius: 6, padding: 16, textAlign: "center", background: "var(--panel2)" }}
              >
                <input ref={rcFileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                  onChange={(e) => { Array.from(e.target.files || []).forEach(addRCFile); e.target.value = ""; }} />
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  Paste (Ctrl/Cmd+V), drag files here, or
                  <div style={{ marginTop: 10 }}>
                    <button className="btn btn-primary" onClick={() => rcFileRef.current?.click()} disabled={submitting}>Add screenshot(s)</button>
                  </div>
                </div>
              </div>
            </div>

            {rcQuestions.map((q, i) => (
              <div key={q.localId} className="card" style={{ padding: 14, marginBottom: 14, background: "var(--panel2)" }}>
                <div style={{ display: "flex", gap: 14 }}>
                  <img src={q.imageDataUrl} alt={`Question ${i + 1}`} onClick={() => setLightboxSrc(q.imageDataUrl)}
                    style={{ width: 120, height: 90, objectFit: "cover", borderRadius: 4, flexShrink: 0, cursor: "zoom-in" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>Question {i + 1}</div>
                      <button className="btn btn-red" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => removeRCQuestion(q.localId)} disabled={submitting}>Remove</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                      <div>
                        <label>Your answer</label>
                        <input value={q.yourAnswer} onChange={(e) => updateRCQuestion(q.localId, { yourAnswer: e.target.value })} disabled={submitting} />
                      </div>
                      <div>
                        <label>Correct answer</label>
                        <input value={q.correctAnswer} onChange={(e) => updateRCQuestion(q.localId, { correctAnswer: e.target.value })} disabled={submitting} />
                      </div>
                    </div>
                    <label>Why exactly you got it wrong</label>
                    <textarea rows={2} value={q.notes} onChange={(e) => updateRCQuestion(q.localId, { notes: e.target.value })} disabled={submitting} />
                  </div>
                </div>
              </div>
            ))}

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button className="btn btn-primary" onClick={submitRCBatch} disabled={rcQuestions.length === 0 || submitting}>
                {submitting ? "Saving…" : `Log ${rcQuestions.length || ""} mistake${rcQuestions.length === 1 ? "" : "s"}`}
              </button>
              {savedMsg && <span style={{ fontSize: 12, color: "var(--sage)" }}>{savedMsg}</span>}
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <label>Question screenshot</label>
              <div
                tabIndex={0}
                onPaste={handlePaste}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
                style={{ border: "1px dashed var(--border)", borderRadius: 6, padding: 16, textAlign: "center", background: "var(--panel2)" }}
              >
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
                {imageDataUrl ? (
                  <div>
                    <img src={imageDataUrl} alt="Pasted question" onClick={() => setLightboxSrc(imageDataUrl)}
                      style={{ maxWidth: "100%", maxHeight: 240, borderRadius: 4, cursor: "zoom-in" }} />
                    <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "center" }}>
                      <button className="btn" onClick={() => fileRef.current?.click()} disabled={submitting}>Replace</button>
                      <button className="btn btn-red" onClick={() => setImageDataUrl(null)} disabled={submitting}>Remove</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>
                    Paste (Ctrl/Cmd+V), drag a file here, or
                    <div style={{ marginTop: 10 }}>
                      <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={submitting}>Upload screenshot</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label>Question text (optional if you pasted a screenshot)</label>
              <textarea rows={3} value={form.questionText} onChange={(e) => set("questionText", e.target.value)} disabled={submitting} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label>Your answer</label>
                <input value={form.yourAnswer} onChange={(e) => set("yourAnswer", e.target.value)} disabled={submitting} />
              </div>
              <div>
                <label>Correct answer</label>
                <input value={form.correctAnswer} onChange={(e) => set("correctAnswer", e.target.value)} disabled={submitting} />
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label>Why exactly you got it wrong</label>
              <textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} disabled={submitting} />
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button className="btn btn-primary" onClick={submit} disabled={(!form.questionText.trim() && !imageDataUrl) || submitting}>
                {submitting ? "Saving…" : "Log mistake"}
              </button>
              {savedMsg && <span style={{ fontSize: 12, color: "var(--sage)" }}>{savedMsg}</span>}
            </div>
          </>
        )}
      </div>
      <ImageLightbox src={lightboxSrc} alt="Full-size screenshot" onClose={() => setLightboxSrc(null)} />
    </AppShell>
  );
}
