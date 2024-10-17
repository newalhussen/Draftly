import { json } from "@/lib/auth";
import { withDocument } from "@/lib/api";
import { db } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  return withDocument(req, id, "view", async () => {
    if (!/^\d{1,18}$/.test(rid)) return json({ error: "Revision not found." }, 404);
    const { rows } = await (await db()).query("SELECT id, content, label, created_at FROM revisions WHERE id = $1 AND document_id = $2", [rid, id]);
    if (!rows[0]) return json({ error: "Revision not found." }, 404);
    return json({ id: String(rows[0].id), content: rows[0].content, label: rows[0].label, createdAt: rows[0].created_at });
  });
}
