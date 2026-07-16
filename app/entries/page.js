"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import { listEntries, updateEntry, deleteEntry as deleteEntryApi, getScreenshotUrl } from "@/lib/entries";

function EntryImage({ path }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getScreenshotUrl(path).then((u) => { if (!cancelled) setUrl(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [path]);
  if (!url) return <div style={{ fontSize: 12, color: "var(--faint)" }}>Loading screenshot…</div>;
  return <img src={url} alt="Screenshot" style={{ maxWidth: "100%", borderRadius: 5, marginBottom: 10, border: "1px solid var(--border)" }} />;
}

export default function EntriesPage() {
  return (
    <Suspense fallback={<AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>}>
      <EntriesPageInner />
    </Suspense>
  );
}

function EntriesPageInner() {
  const searchParams = useSearchParams();
  // Deep-linked from Focus List / Error Buckets / Repeated Errors via ?entry=<id>.
  // A matching card just won't show as expanded if the id turns out to be stale.
  const [expanded, setExpanded] = useState(() => searchParams.get("entry"));
  const [entries, setEntries] = useState(null);
  const [filterSection, setFilterSection] = useState("All");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const refresh = () => listEntries().then(setEntries);
  useEffect(() => { refresh(); }, []);

  const filtered = useMemo(() => {
    if (!entries) return [];
    return entries.filter((e) => {
      if (filterSection !== "All" && e.section !== filterSection) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (!(e.questionText + e.notes + e.subtype).toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [entries, filterSection, search]);

  const startEdit = (e) => {
    setEditingId(e.id);
    setEditForm({ questionText: e.questionText, passage: e.passage || "", yourAnswer: e.yourAnswer, correctAnswer: e.correctAnswer, notes: e.notes });
  };

  const saveEdit = async (id) => {
    await updateEntry(id, editForm);
    setEditingId(null);
    refresh();
  };

  const del = async (id) => {
    await deleteEntryApi(id);
    refresh();
  };

  if (!entries) return <AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>;

  return (
    <AppShell>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <select style={{ width: "auto" }} value={filterSection} onChange={(e) => setFilterSection(e.target.value)}>
          <option value="All">All sections</option>
          <option value="Quant">Quant</option>
          <option value="Verbal">Verbal</option>
        </select>
        <input style={{ width: "auto", flex: 1, minWidth: 160 }} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((e) => {
          const accent = e.section === "Quant" ? "var(--quant)" : "var(--verbal)";
          const isOpen = expanded === e.id;
          const isEditing = editingId === e.id;
          return (
            <div key={e.id} className="card" style={{ padding: 14, borderLeft: `3px solid ${accent}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setExpanded(isOpen ? null : e.id)}>
                <span className="pill" style={{ background: accent, color: "#0F1115" }}>{e.section}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{e.subtype}</span>
                <span style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{e.questionText}</span>
                {e.mastered && <span className="pill" style={{ background: "var(--sage)", color: "#0F1115" }}>mastered</span>}
              </div>
              {isOpen && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", fontSize: 13, lineHeight: 1.6 }}>
                  {e.hasImage && e.imagePath && <EntryImage path={e.imagePath} />}
                  {isEditing ? (
                    <>
                      {(e.subtype === "Reading Comprehension" || editForm.passage) && (
                        <div style={{ marginBottom: 12 }}><label>Passage</label><textarea rows={5} value={editForm.passage} onChange={(ev) => setEditForm((f) => ({ ...f, passage: ev.target.value }))} /></div>
                      )}
                      <div style={{ marginBottom: 12 }}><label>Question</label><textarea rows={3} value={editForm.questionText} onChange={(ev) => setEditForm((f) => ({ ...f, questionText: ev.target.value }))} /></div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <div><label>Your answer</label><input value={editForm.yourAnswer} onChange={(ev) => setEditForm((f) => ({ ...f, yourAnswer: ev.target.value }))} /></div>
                        <div><label>Correct answer</label><input value={editForm.correctAnswer} onChange={(ev) => setEditForm((f) => ({ ...f, correctAnswer: ev.target.value }))} /></div>
                      </div>
                      <div style={{ marginBottom: 14 }}><label>Notes</label><textarea rows={2} value={editForm.notes} onChange={(ev) => setEditForm((f) => ({ ...f, notes: ev.target.value }))} /></div>
                      <div style={{ display: "flex", gap: 10 }}>
                        <button className="btn btn-primary" onClick={() => saveEdit(e.id)}>Save</button>
                        <button className="btn" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      {e.passage && <div style={{ marginBottom: 8, padding: 10, background: "var(--panel2)", borderRadius: 5, fontSize: 12.5 }}>{e.passage}</div>}
                      <div style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}>{e.questionText}</div>
                      <div><span style={{ color: "var(--red)" }}>You picked:</span> {e.yourAnswer || "—"} &nbsp;|&nbsp; <span style={{ color: "var(--sage)" }}>Correct:</span> {e.correctAnswer || "—"}</div>
                      <div style={{ marginTop: 6 }}>
                        {(e.mistakeTypes || []).map((m, i) => <span key={i} className="pill" style={{ background: "var(--border)", color: "var(--text)", marginRight: 5 }}>{m}</span>)}
                        {e.notes}
                      </div>
                      {e.insight && <div style={{ marginTop: 6, color: "var(--amber)" }}>{e.insight}</div>}
                      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--faint)", fontSize: 11 }}>next review: {e.nextReview} · reviewed {e.reviewCount}×</span>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => startEdit(e)}>Edit</button>
                          <button className="btn btn-red" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => del(e.id)}>Delete</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
