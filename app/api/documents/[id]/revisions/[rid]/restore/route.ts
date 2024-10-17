import { replaceContent } from "@/lib/collab/rooms";
import { json } from "@/lib/auth";
import { withDocument } from "@/lib/api";
import { db } from "@/lib/db";

/** Restores an older revision into the live document. The current text is kept as a revision first, so nothing is lost. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  return withDocument(req, id, "edit", async ({ user }) => {
    if (!/^\d{1,18}$/.test(rid)) return json({ error: "Revision not found." }, 404);
    const { rows } = await (await db()).query("SELECT content, created_at FROM revisions WHERE id = $1 AND document_id = $2", [rid, id]);
    if (!rows[0]) return json({ error: "Revision not found." }, 404);
    await replaceContent(id, rows[0].content, user.id, `Restored version from ${new Date(rows[0].created_at).toISOString().slice(0, 16).replace("T", " ")} UTC`);
    return json({ ok: true });
  });
}
