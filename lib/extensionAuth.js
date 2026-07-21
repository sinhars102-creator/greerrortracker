import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Bearer-token auth for the Chrome extension — it has no cookies, just the
// user's Supabase access token (handed over via the /extension "Start
// Logging" page). Passing it as the Authorization header on a plain
// supabase-js client makes PostgREST/Storage evaluate auth.uid() as this
// user, so the same RLS policies as the browser client apply unchanged.
// Shared by every app/api/extension/* route.
export async function authenticateExtensionRequest(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: NextResponse.json({ error: "Missing bearer token" }, { status: 401 }) };

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } }
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { error: NextResponse.json({ error: "Invalid or expired token" }, { status: 401 }) };

  return { supabase, user };
}
