import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

export async function updateSession(request) {
  // Extension requests carry no cookies — they authenticate via a Bearer
  // token validated inside the route handler itself. Skip the cookie-session
  // redirect-to-login entirely so the route can return JSON 401s instead of
  // an HTML login-page redirect.
  if (request.nextUrl.pathname.startsWith("/api/extension/")) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // supabase.auth.getUser() has been observed hanging indefinitely against
  // this project (a slow/degraded upstream — e.g. the known Supabase
  // incident on 2026-08-28) — without a bound, that took the whole site
  // down for every authenticated request until Vercel's 300s function
  // timeout killed it. Race it against a short timeout so the request
  // pipeline can never hang like that again.
  //
  // Kept short (not just "safely under 300s") on purpose: a timeout and a
  // slow-but-successful response are both handled identically below (fail
  // open, request proceeds unchanged) — so there's no benefit to waiting
  // longer for an answer whose outcome doesn't change anything. During a
  // degraded-but-not-fully-down window, a long timeout instead means every
  // single navigation eats however many seconds Supabase takes to finally
  // respond, which is what made the whole site feel sluggish rather than
  // broken. Failing open fast keeps navigation snappy either way.
  let user = null;
  let verified = false;
  try {
    const result = await Promise.race([
      supabase.auth.getUser(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("auth.getUser timed out")), 2500)),
    ]);
    user = result.data.user;
    verified = true;
  } catch {
    verified = false;
  }

  const isAuthPage = request.nextUrl.pathname.startsWith("/login");
  const isAuthCallback = request.nextUrl.pathname.startsWith("/auth");

  // A timeout is inconclusive, not proof of "logged out" — Postgres RLS is
  // this app's real authorization boundary (see CLAUDE.md), not this
  // redirect. Bouncing an already-logged-in user to /login just because
  // Supabase was momentarily too slow to confirm their session would log
  // real users out mid-session for no reason; let the request through
  // unchanged instead and let the client-side Supabase calls (which have
  // their own error handling) sort it out.
  if (!verified) {
    return supabaseResponse;
  }

  if (!user && !isAuthPage && !isAuthCallback) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
