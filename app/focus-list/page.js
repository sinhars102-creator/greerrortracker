"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase/client";
import { listEntries, listWordTraps, getFocusList, saveFocusList, updateFocusListItems } from "@/lib/entries";

export default function FocusListPage() {
  const [entries, setEntries] = useState(null);
  const [wordTraps, setWordTraps] = useState(null);
  const [focusList, setFocusList] = useState(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("All");

  useEffect(() => {
    Promise.all([listEntries(), listWordTraps(), getFocusList()]).then(([e, w, f]) => {
      setEntries(e);
      setWordTraps(w);
      setFocusList(f);
    });
  }, []);

  const entryById = useMemo(() => {
    const m = new Map();
    (entries || []).forEach((e) => m.set(e.id, e));
    return m;
  }, [entries]);
  const wordTrapById = useMemo(() => {
    const m = new Map();
    (wordTraps || []).forEach((w) => m.set(w.id, w));
    return m;
  }, [wordTraps]);

  const build = async () => {
    setBuilding(true);
    setError("");
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const compactEntries = entries.map((e) => ({
        id: e.id, section: e.section, subtype: e.subtype, mistakeTypes: e.mistakeTypes,
        notes: (e.notes || "").slice(0, 220), repeatCount: (e.totalAttempts || 0) + (e.wrongAttempts || 0),
      }));
      const compactWordTraps = wordTraps.map((w) => ({ id: w.id, word: w.word, literalMeaning: w.literalMeaning, actualMeaning: w.actualMeaning }));
      const res = await fetch("/api/focus-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: compactEntries, wordTraps: compactWordTraps }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const saved = await saveFocusList(user.id, { items: data.items, entryCount: entries.length });
      setFocusList(saved);
    } catch (e) {
      setError(e.message || "Couldn't build focus list");
    } finally {
      setBuilding(false);
    }
  };

  const toggleItem = async (idx) => {
    const items = focusList.items.map((it, i) => (i === idx ? { ...it, checked: !it.checked } : it));
    setFocusList((f) => ({ ...f, items }));
    await updateFocusListItems(focusList.id, items);
  };

  const itemSection = (item) => (item.kind === "mistake" ? entryById.get(item.id)?.section : "Verbal");

  const filteredItems = useMemo(() => {
    if (!focusList) return [];
    return focusList.items.map((it, idx) => ({ ...it, idx })).filter((it) => tab === "All" || itemSection(it) === tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusList, tab, entryById]);

  if (!entries || !wordTraps) return <AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>;

  const stale = focusList && focusList.entryCount !== entries.length;

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          {focusList ? `Built ${new Date(focusList.generatedAt).toLocaleString()} · ${focusList.items.length} items` : "No focus list yet."}
        </div>
        <button className="btn btn-primary" onClick={build} disabled={building || entries.length === 0}>
          {building ? "Building…" : focusList ? "Regenerate" : "Build focus list"}
        </button>
      </div>

      {error && <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 14 }}>{error}</div>}

      {stale && (
        <div className="card" style={{ padding: 12, marginBottom: 16, borderLeft: "3px solid var(--amber)", fontSize: 13 }}>
          {entries.length - focusList.entryCount > 0 ? `${entries.length - focusList.entryCount} new mistake(s)` : "Your entries have changed"} since this list was built — consider regenerating.
        </div>
      )}

      {!focusList ? (
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, marginBottom: 6 }}>Build your pre-test checklist.</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Pulls your highest-priority recurring mistakes and word traps into one focused list.</div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            {["All", "Quant", "Verbal"].map((s) => (
              <button key={s} className="btn" style={{ background: tab === s ? (s === "Quant" ? "var(--quant)" : s === "Verbal" ? "var(--verbal)" : "var(--amber)") : "var(--panel2)", color: tab === s ? "#0F1115" : "var(--text)", fontWeight: tab === s ? 700 : 400 }}
                onClick={() => setTab(s)}>{s}</button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredItems.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>Nothing in this section.</div>}
            {filteredItems.map((it) => {
              const entry = it.kind === "mistake" ? entryById.get(it.id) : null;
              const wordTrap = it.kind === "wordTrap" ? wordTrapById.get(it.id) : null;
              const href = it.kind === "mistake" ? `/entries?entry=${it.id}` : "/word-traps";
              const label = it.kind === "mistake" ? (entry?.questionText || "(mistake removed)") : (wordTrap?.word || "(word removed)");
              const accent = it.kind === "wordTrap" ? "var(--repeat)" : (entry?.section === "Quant" ? "var(--quant)" : "var(--verbal)");
              return (
                <div key={it.idx} className="card" style={{ padding: 12, display: "flex", gap: 10, alignItems: "flex-start", opacity: it.checked ? 0.55 : 1 }}>
                  <input type="checkbox" checked={!!it.checked} onChange={() => toggleItem(it.idx)} style={{ width: "auto", marginTop: 3 }} />
                  <div style={{ flex: 1 }}>
                    <Link href={href} style={{ color: accent, fontSize: 13.5, fontWeight: it.kind === "wordTrap" ? 700 : 400, textDecoration: "none" }}>
                      {it.kind === "wordTrap" ? label : (label.length > 100 ? label.slice(0, 100) + "…" : label)}
                    </Link>
                    {it.note && <div style={{ fontSize: 12.5, color: "var(--amber)", marginTop: 4 }}>{it.note}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </AppShell>
  );
}
