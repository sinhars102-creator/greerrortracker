"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else router.push("/dashboard");
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="card" style={{ padding: 32, maxWidth: 380, width: "100%" }}>
        <div className="serif" style={{ fontSize: 22, fontWeight: 600, marginBottom: 6 }}>GRE Error Ledger</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24 }}>Sign in with a magic link — no password needed.</div>

        {sent ? (
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--sage)" }}>
            Check your email for a sign-in link. You can close this tab.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label>Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ marginBottom: 16 }}
            />
            {error && <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 12 }}>{error}</div>}
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: "100%" }}>
              {loading ? "Sending…" : "Send magic link"}
            </button>
          </form>
        )}

        <div style={{ borderTop: "1px solid var(--border)", margin: "20px 0", paddingTop: 20 }}>
          <div style={{ fontSize: 11, color: "var(--faint)", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 12 }}>
            Dev password sign-in
          </div>
          <form onSubmit={handlePasswordSubmit}>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
              style={{ marginBottom: 10 }}
            />
            <button type="submit" className="btn" disabled={loading} style={{ width: "100%" }}>
              {loading ? "Signing in…" : "Sign in with password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
