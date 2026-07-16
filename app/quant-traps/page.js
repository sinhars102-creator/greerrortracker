"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase/client";
import { listQuantTraps, createQuantTrap, deleteQuantTrap } from "@/lib/entries";

const emptyForm = { trapName: "", whatHappened: "", correctRule: "", checkpoint: "" };

export default function QuantTrapsPage() {
  const [traps, setTraps] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const refresh = () => listQuantTraps().then(setTraps);
  useEffect(() => { refresh(); }, []);

  const submit = async () => {
    if (!form.trapName.trim()) return;
    setSubmitting(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await createQuantTrap({ ...form, source: "user" }, user.id);
    setForm(emptyForm);
    setAdding(false);
    setSubmitting(false);
    refresh();
  };

  const del = async (id) => {
    await deleteQuantTrap(id);
    refresh();
  };

  if (!traps) return <AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>;

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>{traps.length} trap{traps.length === 1 ? "" : "s"}</div>
        <button className="btn btn-primary" onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "+ Add trap"}</button>
      </div>

      {adding && (
        <div className="card" style={{ padding: 18, marginBottom: 16 }}>
          <div style={{ marginBottom: 12 }}><label>Trap name</label><input value={form.trapName} onChange={(e) => setForm((f) => ({ ...f, trapName: e.target.value }))} /></div>
          <div style={{ marginBottom: 12 }}><label>What happened</label><textarea rows={2} value={form.whatHappened} onChange={(e) => setForm((f) => ({ ...f, whatHappened: e.target.value }))} /></div>
          <div style={{ marginBottom: 12 }}><label>Correct rule</label><textarea rows={2} value={form.correctRule} onChange={(e) => setForm((f) => ({ ...f, correctRule: e.target.value }))} /></div>
          <div style={{ marginBottom: 14 }}><label>Checkpoint (optional)</label><input value={form.checkpoint} onChange={(e) => setForm((f) => ({ ...f, checkpoint: e.target.value }))} /></div>
          <button className="btn btn-primary" onClick={submit} disabled={!form.trapName.trim() || submitting}>{submitting ? "Saving…" : "Save"}</button>
        </div>
      )}

      {traps.length === 0 && !adding ? (
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, marginBottom: 6 }}>No quant traps yet.</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>These get auto-detected when you log a mistake caused by a recurring conceptual or formula error, or add one manually.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {traps.map((t) => (
            <div key={t.id} className="card" style={{ padding: 14, borderLeft: "3px solid var(--quant)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span className="serif" style={{ fontSize: 16, fontWeight: 700 }}>{t.trapName}</span>
                    <span className="pill" style={{ background: t.source === "auto" ? "var(--quant)" : "var(--border)", color: t.source === "auto" ? "#0F1115" : "var(--muted)" }}>
                      {t.source === "auto" ? "auto-detected" : "user"}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                    {t.whatHappened && <div><span style={{ color: "var(--red)" }}>What happened:</span> {t.whatHappened}</div>}
                    {t.correctRule && <div><span style={{ color: "var(--sage)" }}>Correct rule:</span> {t.correctRule}</div>}
                    {t.checkpoint && <div style={{ color: "var(--amber)", marginTop: 4 }}>Checkpoint: {t.checkpoint}</div>}
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
