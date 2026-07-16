"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { listEntries } from "@/lib/entries";

function severity(count) {
  if (count >= 4) return { label: "Critical", color: "var(--red)" };
  if (count >= 2) return { label: "Recurring", color: "var(--amber)" };
  return { label: "Isolated", color: "var(--faint)" };
}

function Column({ title, accent, buckets, expanded, toggle }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: accent, textTransform: "uppercase", marginBottom: 10, fontWeight: 700 }}>{title}</div>
      {buckets.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>Nothing here.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {buckets.map((b) => {
          const sev = severity(b.entries.length);
          const isOpen = expanded === b.key;
          return (
            <div key={b.key} className="card" style={{ padding: 12, borderLeft: `3px solid ${sev.color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => toggle(b.key)}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>{b.subtype}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{b.mistakeType}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="pill" style={{ background: sev.color, color: "#0F1115" }}>{sev.label} · {b.entries.length}</span>
                  <span style={{ fontSize: 12, color: "var(--faint)" }}>{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>
              {isOpen && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
                  {b.entries.map((e) => (
                    <Link key={e.id} href={`/entries?entry=${e.id}`} style={{ fontSize: 12.5, color: "var(--text)", textDecoration: "none" }}>
                      · {(e.questionText || "(no text)").slice(0, 90)}{(e.questionText || "").length > 90 ? "…" : ""}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ErrorBucketsPage() {
  const [entries, setEntries] = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => { listEntries().then(setEntries); }, []);

  const { quant, verbal } = useMemo(() => {
    if (!entries) return { quant: [], verbal: [] };
    const buckets = {};
    entries.forEach((e) => {
      (e.mistakeTypes || []).forEach((mt) => {
        const key = `${e.section}|${e.subtype}|${mt}`;
        if (!buckets[key]) buckets[key] = { key, section: e.section, subtype: e.subtype, mistakeType: mt, entries: [] };
        buckets[key].entries.push(e);
      });
    });
    const all = Object.values(buckets).sort((a, b) => b.entries.length - a.entries.length);
    return { quant: all.filter((b) => b.section === "Quant"), verbal: all.filter((b) => b.section === "Verbal") };
  }, [entries]);

  const toggle = (key) => setExpanded((e) => (e === key ? null : key));

  if (!entries) return <AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>;

  if (entries.length === 0) {
    return (
      <AppShell>
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, marginBottom: 6 }}>No mistakes logged yet.</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
        Grouped by section · question type · mistake type. An entry with multiple mistake types appears in multiple buckets.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <Column title="Quant" accent="var(--quant)" buckets={quant} expanded={expanded} toggle={toggle} />
        <Column title="Verbal" accent="var(--verbal)" buckets={verbal} expanded={expanded} toggle={toggle} />
      </div>
    </AppShell>
  );
}
