import { z } from "zod";
import { saveVersion } from "@/lib/collab/rooms";
import { json } from "@/lib/auth";
import { readJson, withDocument } from "@/lib/api";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const id = (await params).id;
  return withDocument(req, id, "view", async () => {
    const { rows } = await (await db()).query(
      `SELECT r.id, r.label, r.created_at, u.name AS author, length(r.content) AS size
       FROM revisions r LEFT JOIN users u ON u.id = r.author_id WHERE r.document_id = $1 ORDER BY r.id DESC LIMIT 100`, [id]);
    return json({ revisions: rows.map((r) => ({ id: String(r.id), label: r.label, createdAt: r.created_at, author: r.author, size: r.size })) });
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const id = (await params).id;
  return withDocument(req, id, "edit", async ({ user }) => {
    const body = await readJson(req, z.object({ label: z.string().trim().max(80).default("") }));
    if ("error" in body) return body.error;
    await saveVersion(id, user.id, body.data.label || "Saved version");
    return json({ ok: true }, 201);
  });
}
