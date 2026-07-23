"use client";

import { useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase/client";
import {
  createEntry, updateEntry, uploadImportPdf, deleteImportPdf, listImportedRefs,
  getCachedPdfScan, savePdfScan, uploadScreenshot, compressImageDataUrl, dataUrlToBlobAndParts,
} from "@/lib/entries";

const eyebrow = { fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" };

// Groups extracted RC companions under their source RC set, keyed by
// section + the printed question-number range, so they get one shared
// rcGroupId and stay ordered when logged.
function rcKey(q) {
  return `${q.sectionNumber}:${q.rcQuestionNumbers.join(",")}`;
}

function parseNumbers(text) {
  return (text || "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
}

// Stable identity for a PDF's content, independent of filename — so
// re-uploading the same document (even renamed) matches previously imported
// entries for dedup purposes. Filename alone would collide across different
// documents and miss matches on renamed ones.
async function hashFile(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function importRefFor(q) {
  return `Section ${q.sectionNumber} Q${q.questionNumberInSection}`;
}

// Parsed once per commit batch and shared across all captured pages, rather
// than re-parsing the whole PDF per question.
async function loadPdfDocument(file) {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const buf = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: buf }).promise;
}

async function renderPdfPageToJpeg(pdfDoc, pageNumber) {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.9);
}

// Best-effort — matches the "save first, enrich in background" pattern used
// by the manual/extension logging flows, which always keep a screenshot.
// Failures here shouldn't block or roll back the entry itself.
async function captureScreenshotForEntry(pdfDocPromise, pageNumber, userId, entryId) {
  if (!pageNumber) return;
  const pdfDoc = await pdfDocPromise;
  const dataUrl = await renderPdfPageToJpeg(pdfDoc, pageNumber);
  const compressed = await compressImageDataUrl(dataUrl, 1600, 0.85);
  const parts = dataUrlToBlobAndParts(compressed);
  const path = await uploadScreenshot(userId, entryId, parts.blob);
  await updateEntry(entryId, { hasImage: true, imagePath: path });
}

export default function ImportPage() {
  const [file, setFile] = useState(null);
  const [pdfPath, setPdfPath] = useState(null);
  const [docHash, setDocHash] = useState(null);
  const [stage, setStage] = useState("upload"); // upload | sections | review
  const [scanning, setScanning] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState("");
  const [sections, setSections] = useState(null);
  const [scanFromCache, setScanFromCache] = useState(false);
  const [sectionInputs, setSectionInputs] = useState({}); // sectionNumber -> raw text
  const [questions, setQuestions] = useState(null); // extracted, pre-commit
  const [alreadyLogged, setAlreadyLogged] = useState({}); // importRef -> created_at, for this doc
  const [included, setIncluded] = useState(() => new Set());
  const [committing, setCommitting] = useState(false);
  const [resultMsg, setResultMsg] = useState("");

  async function handleScan() {
    setError("");
    setResultMsg("");
    if (!file) { setError("Choose a PDF first."); return; }

    setScanning(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const hash = await hashFile(file);
      setDocHash(hash);

      // Already scanned this exact document before (this or a prior
      // session) — reuse its section structure instead of spending another
      // Claude call and an upload on it. The PDF itself gets uploaded lazily
      // in handleExtract, only if it's actually needed.
      const cached = await getCachedPdfScan(hash);
      if (cached) {
        setSections(cached);
        setScanFromCache(true);
        setStage("sections");
        return;
      }

      setScanFromCache(false);
      const path = await uploadImportPdf(user.id, file);
      setPdfPath(path);
      const res = await fetch("/api/import-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfPath: path, mode: "scan" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setSections(data.sections || []);
      await savePdfScan(user.id, hash, file.name, data.sections || []);
      setStage("sections");
    } catch (e) {
      setError(e.message || "Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  async function handleExtract() {
    setError("");
    const selections = sections
      .map((s) => ({ sectionNumber: s.sectionNumber, questionNumbers: parseNumbers(sectionInputs[s.sectionNumber]) }))
      .filter((s) => s.questionNumbers.length > 0);
    if (selections.length === 0) { setError("Enter at least one question number in at least one section."); return; }

    setExtracting(true);
    try {
      // A cached scan skips the upload entirely — do it now, only if this
      // document's bytes aren't already sitting in Storage from this session.
      let path = pdfPath;
      if (!path) {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        path = await uploadImportPdf(user.id, file);
        setPdfPath(path);
      }

      const res = await fetch("/api/import-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfPath: path, mode: "extract", selections }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");
      const qs = data.questions || [];
      const dupes = await listImportedRefs(docHash);
      setAlreadyLogged(dupes);
      setQuestions(qs);
      // Default anything already logged from this same document to
      // unchecked, so a re-scan doesn't silently create duplicate entries —
      // still shown, and still re-checkable if a second copy is wanted.
      setIncluded(new Set(qs.map((_, i) => i).filter((i) => !dupes[importRefFor(qs[i])])));
      setStage("review");
    } catch (e) {
      setError(e.message || "Extraction failed.");
    } finally {
      setExtracting(false);
    }
  }

  function toggleIncluded(i) {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  function startOver() {
    setFile(null);
    setPdfPath(null);
    setDocHash(null);
    setStage("upload");
    setSections(null);
    setScanFromCache(false);
    setSectionInputs({});
    setQuestions(null);
    setAlreadyLogged({});
    setIncluded(new Set());
    setError("");
  }

  async function handleCommit() {
    setCommitting(true);
    setResultMsg("");
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      const toCommit = questions.filter((_, i) => included.has(i));

      // One rcGroupId per distinct RC set among the committed questions.
      const rcGroupIds = new Map();
      for (const q of toCommit) {
        if (q.isRC && !rcGroupIds.has(rcKey(q))) rcGroupIds.set(rcKey(q), crypto.randomUUID());
      }

      // Parsed once, reused for every page screenshot captured below.
      const pdfDocPromise = loadPdfDocument(file);

      let count = 0;
      for (const q of toCommit) {
        const correctAnswer = q.answerLetters && q.answerLetters.length
          ? q.answerLetters.join(", ")
          : (q.answerValue || "");
        const entry = await createEntry({
          section: q.section,
          subtype: q.subtype,
          questionText: q.questionText || "",
          passage: q.passage || "",
          correctAnswer,
          tags: [],
          mistakeTypes: [],
          hasImage: false,
          pending: false,
          importSource: docHash,
          importRef: importRefFor(q),
          ...(q.isRC ? { rcGroupId: rcGroupIds.get(rcKey(q)), rcGroupOrder: q.questionNumberInSection } : {}),
        }, user.id);
        count++;
        captureScreenshotForEntry(pdfDocPromise, q.pdfPage, user.id, entry.id).catch(() => {});
      }

      if (pdfPath) deleteImportPdf(pdfPath);
      setResultMsg(`Logged ${count} question${count === 1 ? "" : "s"}.`);
      startOver();
    } catch (e) {
      setResultMsg(e.message || "Couldn't log some questions.");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={eyebrow}>Import from PDF</div>
        <Link href="/log" className="btn" style={{ fontSize: 12, padding: "8px 14px", textDecoration: "none" }}>
          Log a single mistake instead
        </Link>
      </div>

      {stage === "upload" && (
        <div className="card" style={{ padding: 22, marginTop: 12 }}>
          <div style={{ marginBottom: 14 }}>
            <label>Practice-test PDF</label>
            <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 4 }}>
              It&apos;ll be scanned first so you can pick question numbers section by section — no need to know PDF page numbers.
            </div>
          </div>
          {error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
            {scanning ? "Reading PDF…" : "Scan PDF"}
          </button>
        </div>
      )}

      {stage === "sections" && sections && (
        <div className="card" style={{ padding: 22, marginTop: 12 }}>
          <div className="serif" style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
            {sections.length} section{sections.length === 1 ? "" : "s"} found
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 16 }}>
            Enter which question numbers to log from each section. Leave a section blank to skip it.
            {scanFromCache && " (Recognized this document from a previous scan — skipped re-reading it.)"}
          </div>

          {sections.map((s) => (
            <div key={s.sectionNumber} className="card" style={{ padding: 14, marginBottom: 10, opacity: s.subject === "Essay" ? 0.5 : 1 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <span className="pill">Section {s.sectionNumber}</span>
                <span className="pill">{s.subject}</span>
                <span style={eyebrow}>{s.totalQuestions} question{s.totalQuestions === 1 ? "" : "s"}{s.keyLabel ? ` · ${s.keyLabel}` : ""}</span>
              </div>
              {s.subject !== "Essay" && (
                <input
                  type="text"
                  placeholder="e.g. 1, 5, 9"
                  value={sectionInputs[s.sectionNumber] || ""}
                  onChange={(e) => setSectionInputs((prev) => ({ ...prev, [s.sectionNumber]: e.target.value }))}
                />
              )}
            </div>
          ))}

          {error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-primary" onClick={handleExtract} disabled={extracting}>
              {extracting ? "Reading questions…" : "Extract selected"}
            </button>
            <button className="btn" onClick={startOver} disabled={extracting}>Start over</button>
          </div>
        </div>
      )}

      {stage === "review" && questions && (
        <div className="card" style={{ padding: 22, marginTop: 18 }}>
          <div className="serif" style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
            {questions.length} question{questions.length === 1 ? "" : "s"} found — review before logging
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 16 }}>
            Uncheck anything that looks wrong (wrong answer match, misread number) before committing.
          </div>

          {questions.map((q, i) => (
            <div key={i} className="card" style={{ padding: 14, marginBottom: 10, opacity: included.has(i) ? 1 : 0.5 }}>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", textTransform: "none" }}>
                <input type="checkbox" checked={included.has(i)} onChange={() => toggleIncluded(i)} style={{ width: "auto", marginTop: 3 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                    <span className="pill">{q.section}</span>
                    <span className="pill">{q.subtype}</span>
                    <span style={{ ...eyebrow, alignSelf: "center" }}>
                      page {q.pdfPage}{!q.requested ? " (RC companion)" : ""} · Section {q.sectionNumber}, Q{q.questionNumberInSection} of {q.totalInSection}
                    </span>
                    {alreadyLogged[importRefFor(q)] && (
                      <span className="pill" style={{ background: "var(--amber)", color: "#0F1115" }}>
                        already logged {new Date(alreadyLogged[importRefFor(q)]).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {q.passage && (
                    <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8, maxHeight: 100, overflow: "auto" }}>
                      {q.passage}
                    </div>
                  )}
                  <div style={{ fontSize: 13.5, marginBottom: 6 }}>{q.questionText}</div>
                  {q.options && q.options.length > 0 && (
                    <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>
                      {q.options.map((o, oi) => `${String.fromCharCode(65 + oi)}. ${o}`).join("  ·  ")}
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: "var(--sage)" }}>
                    Answer: {q.answerLetters && q.answerLetters.length ? q.answerLetters.join(", ") : q.answerValue || "—"}
                  </div>
                  {q.issue && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 6 }}>{q.issue}</div>}
                </div>
              </label>
            </div>
          ))}

          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-primary" onClick={handleCommit} disabled={committing || included.size === 0}>
              {committing ? "Logging…" : `Log ${included.size} question${included.size === 1 ? "" : "s"}`}
            </button>
            <button className="btn" onClick={() => setStage("sections")} disabled={committing}>Back</button>
          </div>
        </div>
      )}

      {resultMsg && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 14 }}>{resultMsg}</div>}
    </AppShell>
  );
}
