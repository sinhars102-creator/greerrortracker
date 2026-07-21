import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export async function refreshAccessToken(refreshToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Token refresh failed");
  return data; // { access_token, refresh_token, expires_in, ... }
}

// Reads stored tokens, refreshing first if the access token is near/past
// expiry. Returns null if there's no connection at all.
export async function getValidAccessToken() {
  const stored = await chrome.storage.local.get(["accessToken", "refreshToken", "expiresAt"]);
  if (!stored.accessToken || !stored.refreshToken) return null;

  if (Date.now() < stored.expiresAt - 60000) {
    return stored.accessToken;
  }

  const refreshed = await refreshAccessToken(stored.refreshToken);
  const expiresAt = Date.now() + refreshed.expires_in * 1000;
  await chrome.storage.local.set({
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
    expiresAt,
  });
  return refreshed.access_token;
}
