import { z } from "zod";
import { json } from "@/lib/auth";
import { readJson, withDocument } from "@/lib/api";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };
const patch = z.object({ title: z.string().trim().min(1, "Enter a title").max(150).optional(), folder: z.string().trim().max(60).optional() });

export async function GET(req: Request, { params }: Ctx) {
  return withDocument(req, (await params).id, "view", async ({ role }) => {
    const id = (await params).id;
    const pool = await db();
    const { rows } = await pool.query("SELECT d.id, d.title, d.folder, d.updated_at, u.name AS owner_name FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = $1", [id]);
    return json({ id, title: rows[0].title, folder: rows[0].folder, ownerName: rows[0].owner_name, updatedAt: rows[0].updated_at, role });
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const id = (await params).id;
  const body = await readJson(req.clone(), patch);
  // renaming needs edit access; moving to a folder is an owner decision
  const need = "error" in body || body.data.folder === undefined ? "edit" : "manage";
  return withDocument(req, id, need, async () => {
    if ("error" in body) return body.error;
    await (await db()).query("UPDATE documents SET title = COALESCE($2, title), folder = COALESCE($3, folder), updated_at = now() WHERE id = $1", [id, body.data.title ?? null, body.data.folder ?? null]);
    return json({ ok: true });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const id = (await params).id;
  return withDocument(req, id, "manage", async () => {
    await (await db()).query("DELETE FROM documents WHERE id = $1", [id]);
    return new Response(null, { status: 204 });
  });
}
