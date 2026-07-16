"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { listEntries } from "@/lib/entries";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

function StatCard({ label, value, accent }) {
  return (
    <div className="card" style={{ padding: "16px 18px", flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: accent || "var(--text)" }}>{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    listEntries().then(setEntries).catch(() => setEntries([]));
  }, []);

  const stats = useMemo(() => {
    if (!entries) return null;
    const today = new Date().toISOString().slice(0, 10);
    const total = entries.length;
    const quant = entries.filter((e) => e.section === "Quant").length;
    const verbal = entries.filter((e) => e.section === "Verbal").length;
    const due = entries.filter((e) => !e.mastered && e.nextReview <= today).length;
    const mastered = entries.filter((e) => e.mastered).length;

    const mistakeCounts = {};
    entries.forEach((e) => (e.mistakeTypes || []).forEach((m) => (mistakeCounts[m] = (mistakeCounts[m] || 0) + 1)));
    const mistakeChart = Object.entries(mistakeCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

    const subtypeCounts = {};
    entries.forEach((e) => (subtypeCounts[e.subtype] = (subtypeCounts[e.subtype] || 0) + 1));
    const subtypeChart = Object.entries(subtypeCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

    return { total, quant, verbal, due, mastered, mistakeChart, subtypeChart };
  }, [entries]);

  return (
    <AppShell>
      {!stats ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>
      ) : stats.total === 0 ? (
        <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 17, marginBottom: 8 }}>No mistakes logged yet.</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Head to Log Mistake to get started.</div>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            <StatCard label="Total logged" value={stats.total} />
            <StatCard label="Quant" value={stats.quant} accent="var(--quant)" />
            <StatCard label="Verbal" value={stats.verbal} accent="var(--verbal)" />
            <StatCard label="Due for review" value={stats.due} accent={stats.due ? "var(--amber)" : "var(--text)"} />
            <StatCard label="Mastered" value={stats.mastered} accent="var(--sage)" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", marginBottom: 12 }}>By error type</div>
              <ResponsiveContainer width="100%" height={Math.max(160, stats.mistakeChart.length * 34)}>
                <BarChart data={stats.mistakeChart} layout="vertical" margin={{ left: 0, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "var(--muted)", fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "var(--muted)", fontSize: 11 }} width={110} />
                  <Tooltip contentStyle={{ background: "var(--panel2)", border: "1px solid var(--border)" }} />
                  <Bar dataKey="count" radius={[0, 3, 3, 0]} fill="var(--red)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", marginBottom: 12 }}>By topic</div>
              <ResponsiveContainer width="100%" height={Math.max(160, stats.subtypeChart.length * 34)}>
                <BarChart data={stats.subtypeChart} layout="vertical" margin={{ left: 0, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "var(--muted)", fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "var(--muted)", fontSize: 11 }} width={130} />
                  <Tooltip contentStyle={{ background: "var(--panel2)", border: "1px solid var(--border)" }} />
                  <Bar dataKey="count" radius={[0, 3, 3, 0]} fill="var(--quant)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
