import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { WebSocket, WebSocketServer } from "ws";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import { SESSION_COOKIE, parseCookies, userForToken } from "../auth";
import { canEdit, roleFor } from "../permissions";
import { getRoom, releaseIfEmpty, type Room } from "./rooms";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const SYNC_STEP1 = 0; // the only sync message a read-only client may send
const MAX_PAYLOAD = 2 * 1024 * 1024;

function reject(socket: Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients still need a valid session cookie
  const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  try {
    return allowed.length ? allowed.includes(origin) : new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const send = (ws: WebSocket, data: Uint8Array) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(data, (err) => err && ws.close());
};

/** Real-time sync endpoint: ws://host/collab/<documentId>. Authenticated by the session cookie, authorized per document. */
export function attachCollab(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

  server.on("upgrade", async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const match = /^\/collab\/([0-9a-f-]{36})$/i.exec((req.url ?? "").split("?")[0]);
    if (!match) return; // not ours: leave it to Next.js (hot reload etc.)
    try {
      if (!originAllowed(req)) return reject(socket, 403, "Forbidden");
      const user = await userForToken(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
      if (!user) return reject(socket, 401, "Unauthorized");
      const role = await roleFor(match[1], user.id);
      if (!role) return reject(socket, 404, "Not Found"); // same answer as a missing document
      const room = await getRoom(match[1]);
      wss.handleUpgrade(req, socket, head, (ws) => connect(ws, room, user.id, canEdit(role)));
    } catch (e) {
      console.error("collab upgrade failed", e);
      reject(socket, 500, "Server Error");
    }
  });
  return wss;
}

function connect(ws: WebSocket, room: Room, userId: string, writable: boolean) {
  const { doc, awareness } = room;
  const origin = { userId, ws }; // transaction origin: lets us skip echoing and attribute edits
  room.conns.set(ws, new Set());

  const onUpdate = (update: Uint8Array, o: unknown) => {
    if (o === origin) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    send(ws, encoding.toUint8Array(enc));
  };
  const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, o: unknown) => {
    const ids = room.conns.get(ws);
    if (o === ws && ids) {
      added.forEach((id) => ids.add(id));
      removed.forEach((id) => ids.delete(id));
    }
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]));
    send(ws, encoding.toUint8Array(enc));
  };
  doc.on("update", onUpdate);
  awareness.on("update", onAwareness);

  ws.on("message", (data: Buffer) => {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const type = decoding.readVarUint(decoder);
      if (type === MSG_SYNC) {
        // A viewer may ask for the document (step 1) but any message that would change it is dropped on the server.
        if (!writable && decoding.peekVarUint(decoder) !== SYNC_STEP1) return;
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        const sub = syncProtocol.readSyncMessage(decoder, enc, doc, origin);
        if (encoding.length(enc) > 1) send(ws, encoding.toUint8Array(enc));
        void sub;
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
      }
    } catch (e) {
      console.error("bad collab message", e);
      ws.close(1003);
    }
  });

  let alive = true;
  ws.on("pong", () => (alive = true));
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 30_000);

  ws.on("close", () => {
    clearInterval(ping);
    doc.off("update", onUpdate);
    awareness.off("update", onAwareness);
    const ids = room.conns.get(ws);
    room.conns.delete(ws);
    if (ids?.size) awarenessProtocol.removeAwarenessStates(awareness, [...ids], null);
    void releaseIfEmpty(room).catch((e) => console.error("release failed", e));
  });

  // greet: our state vector (so the client sends what we lack) and who else is here
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SYNC);
  syncProtocol.writeSyncStep1(enc, doc);
  send(ws, encoding.toUint8Array(enc));
  const states = awareness.getStates();
  if (states.size > 0) {
    const a = encoding.createEncoder();
    encoding.writeVarUint(a, MSG_AWARENESS);
    encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(awareness, [...states.keys()]));
    send(ws, encoding.toUint8Array(a));
  }
}
