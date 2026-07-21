"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, Power, Play, BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const TABS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/log", label: "Log Mistake" },
  { href: "/review", label: "Review" },
  { href: "/practice", label: "Practice Arena" },
  { href: "/entries", label: "All Entries" },
  { href: "/word-traps", label: "Word Traps" },
  { href: "/quant-traps", label: "Quant Traps" },
  { href: "/vocab", label: "Vocab Review" },
  { href: "/focus-list", label: "Focus List" },
  { href: "/work-on-this", label: "Work On This" },
  { href: "/error-buckets", label: "Error Buckets" },
  { href: "/repeated-errors", label: "Repeated Errors" },
];

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 20px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "1px solid var(--border)", paddingBottom: 16, marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--faint)", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 4 }}>GRE · Error Ledger</div>
            <h1 className="serif" style={{ margin: 0, fontSize: 26, fontWeight: 600 }}>Mistake Log</h1>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Link href="/practice" className="btn" style={{ fontSize: 12, padding: "8px 14px", textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}>
              <Play size={15} strokeWidth={2.5} />
              Practice
            </Link>
            <Link href="/vocab" className="btn" style={{ fontSize: 12, padding: "8px 14px", textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}>
              <BookOpen size={15} strokeWidth={2.5} />
              Vocab Review
            </Link>
            <Link href="/log" className="btn btn-primary" style={{ fontSize: 12, padding: "8px 14px", textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}>
              <Plus size={15} strokeWidth={2.5} />
              Log Mistake
            </Link>
            <button
              className="btn"
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
              style={{ padding: 8, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <Power size={15} />
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 20, marginBottom: 24, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              style={{
                background: "none", border: "none", padding: "10px 4px", fontSize: 13, letterSpacing: ".04em",
                textTransform: "uppercase", textDecoration: "none",
                color: pathname === t.href ? "var(--text)" : "var(--muted)",
                borderBottom: pathname === t.href ? "2px solid var(--amber)" : "2px solid transparent",
              }}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {children}
      </div>
    </div>
  );
}
