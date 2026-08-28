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
  // this project (stale/corrupted refresh token, or a slow upstream) —
  // without a bound, that took the whole site down for every authenticated
  // request until Vercel's 300s function timeout killed it. Fail safe
  // (treat as unauthenticated, bounce to /login) rather than hang the
  // request pipeline; a real user just re-logs in, instead of every visit
  // hard-timing-out for everyone.
  let user = null;
  try {
    const result = await Promise.race([
      supabase.auth.getUser(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("auth.getUser timed out")), 8000)),
    ]);
    user = result.data.user;
  } catch {
    user = null;
  }

  const isAuthPage = request.nextUrl.pathname.startsWith("/login");
  const isAuthCallback = request.nextUrl.pathname.startsWith("/auth");

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
