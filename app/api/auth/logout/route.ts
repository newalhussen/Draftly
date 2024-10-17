import { SESSION_COOKIE, clearCookie, destroySession, json, parseCookies, sameOrigin } from "@/lib/auth";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Cross-site request refused." }, 403);
  await destroySession(parseCookies(req.headers.get("cookie"))[SESSION_COOKIE]);
  return json({ ok: true }, 200, { "set-cookie": clearCookie() });
}
