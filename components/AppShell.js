"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, Power, LineChart, BookOpen, Puzzle, ChevronDown, FileUp, Calculator as CalculatorIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getAiProvider, setAiProvider } from "@/lib/settings";
import Calculator from "@/components/Calculator";

const PROVIDERS = [
  { value: "anthropic", label: "Claude" },
  { value: "gemini", label: "Gemini" },
  { value: "openai", label: "OpenAI" },
  { value: "groq", label: "Groq" },
];

// Flat tabs — Score Chart, Vocab Review, Log Mistake, and Import PDF are
// deliberately excluded here since they already have dedicated buttons in
// the header.
const TABS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/review", label: "Review" },
  { href: "/entries", label: "All Entries" },
  { href: "/essay", label: "Essay" },
];

const DROPDOWNS = [
  {
    label: "Traps",
    items: [
      { href: "/word-traps", label: "Word Traps" },
      { href: "/quant-traps", label: "Quant Traps" },
    ],
  },
  {
    label: "Learnings",
    items: [
      { href: "/focus-list", label: "Focus List" },
      { href: "/work-on-this", label: "Work On This" },
      { href: "/error-buckets", label: "Error Buckets" },
      { href: "/repeated-errors", label: "Repeated Errors" },
    ],
  },
];

const navLinkStyle = (active) => ({
  background: "none", border: "none", padding: "10px 4px", fontSize: 13, letterSpacing: ".04em",
  textTransform: "uppercase", textDecoration: "none",
  color: active ? "var(--text)" : "var(--muted)",
  borderBottom: active ? "2px solid var(--amber)" : "2px solid transparent",
});

function NavDropdown({ label, items, pathname }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = items.some((i) => i.href === pathname);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ ...navLinkStyle(active), cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}
      >
        {label}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, marginTop: 6, background: "var(--panel)",
          border: "1px solid var(--border)", borderRadius: 6, minWidth: 170, zIndex: 20, padding: 4,
        }}>
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              onClick={() => setOpen(false)}
              style={{
                display: "block", padding: "8px 10px", fontSize: 13, textDecoration: "none", borderRadius: 4,
                color: pathname === i.href ? "var(--text)" : "var(--muted)",
                background: pathname === i.href ? "var(--panel2)" : "transparent",
              }}
            >
              {i.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderDropdown({ provider, providers, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = providers.find((p) => p.value === provider);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }} title="AI model">
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn"
        style={{ fontSize: 12, padding: "8px 12px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
      >
        {current ? current.label : "…"}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, marginTop: 6, background: "var(--panel)",
          border: "1px solid var(--border)", borderRadius: 6, minWidth: 120, zIndex: 20, padding: 4,
        }}>
          {providers.map((p) => (
            <button
              key={p.value}
              onClick={() => { onSelect(p.value); setOpen(false); }}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 10px", fontSize: 13,
                border: "none", borderRadius: 4, cursor: "pointer",
                color: provider === p.value ? "var(--text)" : "var(--muted)",
                background: provider === p.value ? "var(--panel2)" : "transparent",
                fontWeight: provider === p.value ? 700 : 400,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CalculatorDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }} title="Calculator">
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn btn-primary"
        aria-label="Calculator"
        style={{ padding: 9, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <CalculatorIcon size={17} strokeWidth={2.5} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 8, zIndex: 20 }}>
          <Calculator />
        </div>
      )}
    </div>
  );
}

// "Log Mistake" is the primary CTA; "Import PDF" is a less-common alternate
// way to add entries, so it lives behind a small split-button dropdown
// arrow attached to the main button instead of taking its own header slot.
function LogMistakeSplitButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", display: "flex" }}>
      <Link
        href="/log"
        className="btn btn-primary"
        style={{
          fontSize: 12, padding: "8px 14px", textDecoration: "none", display: "flex", alignItems: "center", gap: 6,
          borderTopRightRadius: 0, borderBottomRightRadius: 0,
        }}
      >
        <Plus size={15} strokeWidth={2.5} />
        Log Mistake
      </Link>
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn btn-primary"
        aria-label="More ways to add entries"
        style={{
          padding: "8px 8px", display: "flex", alignItems: "center",
          borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: "1px solid rgba(0,0,0,0.2)",
        }}
      >
        <ChevronDown size={13} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, marginTop: 6, background: "var(--panel)",
          border: "1px solid var(--border)", borderRadius: 6, minWidth: 160, zIndex: 20, padding: 4,
        }}>
          <Link
            href="/import"
            onClick={() => setOpen(false)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", fontSize: 13,
              textDecoration: "none", borderRadius: 4, color: "var(--muted)",
            }}
          >
            <FileUp size={14} />
            Import PDF
          </Link>
        </div>
      )}
    </div>
  );
}

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [provider, setProvider] = useState(null);

  useEffect(() => {
    getAiProvider().then(setProvider).catch(() => setProvider("anthropic"));
  }, []);

  const switchProvider = async (value) => {
    if (value === provider) return;
    const prev = provider;
    setProvider(value); // optimistic — this is a low-stakes preference toggle
    try {
      await setAiProvider(value);
    } catch {
      setProvider(prev);
    }
  };

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
            {provider && <ProviderDropdown provider={provider} providers={PROVIDERS} onSelect={switchProvider} />}
            <Link href="/score-chart" className="btn" style={{ fontSize: 12, padding: "8px 14px", textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}>
              <LineChart size={15} strokeWidth={2.5} />
              Score Chart
            </Link>
            <Link href="/vocab" className="btn" style={{ fontSize: 12, padding: "8px 14px", textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}>
              <BookOpen size={15} strokeWidth={2.5} />
              Vocab Review
            </Link>
            <LogMistakeSplitButton />
            <Link
              href="/extension"
              className="btn"
              title="Connect Chrome extension"
              aria-label="Connect Chrome extension"
              style={{ padding: 8, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <Puzzle size={15} />
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
            <CalculatorDropdown />
          </div>
        </div>

        <div style={{ display: "flex", gap: 20, marginBottom: 24, borderBottom: "1px solid var(--border)", flexWrap: "wrap", alignItems: "center" }}>
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} style={navLinkStyle(pathname === t.href)}>
              {t.label}
            </Link>
          ))}
          {DROPDOWNS.map((d) => (
            <NavDropdown key={d.label} label={d.label} items={d.items} pathname={pathname} />
          ))}
        </div>

        {children}
      </div>
    </div>
  );
}
