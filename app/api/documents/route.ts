import { z } from "zod";
import { json } from "@/lib/auth";
import { readJson, withUser } from "@/lib/api";
import { db } from "@/lib/db";

const create = z.object({ title: z.string().trim().max(150).default("Untitled"), folder: z.string().trim().max(60).default("") });

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function GET(req: Request) {
  return withUser(req, async ({ user }) => {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const folder = url.searchParams.get("folder");
    const params: unknown[] = [user.id];
    let where = "(d.owner_id = $1 OR m.user_id = $1)";
    if (q) {
      params.push(like(q));
      where += ` AND (d.title ILIKE $${params.length} OR d.content_text ILIKE $${params.length})`;
    }
    if (folder !== null) {
      params.push(folder.slice(0, 60));
      where += ` AND d.folder = $${params.length}`;
    }
    const pool = await db();
    const { rows } = await pool.query(
      `SELECT d.id, d.title, d.folder, d.updated_at, u.name AS owner_name,
         CASE WHEN d.owner_id = $1 THEN 'owner' ELSE m.role END AS role,
         left(regexp_replace(d.content_text, '\\s+', ' ', 'g'), 140) AS excerpt
       FROM documents d JOIN users u ON u.id = d.owner_id
       LEFT JOIN document_members m ON m.document_id = d.id AND m.user_id = $1
       WHERE ${where} ORDER BY d.updated_at DESC LIMIT 200`, params);
    const folders = (await pool.query(
      `SELECT DISTINCT d.folder FROM documents d LEFT JOIN document_members m ON m.document_id = d.id AND m.user_id = $1
       WHERE (d.owner_id = $1 OR m.user_id = $1) AND d.folder <> '' ORDER BY d.folder`, [user.id])).rows.map((r) => r.folder);
    return json({ documents: rows.map((r) => ({ id: r.id, title: r.title, folder: r.folder, updatedAt: r.updated_at, ownerName: r.owner_name, role: r.role, excerpt: r.excerpt })), folders });
  });
}

export async function POST(req: Request) {
  return withUser(req, async ({ user }) => {
    const body = await readJson(req, create);
    if ("error" in body) return body.error;
    const { rows } = await (await db()).query("INSERT INTO documents (owner_id, title, folder) VALUES ($1,$2,$3) RETURNING id", [user.id, body.data.title || "Untitled", body.data.folder]);
    return json({ id: rows[0].id }, 201);
  });
}
