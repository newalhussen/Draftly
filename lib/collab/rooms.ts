import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { db } from "../db";

export const TEXT_KEY = "content";
const PERSIST_DELAY_MS = Number(process.env.PERSIST_DELAY_MS ?? 1500);
const REVISION_INTERVAL_MS = Number(process.env.REVISION_INTERVAL_MS ?? 120_000);

/** A live document: the shared Yjs doc, who is connected, and bookkeeping for autosave and revisions. */
export interface Room {
  id: string;
  doc: Y.Doc;
  awareness: Awareness;
  conns: Map<object, Set<number>>; // connection -> awareness client ids it controls
  timer: NodeJS.Timeout | null;
  lastRevisionAt: number;
  lastRevisionText: string | null;
  lastEditor: string | null;
  closing: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __draftlyRooms: Map<string, Promise<Room>> | undefined;
}
const rooms = () => (globalThis.__draftlyRooms ??= new Map());

export const roomText = (room: Room) => room.doc.getText(TEXT_KEY).toString();

export function getRoom(id: string): Promise<Room> {
  let p = rooms().get(id);
  if (!p) {
    p = load(id).catch((e) => {
      rooms().delete(id);
      throw e;
    });
    rooms().set(id, p);
  }
  return p;
}

async function load(id: string): Promise<Room> {
  const { rows } = await (await db()).query("SELECT ydoc, content_text FROM documents WHERE id = $1", [id]);
  if (!rows[0]) throw new Error("document not found");
  const doc = new Y.Doc();
  if (rows[0].ydoc) Y.applyUpdate(doc, new Uint8Array(rows[0].ydoc));
  const room: Room = {
    id, doc, awareness: new Awareness(doc), conns: new Map(), timer: null,
    lastRevisionAt: 0, lastRevisionText: rows[0].content_text ?? null, lastEditor: null, closing: false,
  };
  room.awareness.setLocalState(null); // the server itself is not a participant
  doc.on("update", (_u: Uint8Array, origin: unknown) => {
    if (origin && typeof origin === "object" && "userId" in origin) room.lastEditor = (origin as { userId: string }).userId;
    schedulePersist(room);
  });
  return room;
}

function schedulePersist(room: Room) {
  if (room.timer) return;
  room.timer = setTimeout(() => {
    room.timer = null;
    void persist(room).catch((e) => console.error("persist failed", room.id, e));
  }, PERSIST_DELAY_MS);
}

/** Writes the document state and plain text, and records a revision when the text changed and enough time has passed. */
export async function persist(room: Room, opts: { revision?: "force" | "auto"; label?: string; authorId?: string | null } = {}) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  const text = roomText(room);
  const state = Buffer.from(Y.encodeStateAsUpdate(room.doc));
  const pool = await db();
  await pool.query("UPDATE documents SET ydoc = $2, content_text = $3, updated_at = now() WHERE id = $1", [room.id, state, text]);
  const changed = text !== room.lastRevisionText;
  const due = Date.now() - room.lastRevisionAt >= REVISION_INTERVAL_MS;
  const mode = opts.revision ?? "auto";
  if ((mode === "force" && (changed || opts.label)) || (mode === "auto" && changed && due && text.trim() !== "")) {
    await pool.query("INSERT INTO revisions (document_id, content, label, author_id) VALUES ($1,$2,$3,$4)", [room.id, text, opts.label ?? "", opts.authorId ?? room.lastEditor]);
    room.lastRevisionAt = Date.now();
    room.lastRevisionText = text;
  }
}

/** Called when a connection closes; the last one out saves everything and frees the memory. */
export async function releaseIfEmpty(room: Room) {
  if (room.conns.size > 0 || room.closing) return;
  room.closing = true;
  try {
    await persist(room, { revision: "auto" });
  } finally {
    if (room.conns.size === 0) {
      rooms().delete(room.id);
      room.awareness.destroy();
      room.doc.destroy();
    } else {
      room.closing = false; // someone reconnected while we were saving
    }
  }
}

/**
 * Replaces the document text with [text] inside the live Yjs doc, so every connected editor receives the change and
 * concurrent typing is merged rather than overwritten. A revision of the previous content is kept first.
 */
export async function replaceContent(id: string, text: string, userId: string, label: string) {
  const room = await getRoom(id);
  await persist(room, { revision: "force", label: "Before restore", authorId: userId });
  room.doc.transact(() => {
    const ytext = room.doc.getText(TEXT_KEY);
    ytext.delete(0, ytext.length);
    ytext.insert(0, text);
  }, { userId });
  await persist(room, { revision: "force", label, authorId: userId });
  await releaseIfEmpty(room);
}

/** Saves the current text as a named revision. */
export async function saveVersion(id: string, userId: string, label: string) {
  const room = await getRoom(id);
  await persist(room, { revision: "force", label, authorId: userId });
  await releaseIfEmpty(room);
}
