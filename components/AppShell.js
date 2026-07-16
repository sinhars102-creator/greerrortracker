"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const TABS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/log", label: "Log Mistake" },
  { href: "/review", label: "Review" },
  { href: "/practice", label: "Practice Arena" },
  { href: "/entries", label: "All Entries" },
  { href: "/word-traps", label: "Word Traps" },
  { href: "/quant-traps", label: "Quant Traps" },
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
          <button className="btn" style={{ fontSize: 12, padding: "6px 12px" }} onClick={signOut}>Sign out</button>
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
