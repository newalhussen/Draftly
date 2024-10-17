import { db } from "./db";

export type Role = "owner" | "editor" | "viewer";

/** The role a user has on a document, or null when they have no access. Single source of truth for REST and WebSocket. */
export async function roleFor(documentId: string, userId: string): Promise<Role | null> {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return null;
  const { rows } = await (await db()).query(
    `SELECT CASE WHEN d.owner_id = $2 THEN 'owner' ELSE m.role END AS role
     FROM documents d LEFT JOIN document_members m ON m.document_id = d.id AND m.user_id = $2
     WHERE d.id = $1`, [documentId, userId]);
  return (rows[0]?.role as Role | null | undefined) ?? null;
}

export const canView = (r: Role | null) => r !== null;
export const canEdit = (r: Role | null) => r === "owner" || r === "editor";
export const canManage = (r: Role | null) => r === "owner";
