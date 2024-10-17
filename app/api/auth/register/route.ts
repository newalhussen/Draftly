import { z } from "zod";
import { createSession, hashPassword, json, sameOrigin, sessionCookie } from "@/lib/auth";
import { readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { RateLimiter } from "@/lib/ratelimit";

const limiter = new RateLimiter(10, 60_000);
const schema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(190),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Cross-site request refused." }, 403);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!limiter.allow(ip)) return json({ error: "Too many attempts. Try again in a minute." }, 429);
  const body = await readJson(req, schema);
  if ("error" in body) return body.error;
  const { name, email, password } = body.data;
  const pool = await db();
  try {
    const { rows } = await pool.query("INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id", [email, name, await hashPassword(password)]);
    const { token, expires } = await createSession(rows[0].id);
    return json({ ok: true }, 201, { "set-cookie": sessionCookie(token, expires) });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return json({ error: "That email is already registered.", fields: { email: "That email is already registered." } }, 409);
    throw e;
  }
}
