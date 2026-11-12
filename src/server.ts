import "./lib/error-capture";

import {
  findOrCreateUserByEmail,
  generateRandomToken,
  getCloudflareEnv,
  SESSION_COOKIE_NAME,
  setCloudflareEnv,
} from "./lib/cloudflare.server";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

const OAUTH_STATE_COOKIE = "deal_desk_oauth_state";

async function handleGoogleOAuth(request: Request, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/auth/google") {
    const env = await getCloudflareEnv();
    const clientId = typeof env.GOOGLE_CLIENT_ID === "string" ? env.GOOGLE_CLIENT_ID.trim() : "";
    if (!clientId) {
      return Response.redirect(
        `${url.origin}/auth?oauth_error=${encodeURIComponent("Google Sign-In is not configured yet (set GOOGLE_CLIENT_ID in Cloudflare Worker variables).")}`,
        302,
      );
    }
    const state = generateRandomToken(16);
    const redirectUri = `${url.origin}/api/auth/google/callback`;
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("prompt", "select_account");
    authUrl.searchParams.set("state", state);

    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl.toString(),
        "Set-Cookie": `${OAUTH_STATE_COOKIE}=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax`,
      },
    });
  }

  if (url.pathname === "/api/auth/google/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    if (error || !code) {
      return Response.redirect(`${url.origin}/auth?oauth_error=${encodeURIComponent(error ?? "Google sign-in was cancelled.")}`, 302);
    }

    const cookieHeader = request.headers.get("cookie") ?? "";
    const stateCookie = cookieHeader
      .split(";")
      .map((c) => c.trim().split("="))
      .find(([k]) => k === OAUTH_STATE_COOKIE)?.[1];

    if (!state || !stateCookie || state !== stateCookie) {
      return Response.redirect(`${url.origin}/auth?oauth_error=${encodeURIComponent("Invalid OAuth state. Please try signing in again.")}`, 302);
    }

    const env = await getCloudflareEnv();
    const clientId = typeof env.GOOGLE_CLIENT_ID === "string" ? env.GOOGLE_CLIENT_ID.trim() : "";
    const clientSecret = typeof env.GOOGLE_CLIENT_SECRET === "string" ? env.GOOGLE_CLIENT_SECRET.trim() : "";
    if (!clientId || !clientSecret) {
      return Response.redirect(
        `${url.origin}/auth?oauth_error=${encodeURIComponent("GOOGLE_CLIENT_SECRET is missing in Cloudflare Worker variables.")}`,
        302,
      );
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${url.origin}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      return Response.redirect(`${url.origin}/auth?oauth_error=${encodeURIComponent("Failed to exchange Google authorization code.")}`, 302);
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      return Response.redirect(`${url.origin}/auth?oauth_error=${encodeURIComponent("No access token returned by Google.")}`, 302);
    }

    const userRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) {
      return Response.redirect(`${url.origin}/auth?oauth_error=${encodeURIComponent("Could not fetch Google profile.")}`, 302);
    }

    const profile = (await userRes.json()) as { email?: string; email_verified?: boolean };
    if (!profile.email || profile.email_verified === false) {
      return Response.redirect(`${url.origin}/auth?oauth_error=${encodeURIComponent("Google account does not have a verified email.")}`, 302);
    }

    const { token } = await findOrCreateUserByEmail(profile.email);
    const maxAge = 30 * 24 * 60 * 60;
    const headers = new Headers();
    headers.set("Location", `${url.origin}/?session_token=${encodeURIComponent(token)}`);
    headers.append("Set-Cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`);
    headers.append("Set-Cookie", `${OAUTH_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    return new Response(null, { status: 302, headers });
  }

  return null;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    setCloudflareEnv(env);
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/auth/google")) {
        const oauthResponse = await handleGoogleOAuth(request, url);
        if (oauthResponse) return oauthResponse;
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
