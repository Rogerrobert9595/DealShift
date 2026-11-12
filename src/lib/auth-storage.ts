// Client-side session token persistence (cookie + localStorage) for Cloudflare D1 auth.

export const SESSION_STORAGE_KEY = "deal_desk_session_token";
export const SESSION_COOKIE_NAME = "deal_desk_session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export function getStoredSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveStoredSessionToken(token: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    /* ignore storage errors */
  }
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  } catch {
    /* ignore cookie errors */
  }
}

export function clearStoredSessionToken() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore storage errors */
  }
  try {
    document.cookie = `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    /* ignore cookie errors */
  }
}
