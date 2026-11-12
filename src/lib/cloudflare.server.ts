// Cloudflare Workers D1 database binding + Web Crypto authentication utilities.
import { getRequest } from "@tanstack/react-start/server";

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<unknown>;
}

export interface CloudflareEnv {
  DB?: D1Database;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  [key: string]: unknown;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface StoredDealRow {
  id: string;
  user_id: string;
  customer_name: string;
  customer_phone: string | null;
  notes: string | null;
  proposed_stock: string | null;
  proposed_vehicle_json: string | null;
  trade_vehicle_json: string | null;
  deal_structure_json: string | null;
  created_at: string;
  updated_at: string;
}

let activeEnv: CloudflareEnv | undefined;
let schemaInitialized = false;

/** Called by src/server.ts on every incoming Cloudflare Worker request. */
export function setCloudflareEnv(env: unknown) {
  if (env && typeof env === "object") {
    activeEnv = env as CloudflareEnv;
  }
}

export async function getCloudflareEnv(): Promise<CloudflareEnv> {
  if (activeEnv?.DB) return activeEnv;

  const globalEnv = (globalThis as { __env__?: CloudflareEnv }).__env__;
  if (globalEnv?.DB) return globalEnv;

  try {
    // Native Cloudflare Workers runtime module when running on Workers / Wrangler
    const moduleName = "cloudflare:" + "workers";
    const cf = (await import(/* @vite-ignore */ moduleName)) as { env?: CloudflareEnv };
    if (cf?.env) {
      activeEnv = cf.env;
      return cf.env;
    }
  } catch {
    /* Not in cloudflare:workers runtime (e.g., local vite dev or vitest) */
  }

  return activeEnv ?? {};
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS saved_deals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    notes TEXT,
    proposed_stock TEXT,
    proposed_vehicle_json TEXT,
    trade_vehicle_json TEXT,
    deal_structure_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE INDEX IF NOT EXISTS saved_deals_user_updated_idx ON saved_deals (user_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    inventory_script_url TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
];

export async function getD1(): Promise<D1Database | null> {
  const env = await getCloudflareEnv();
  const db = env.DB ?? null;
  if (db && !schemaInitialized) {
    try {
      await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
      schemaInitialized = true;
    } catch (err) {
      console.error("[D1] Schema auto-init failed:", err);
    }
  }
  return db;
}

// ---------------------------------------------------------------------------
// In-memory fallback store for local `vite dev` / test runs without Wrangler D1
// ---------------------------------------------------------------------------
interface MemoryStore {
  users: Map<string, { id: string; email: string; password_hash: string; created_at: string; updated_at: string }>;
  sessions: Map<string, { token_hash: string; user_id: string; expires_at: string }>;
  resets: Map<string, { token_hash: string; user_id: string; expires_at: string }>;
  deals: Map<string, StoredDealRow>;
  settings: Map<string, { user_id: string; inventory_script_url: string | null; updated_at: string }>;
}

const mem: MemoryStore = {
  users: new Map(),
  sessions: new Map(),
  resets: new Map(),
  deals: new Map(),
  settings: new Map(),
};

export function getMemoryStore(): MemoryStore {
  return mem;
}

// ---------------------------------------------------------------------------
// Web Crypto password hashing (PBKDF2-SHA256) & token helpers
// ---------------------------------------------------------------------------
const PBKDF2_ITERATIONS = 100_000;

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

export function generateRandomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return `pbkdf2:${PBKDF2_ITERATIONS}:${toHex(salt)}:${toHex(new Uint8Array(derived))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1]!, 10);
  const salt = fromHex(parts[2]!);
  const expected = fromHex(parts[3]!);
  if (!Number.isFinite(iterations) || iterations < 1000 || expected.length === 0) return false;

  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, keyMaterial, expected.length * 8),
  );
  if (derived.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < derived.length; i++) {
    diff |= derived[i]! ^ expected[i]!;
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Request session extraction & D1 user lookup
// ---------------------------------------------------------------------------
export const SESSION_COOKIE_NAME = "deal_desk_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function extractRequestToken(): string | null {
  let req: Request | undefined;
  try {
    req = getRequest();
  } catch {
    return null;
  }
  if (!req?.headers) return null;

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === SESSION_COOKIE_NAME && v.length) {
        return decodeURIComponent(v.join("="));
      }
    }
  }
  return null;
}

export async function createSession(userId: string): Promise<string> {
  const rawToken = generateRandomToken(32);
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  const db = await getD1();
  if (db) {
    await db
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)")
      .bind(tokenHash, userId, expiresAt)
      .run();
  } else {
    mem.sessions.set(tokenHash, { token_hash: tokenHash, user_id: userId, expires_at: expiresAt });
  }
  return rawToken;
}

export async function deleteSession(rawToken: string | null): Promise<void> {
  if (!rawToken) return;
  const tokenHash = await sha256Hex(rawToken);
  const db = await getD1();
  if (db) {
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(tokenHash).run();
  } else {
    mem.sessions.delete(tokenHash);
  }
}

export async function getSessionUser(explicitToken?: string | null): Promise<AuthUser | null> {
  const rawToken = explicitToken ?? extractRequestToken();
  if (!rawToken) return null;
  const tokenHash = await sha256Hex(rawToken);
  const nowIso = new Date().toISOString();

  const db = await getD1();
  if (db) {
    const row = await db
      .prepare(
        `SELECT u.id, u.email, s.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?1`,
      )
      .bind(tokenHash)
      .first<{ id: string; email: string; expires_at: string }>();
    if (!row) return null;
    if (row.expires_at <= nowIso) {
      await db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(tokenHash).run();
      return null;
    }
    return { id: row.id, email: row.email };
  }

  const sess = mem.sessions.get(tokenHash);
  if (!sess) return null;
  if (sess.expires_at <= nowIso) {
    mem.sessions.delete(tokenHash);
    return null;
  }
  const user = mem.users.get(sess.user_id);
  return user ? { id: user.id, email: user.email } : null;
}

export async function requireSessionUser(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Unauthorized: Please sign in.");
  return user;
}
