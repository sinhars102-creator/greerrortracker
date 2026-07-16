"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { listEntries } from "@/lib/entries";

const VERBAL_SUBTYPES = ["Sentence Equivalence", "Text Completion", "Reading Comprehension", "Vocabulary"];

export default function RepeatedErrorsPage() {
  const [entries, setEntries] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set(VERBAL_SUBTYPES));

  useEffect(() => { listEntries().then(setEntries); }, []);

  const sections = useMemo(() => {
    if (!entries) return [];
    const repeated = entries.filter((e) => e.section === "Verbal" && (e.wrongAttempts || 0) >= 2);
    return VERBAL_SUBTYPES.map((subtype) => ({
      subtype,
      items: repeated.filter((e) => e.subtype === subtype).sort((a, b) => (b.wrongAttempts || 0) - (a.wrongAttempts || 0)),
    })).filter((s) => s.items.length > 0);
  }, [entries]);

  const toggle = (subtype) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(subtype)) next.delete(subtype); else next.add(subtype);
    return next;
  });

  if (!entries) return <AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>;

  if (sections.length === 0) {
    return (
      <AppShell>
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, marginBottom: 6, color: "var(--sage)" }}>No repeated Verbal errors.</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Questions you&apos;ve gotten wrong 2+ times will show up here.</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
        Verbal questions missed 2 or more times, worst first.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {sections.map((s) => {
          const isOpen = expanded.has(s.subtype);
          return (
            <div key={s.subtype} className="card" style={{ padding: 14, borderLeft: "3px solid var(--verbal)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => toggle(s.subtype)}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{s.subtype}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="pill" style={{ background: "var(--verbal)", color: "#0F1115" }}>{s.items.length}</span>
                  <span style={{ fontSize: 12, color: "var(--faint)" }}>{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>
              {isOpen && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
                  {s.items.map((e) => (
                    <Link key={e.id} href={`/entries?entry=${e.id}`} style={{ textDecoration: "none", color: "var(--text)" }}>
                      <div style={{ fontSize: 13, marginBottom: 4 }}>{(e.questionText || "(no text)").slice(0, 110)}{(e.questionText || "").length > 110 ? "…" : ""}</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11.5, color: "var(--red)", fontWeight: 700 }}>
                          wrong {e.wrongAttempts}× of {e.totalAttempts || e.wrongAttempts} attempt{(e.totalAttempts || e.wrongAttempts) === 1 ? "" : "s"}
                        </span>
                        {(e.mistakeTypes || []).map((m, i) => (
                          <span key={i} className="pill" style={{ background: "var(--border)", color: "var(--muted)" }}>{m}</span>
                        ))}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
