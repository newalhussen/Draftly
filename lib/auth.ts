import crypto from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const SESSION_COOKIE = "draftly_session";
const SESSION_DAYS = 14;

/** scrypt$N$salt$hash (base64). Slow on purpose and salted per password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { ...SCRYPT, N: Number(n) });
  return crypto.timingSafeEqual(expected, actual);
}

export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export interface User { id: string; email: string; name: string }

export async function createSession(userId: string): Promise<{ token: string; expires: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await (await db()).query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)", [hashToken(token), userId, expires]);
  return { token, expires };
}

export async function userForToken(token: string | undefined | null): Promise<User | null> {
  if (!token || token.length > 100) return null;
  const { rows } = await (await db()).query(
    "SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()", [hashToken(token)]);
  return rows[0] ?? null;
}

export async function destroySession(token: string | undefined) {
  if (token) await (await db()).query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

export function parseCookies(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token: string, expires: Date): string {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure}`;
}
export const clearCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export async function currentUser(req: Request): Promise<User | null> {
  return userForToken(parseCookies(req.headers.get("cookie"))[SESSION_COOKIE]);
}

/** CSRF defence in depth on top of SameSite=Lax: state-changing requests must come from our own origin. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (curl, tests) do not send Origin; cookies still required
  const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const host = new URL(origin).host;
    return allowed.length ? allowed.includes(origin) : host === req.headers.get("host");
  } catch {
    return false;
  }
}

export const json = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });
