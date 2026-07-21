"use client";

import { useState } from "react";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase/client";

const EXTENSION_ID = process.env.NEXT_PUBLIC_CHROME_EXTENSION_ID;

export default function ExtensionConnectPage() {
  const [status, setStatus] = useState(null); // { ok: boolean, message: string }
  const [connecting, setConnecting] = useState(false);

  const startLogging = async () => {
    setConnecting(true);
    setStatus(null);
    try {
      if (!window.chrome?.runtime?.sendMessage) {
        setStatus({ ok: false, message: "Extension not detected — is it installed and enabled in Chrome?" });
        return;
      }
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setStatus({ ok: false, message: "You're not signed in." });
        return;
      }

      window.chrome.runtime.sendMessage(
        EXTENSION_ID,
        {
          type: "gre-capture-connect",
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresAt: session.expires_at * 1000,
          email: session.user?.email || "",
        },
        (response) => {
          if (window.chrome.runtime.lastError) {
            setStatus({ ok: false, message: `Couldn't reach the extension: ${window.chrome.runtime.lastError.message}` });
            return;
          }
          setStatus(response?.ok
            ? { ok: true, message: "Connected! Set your Quant/Verbal + subtype in the extension's toolbar icon, then use the keyboard shortcut on any question to log it." }
            : { ok: false, message: "The extension didn't confirm the connection — try again." });
        }
      );
    } finally {
      setConnecting(false);
    }
  };

  return (
    <AppShell>
      <div className="card" style={{ padding: 22, maxWidth: 560 }}>
        <div className="serif" style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Start Logging</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20 }}>
          Connects the GRE Mistake Capture Chrome extension to this account, so its keyboard shortcut can log questions
          straight into your entries without opening this app.
        </div>

        <button className="btn btn-primary" onClick={startLogging} disabled={connecting}>
          {connecting ? "Connecting…" : "Start Logging"}
        </button>

        {status && (
          <div style={{ marginTop: 16, fontSize: 13, color: status.ok ? "var(--sage)" : "var(--amber)" }}>
            {status.message}
          </div>
        )}
      </div>
    </AppShell>
  );
}
