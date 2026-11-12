import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { AuthUser } from "./cloudflare.server";

export type { AuthUser };

export const getAuthSession = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({ token: z.string().max(256).nullable().optional() })
      .optional()
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ user: AuthUser | null }> => {
    const { getSessionUser } = await import("./cloudflare.server");
    const user = await getSessionUser(data?.token ?? null);
    return { user };
  });

export const signInWithPassword = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(254),
        password: z.string().min(6).max(200),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ user: AuthUser | null; token: string | null; error: string | null }> => {
    const { getD1, getMemoryStore, verifyPassword, createSession } = await import("./cloudflare.server");
    const email = data.email.trim().toLowerCase();
    const db = await getD1();

    let userRow: { id: string; email: string; password_hash: string } | null = null;
    if (db) {
      userRow = await db
        .prepare("SELECT id, email, password_hash FROM users WHERE LOWER(email) = ?1")
        .bind(email)
        .first<{ id: string; email: string; password_hash: string }>();
    } else {
      const mem = getMemoryStore();
      for (const u of mem.users.values()) {
        if (u.email.toLowerCase() === email) {
          userRow = u;
          break;
        }
      }
    }

    if (!userRow || !(await verifyPassword(data.password, userRow.password_hash))) {
      return { user: null, token: null, error: "Invalid email or password." };
    }

    const token = await createSession(userRow.id);
    return { user: { id: userRow.id, email: userRow.email }, token, error: null };
  });

export const signUpWithPassword = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(254),
        password: z.string().min(6).max(200),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ user: AuthUser | null; token: string | null; error: string | null }> => {
    const { getD1, getMemoryStore, hashPassword, createSession } = await import("./cloudflare.server");
    const email = data.email.trim().toLowerCase();
    const db = await getD1();

    if (db) {
      const existing = await db
        .prepare("SELECT id FROM users WHERE LOWER(email) = ?1")
        .bind(email)
        .first<{ id: string }>();
      if (existing) {
        return { user: null, token: null, error: "An account with this email already exists." };
      }
      const id = crypto.randomUUID();
      const passwordHash = await hashPassword(data.password);
      const now = new Date().toISOString();
      await db
        .prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(id, email, passwordHash, now, now)
        .run();
      const token = await createSession(id);
      return { user: { id, email }, token, error: null };
    }

    const mem = getMemoryStore();
    for (const u of mem.users.values()) {
      if (u.email.toLowerCase() === email) {
        return { user: null, token: null, error: "An account with this email already exists." };
      }
    }
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(data.password);
    const now = new Date().toISOString();
    mem.users.set(id, { id, email, password_hash: passwordHash, created_at: now, updated_at: now });
    const token = await createSession(id);
    return { user: { id, email }, token, error: null };
  });

export const signOutSession = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({ token: z.string().max(256).nullable().optional() })
      .optional()
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { deleteSession, extractRequestToken } = await import("./cloudflare.server");
    await deleteSession(data?.token ?? extractRequestToken());
    return { ok: true };
  });

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(254),
        origin: z.string().url().max(250),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; resetUrl: string | null }> => {
    const { getD1, getMemoryStore, getCloudflareEnv, generateRandomToken, sha256Hex } = await import("./cloudflare.server");
    const email = data.email.trim().toLowerCase();
    const db = await getD1();

    let userId: string | null = null;
    if (db) {
      const row = await db
        .prepare("SELECT id FROM users WHERE LOWER(email) = ?1")
        .bind(email)
        .first<{ id: string }>();
      userId = row?.id ?? null;
    } else {
      const mem = getMemoryStore();
      for (const u of mem.users.values()) {
        if (u.email.toLowerCase() === email) {
          userId = u.id;
          break;
        }
      }
    }

    if (!userId) {
      return { ok: true, resetUrl: null };
    }

    const rawCode = generateRandomToken(24);
    const tokenHash = await sha256Hex(rawCode);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    if (db) {
      await db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?1").bind(userId).run();
      await db
        .prepare("INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)")
        .bind(tokenHash, userId, expiresAt)
        .run();
    } else {
      const mem = getMemoryStore();
      mem.resets.set(tokenHash, { token_hash: tokenHash, user_id: userId, expires_at: expiresAt });
    }

    const resetUrl = `${data.origin.replace(/\/+$/, "")}/reset-password?code=${rawCode}`;
    const env = await getCloudflareEnv();
    if (env.RESEND_API_KEY) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: env.RESEND_FROM_EMAIL || "DealShift <noreply@resend.dev>",
            to: [email],
            subject: "Reset your DealShift password",
            html: `<p>Tap the link below to set a new DealShift password (valid for 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
          }),
        });
        return { ok: true, resetUrl: null };
      } catch (err) {
        console.error("[Auth] Resend email error:", err);
      }
    }

    return { ok: true, resetUrl };
  });

export const completePasswordReset = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        code: z.string().max(256).nullable().optional(),
        password: z.string().min(6).max(200),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ user: AuthUser | null; token: string | null; error: string | null }> => {
    const { getD1, getMemoryStore, getSessionUser, hashPassword, sha256Hex, createSession } = await import("./cloudflare.server");
    const db = await getD1();
    const nowIso = new Date().toISOString();

    let userId: string | null = null;
    if (data.code) {
      const tokenHash = await sha256Hex(data.code.trim());
      if (db) {
        const row = await db
          .prepare("SELECT user_id, expires_at FROM password_reset_tokens WHERE token_hash = ?1")
          .bind(tokenHash)
          .first<{ user_id: string; expires_at: string }>();
        if (!row || row.expires_at <= nowIso) {
          return { user: null, token: null, error: "This reset link has expired. Request a new one from the sign-in page." };
        }
        userId = row.user_id;
        await db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?1").bind(userId).run();
      } else {
        const mem = getMemoryStore();
        const reset = mem.resets.get(tokenHash);
        if (!reset || reset.expires_at <= nowIso) {
          return { user: null, token: null, error: "This reset link has expired. Request a new one from the sign-in page." };
        }
        userId = reset.user_id;
        mem.resets.delete(tokenHash);
      }
    } else {
      const sessionUser = await getSessionUser();
      userId = sessionUser?.id ?? null;
    }

    if (!userId) {
      return { user: null, token: null, error: "This reset link has expired. Request a new one from the sign-in page." };
    }

    const newHash = await hashPassword(data.password);
    let email = "";
    if (db) {
      await db
        .prepare("UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(newHash, nowIso, userId)
        .run();
      await db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(userId).run();
      const u = await db.prepare("SELECT email FROM users WHERE id = ?1").bind(userId).first<{ email: string }>();
      email = u?.email ?? "";
    } else {
      const mem = getMemoryStore();
      const u = mem.users.get(userId);
      if (!u) return { user: null, token: null, error: "Account not found." };
      u.password_hash = newHash;
      u.updated_at = nowIso;
      email = u.email;
      for (const [k, s] of mem.sessions.entries()) {
        if (s.user_id === userId) mem.sessions.delete(k);
      }
    }

    const token = await createSession(userId);
    return { user: { id: userId, email }, token, error: null };
  });
