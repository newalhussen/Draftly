import { z } from "zod";
import { createSession, hashPassword, json, sameOrigin, sessionCookie, verifyPassword } from "@/lib/auth";
import { readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { RateLimiter } from "@/lib/ratelimit";

const limiter = new RateLimiter(10, 60_000);
const schema = z.object({ email: z.string().trim().toLowerCase().max(190), password: z.string().max(200) });
let dummy: Promise<string> | undefined;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Cross-site request refused." }, 403);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const body = await readJson(req, schema);
  if ("error" in body) return body.error;
  if (!limiter.allow(`${ip}|${body.data.email}`)) return json({ error: "Too many attempts. Try again in a minute." }, 429);
  const { rows } = await (await db()).query("SELECT id, password_hash FROM users WHERE email = $1", [body.data.email]);
  // verify against a dummy hash for unknown emails so response time does not reveal which accounts exist
  dummy ??= hashPassword("not-a-real-password");
  const ok = await verifyPassword(body.data.password, rows[0]?.password_hash ?? (await dummy));
  if (!rows[0] || !ok) return json({ error: "Wrong email or password." }, 401);
  const { token, expires } = await createSession(rows[0].id);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, expires) });
}
