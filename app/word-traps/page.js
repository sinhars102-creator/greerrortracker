"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase/client";
import { listWordTraps, createWordTrap, deleteWordTrap } from "@/lib/entries";

const emptyForm = { word: "", literalMeaning: "", actualMeaning: "", context: "", note: "" };

export default function WordTrapsPage() {
  const [traps, setTraps] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const refresh = () => listWordTraps().then(setTraps);
  useEffect(() => { refresh(); }, []);

  const submit = async () => {
    if (!form.word.trim()) return;
    setSubmitting(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await createWordTrap({ ...form, source: "user" }, user.id);
    setForm(emptyForm);
    setAdding(false);
    setSubmitting(false);
    refresh();
  };

  const del = async (id) => {
    await deleteWordTrap(id);
    refresh();
  };

  if (!traps) return <AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>;

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>{traps.length} word{traps.length === 1 ? "" : "s"}</div>
        <button className="btn btn-primary" onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "+ Add word"}</button>
      </div>

      {adding && (
        <div className="card" style={{ padding: 18, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label>Word</label><input value={form.word} onChange={(e) => setForm((f) => ({ ...f, word: e.target.value }))} /></div>
            <div><label>Context (optional)</label><input value={form.context} onChange={(e) => setForm((f) => ({ ...f, context: e.target.value }))} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label>You read it as</label><input value={form.literalMeaning} onChange={(e) => setForm((f) => ({ ...f, literalMeaning: e.target.value }))} /></div>
            <div><label>It actually meant</label><input value={form.actualMeaning} onChange={(e) => setForm((f) => ({ ...f, actualMeaning: e.target.value }))} /></div>
          </div>
          <div style={{ marginBottom: 14 }}><label>Note (optional)</label><textarea rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></div>
          <button className="btn btn-primary" onClick={submit} disabled={!form.word.trim() || submitting}>{submitting ? "Saving…" : "Save"}</button>
        </div>
      )}

      {traps.length === 0 && !adding ? (
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, marginBottom: 6 }}>No word traps yet.</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>These get auto-detected when you log a mistake caused by a word&apos;s secondary meaning, or add one manually.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {traps.map((t) => (
            <div key={t.id} className="card" style={{ padding: 14, borderLeft: "3px solid var(--repeat)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span className="serif" style={{ fontSize: 16, fontWeight: 700 }}>{t.word}</span>
                    <span className="pill" style={{ background: t.source === "auto" ? "var(--repeat)" : "var(--border)", color: t.source === "auto" ? "#0F1115" : "var(--muted)" }}>
                      {t.source === "auto" ? "auto-detected" : "user"}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                    <div><span style={{ color: "var(--red)" }}>You read it as:</span> {t.literalMeaning || "—"}</div>
                    <div><span style={{ color: "var(--sage)" }}>It actually meant:</span> {t.actualMeaning || "—"}</div>
                    {t.context && <div style={{ color: "var(--muted)", marginTop: 4 }}>{t.context}</div>}
                    {t.note && <div style={{ color: "var(--amber)", marginTop: 4 }}>{t.note}</div>}
                  </div>
                </div>
                <button className="btn btn-red" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => del(t.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
