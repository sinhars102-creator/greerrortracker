"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { listEntries } from "@/lib/entries";
import { listVocabProgress, listCustomVocabWords, BASE_WORDS } from "@/lib/vocab";
import { filterLoggedWithinDays, filterNotReviewedWithinDays, computeAccuracy } from "@/lib/practiceFilters";

const WINDOW_OPTIONS = [3, 5, 7, 14];
const SECTIONS = ["Quant", "Verbal"];

const eyebrow = { fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" };

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// A stat that's either a plain number (no click target) or a link into the
// relevant scoped practice session / list.
function Tile({ label, value, sub, href, accent }) {
  const inner = (
    <div className="card" style={{ padding: "14px 16px", height: "100%" }}>
      <div style={{ ...eyebrow, marginBottom: 6 }}>{label}</div>
      <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: accent || "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
  if (!href) return inner;
  return <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>{inner}</Link>;
}

export default function DashboardPage() {
  const [entries, setEntries] = useState(null);
  const [vocabProgress, setVocabProgress] = useState(null);
  const [customWords, setCustomWords] = useState([]);
  const [windowDays, setWindowDays] = useState(3);

  useEffect(() => {
    listEntries().then(setEntries).catch(() => setEntries([]));
    Promise.all([listVocabProgress(), listCustomVocabWords()])
      .then(([progress, custom]) => { setVocabProgress(progress); setCustomWords(custom); })
      .catch(() => { setVocabProgress({}); setCustomWords([]); });
  }, []);

  const sectionStats = useMemo(() => {
    if (!entries) return null;
    const stats = {};
    for (const section of SECTIONS) {
      const bySection = entries.filter((e) => e.section === section && !e.pending);
      const logged = filterLoggedWithinDays(bySection, windowDays);
      const stale = filterNotReviewedWithinDays(bySection, windowDays);
      stats[section] = {
        total: bySection.length,
        logged,
        loggedAccuracy: computeAccuracy(logged),
        stale,
      };
    }
    return stats;
  }, [entries, windowDays]);

  const vocabStats = useMemo(() => {
    if (!vocabProgress) return null;
    const allWords = [...BASE_WORDS, ...customWords.map((c) => ({ w: c.w, m: c.m }))];
    const buckets = { learnt: 0, revise: 0, learning: 0 };
    Object.values(vocabProgress).forEach((p) => { if (buckets[p.bucket] !== undefined) buckets[p.bucket]++; });

    const cutoff = daysAgoISO(windowDays);
    const reviewedInWindow = allWords.filter((w) => {
      const p = vocabProgress[w.w];
      return p && p.lastReviewed && p.lastReviewed >= cutoff;
    });
    const learntInWindow = reviewedInWindow.filter((w) => vocabProgress[w.w].bucket === "learnt").length;
    const accuracyPct = reviewedInWindow.length > 0 ? Math.round((learntInWindow / reviewedInWindow.length) * 100) : null;

    const staleWords = allWords.filter((w) => {
      const p = vocabProgress[w.w];
      return !p || !p.lastReviewed || p.lastReviewed < cutoff;
    });

    return { total: allWords.length, buckets, reviewedInWindow, accuracyPct, staleWords };
  }, [vocabProgress, customWords, windowDays]);

  const loading = !sectionStats || !vocabStats;

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={eyebrow}>Dashboard</div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--muted)", textTransform: "none" }}>
          Window
          <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} style={{ width: "auto" }}>
            {WINDOW_OPTIONS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </label>
      </div>

      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 17, marginBottom: 8 }}>No mistakes logged yet.</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Head to Log Mistake to get started.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {SECTIONS.map((section) => {
            const s = sectionStats[section];
            const accColor = s.loggedAccuracy.pct === null ? "var(--muted)" : s.loggedAccuracy.pct >= 70 ? "var(--sage)" : s.loggedAccuracy.pct >= 40 ? "var(--amber)" : "var(--red)";
            return (
              <div key={section}>
                <div style={{ ...eyebrow, color: section === "Quant" ? "var(--quant)" : "var(--verbal)", marginBottom: 10 }}>{section}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                  <Tile label="Total logged" value={s.total} href={`/entries?section=${section}`} />
                  <Tile
                    label={`Accuracy · last ${windowDays}d`}
                    value={s.loggedAccuracy.pct === null ? "—" : `${s.loggedAccuracy.pct}%`}
                    sub={`${s.logged.length} logged${s.loggedAccuracy.unattempted ? ` · ${s.loggedAccuracy.unattempted} not attempted` : ""}`}
                    accent={accColor}
                    href={s.logged.length ? `/review?section=${section}&source=loggedWindow&days=${windowDays}` : undefined}
                  />
                  <Tile
                    label={`Not reviewed · last ${windowDays}d`}
                    value={s.stale.length}
                    accent={s.stale.length ? "var(--amber)" : "var(--sage)"}
                    href={s.stale.length ? `/review?section=${section}&source=staleWindow&days=${windowDays}` : undefined}
                  />
                </div>
              </div>
            );
          })}

          <div>
            <div style={{ ...eyebrow, marginBottom: 10 }}>Vocab</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <Tile
                label="Total words"
                value={vocabStats.total}
                sub={`${vocabStats.buckets.learnt} learnt · ${vocabStats.buckets.revise} revise · ${vocabStats.buckets.learning} learning`}
                href="/vocab"
              />
              <Tile
                label={`Accuracy · last ${windowDays}d`}
                value={vocabStats.accuracyPct === null ? "—" : `${vocabStats.accuracyPct}%`}
                sub={`${vocabStats.reviewedInWindow.length} reviewed`}
                accent={vocabStats.accuracyPct === null ? "var(--muted)" : vocabStats.accuracyPct >= 70 ? "var(--sage)" : vocabStats.accuracyPct >= 40 ? "var(--amber)" : "var(--red)"}
                href={vocabStats.reviewedInWindow.length ? `/vocab?words=${encodeURIComponent(vocabStats.reviewedInWindow.map((w) => w.w).join(","))}` : undefined}
              />
              <Tile
                label={`Not reviewed · last ${windowDays}d`}
                value={vocabStats.staleWords.length}
                accent={vocabStats.staleWords.length ? "var(--amber)" : "var(--sage)"}
                href={vocabStats.staleWords.length ? `/vocab?words=${encodeURIComponent(vocabStats.staleWords.map((w) => w.w).join(","))}` : undefined}
              />
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
