import { z } from "zod";
import { currentUser, json, sameOrigin, type User } from "./auth";
import { canEdit, canManage, canView, roleFor, type Role } from "./permissions";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { user: User };

/** Runs [fn] for a signed-in user. Mutating requests must also come from our own origin. */
export async function withUser(req: Request, fn: (c: Ctx) => Promise<Response>): Promise<Response> {
  if (req.method !== "GET" && !sameOrigin(req)) return json({ error: "Cross-site request refused." }, 403);
  const user = await currentUser(req);
  if (!user) return json({ error: "Sign in required." }, 401);
  return fn({ user });
}

/** Like withUser, but also loads the caller's role on the document. Unknown ids and no access both answer 404. */
export async function withDocument(
  req: Request,
  id: string,
  need: "view" | "edit" | "manage",
  fn: (c: Ctx & { role: Role }) => Promise<Response>,
): Promise<Response> {
  return withUser(req, async ({ user }) => {
    const role = UUID.test(id) ? await roleFor(id, user.id) : null;
    if (!canView(role)) return json({ error: "Document not found." }, 404);
    const ok = need === "view" ? canView(role) : need === "edit" ? canEdit(role) : canManage(role);
    if (!ok) return json({ error: need === "edit" ? "You have view-only access to this document." : "Only the owner can do that." }, 403);
    return fn({ user, role: role! });
  });
}

export async function readJson<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<{ data: z.infer<T> } | { error: Response }> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (parsed.success) return { data: parsed.data };
  const fields = Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "form", i.message]));
  return { error: json({ error: Object.values(fields)[0] ?? "Invalid request.", fields }, 400) };
}
