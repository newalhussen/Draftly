import { z } from "zod";
import { json } from "@/lib/auth";
import { UUID, readJson, withDocument } from "@/lib/api";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };
const add = z.object({ email: z.string().trim().toLowerCase().email("Enter the person's email address"), role: z.enum(["viewer", "editor"], { message: "Choose viewer or editor" }) });

export async function GET(req: Request, { params }: Ctx) {
  const id = (await params).id;
  return withDocument(req, id, "manage", async () => {
    const { rows } = await (await db()).query("SELECT u.id, u.name, u.email, m.role FROM document_members m JOIN users u ON u.id = m.user_id WHERE m.document_id = $1 ORDER BY u.name", [id]);
    return json({ members: rows });
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const id = (await params).id;
  return withDocument(req, id, "manage", async ({ user }) => {
    const body = await readJson(req, add);
    if ("error" in body) return body.error;
    const pool = await db();
    const target = (await pool.query("SELECT id, name FROM users WHERE email = $1", [body.data.email])).rows[0];
    if (!target) return json({ error: "No Draftly account uses that email yet. Ask them to register first.", fields: { email: "No account with that email." } }, 404);
    if (target.id === user.id) return json({ error: "You already own this document." }, 400);
    await pool.query(
      "INSERT INTO document_members (document_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role",
      [id, target.id, body.data.role]);
    return json({ ok: true, name: target.name });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const id = (await params).id;
  return withDocument(req, id, "manage", async () => {
    const userId = new URL(req.url).searchParams.get("userId") ?? "";
    if (!UUID.test(userId)) return json({ error: "Invalid user." }, 400);
    await (await db()).query("DELETE FROM document_members WHERE document_id = $1 AND user_id = $2", [id, userId]);
    return new Response(null, { status: 204 });
  });
}
