"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase/client";
import { listEntries, getInsight, saveInsight } from "@/lib/entries";

function SubtypeCard({ item, accent }) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 12, borderLeft: `3px solid ${accent}` }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>{item.subtype}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}>{item.diagnosis}</div>
      {item.keyFacts?.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>Key facts missed</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            {item.keyFacts.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </>
      )}
      {item.framework?.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>Process to run every time</div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            {item.framework.map((f, i) => <li key={i}>{f}</li>)}
          </ol>
        </>
      )}
    </div>
  );
}

export default function WorkOnThisPage() {
  const [entries, setEntries] = useState(null);
  const [insight, setInsight] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([listEntries(), getInsight()]).then(([e, i]) => {
      setEntries(e);
      setInsight(i);
    });
  }, []);

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const compact = entries.map((e) => ({
        section: e.section, subtype: e.subtype, mistakeTypes: e.mistakeTypes,
        notes: (e.notes || "").slice(0, 220), repeatCount: (e.totalAttempts || 0) + (e.wrongAttempts || 0),
      }));
      const res = await fetch("/api/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: compact }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const saved = await saveInsight(user.id, { data, entryCount: entries.length });
      setInsight(saved);
    } catch (e) {
      setError(e.message || "Couldn't generate insight");
    } finally {
      setGenerating(false);
    }
  };

  if (!entries) return <AppShell><div style={{ color: "var(--muted)" }}>Loading…</div></AppShell>;

  const bySubtype = insight?.data?.bySubtype || [];
  const quant = bySubtype.filter((i) => i.section === "Quant");
  const verbal = bySubtype.filter((i) => i.section === "Verbal");
  const stale = insight && insight.entryCount !== entries.length;

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          {insight ? `Generated ${new Date(insight.generatedAt).toLocaleString()}` : "No diagnosis yet."}
        </div>
        <button className="btn btn-primary" onClick={generate} disabled={generating || entries.length === 0}>
          {generating ? "Generating…" : insight ? "Regenerate" : "Generate"}
        </button>
      </div>

      {error && <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 14 }}>{error}</div>}

      {stale && (
        <div className="card" style={{ padding: 12, marginBottom: 16, borderLeft: "3px solid var(--amber)", fontSize: 13 }}>
          Your entries have changed since this diagnosis was generated — consider regenerating.
        </div>
      )}

      {!insight ? (
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, marginBottom: 6 }}>Get a blunt diagnosis of your recurring mistakes.</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Groups your error log by subtype and names the specific root cause.</div>
        </div>
      ) : (
        <>
          {insight.data.overall && (
            <div className="card" style={{ padding: 14, marginBottom: 18, borderLeft: "3px solid var(--amber)", fontSize: 13.5, lineHeight: 1.6 }}>
              {insight.data.overall}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--quant)", textTransform: "uppercase", marginBottom: 10, fontWeight: 700 }}>Quant</div>
              {quant.length === 0 ? <div style={{ fontSize: 13, color: "var(--muted)" }}>Nothing here.</div> : quant.map((item, i) => <SubtypeCard key={i} item={item} accent="var(--quant)" />)}
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--verbal)", textTransform: "uppercase", marginBottom: 10, fontWeight: 700 }}>Verbal</div>
              {verbal.length === 0 ? <div style={{ fontSize: 13, color: "var(--muted)" }}>Nothing here.</div> : verbal.map((item, i) => <SubtypeCard key={i} item={item} accent="var(--verbal)" />)}
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
