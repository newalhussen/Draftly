import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

// Real WebSocket server, real PostgreSQL (scratch database), real Yjs clients.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5434/draftly_test";
process.env.PERSIST_DELAY_MS = "50";
process.env.REVISION_INTERVAL_MS = "0";

const { db, pool } = await import("@/lib/db");
const { createSession } = await import("@/lib/auth");
const { attachCollab } = await import("@/lib/collab/server");
const { replaceContent, getRoom, saveVersion } = await import("@/lib/collab/rooms");
const { roleFor } = await import("@/lib/permissions");

let server: Server;
let base: string;
const cleanups: (() => void)[] = [];

interface Person { id: string; token: string }
let owner: Person, editor: Person, viewer: Person, stranger: Person;
let docId: string;

async function person(name: string): Promise<Person> {
  const { rows } = await (await db()).query("INSERT INTO users (email, name, password_hash) VALUES ($1,$2,'x') RETURNING id", [`${name}@example.com`, name]);
  return { id: rows[0].id, token: (await createSession(rows[0].id)).token };
}

/** A Yjs client that authenticates with a session cookie (ws in Node lets us set headers). */
function connect(who: Person | null, id = docId) {
  const cookie = who ? `draftly_session=${who.token}` : undefined;
  class AuthSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: cookie ? { cookie } : {} });
    }
  }
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`${base}/collab`, id, doc, { WebSocketPolyfill: AuthSocket as never, disableBc: true, resyncInterval: -1 });
  cleanups.push(() => { provider.destroy(); doc.destroy(); });
  return { doc, provider, text: () => doc.getText("content") };
}

const synced = (p: WebsocketProvider) => (p.synced ? Promise.resolve() : new Promise<void>((r) => p.once("sync", () => r())));
const until = async (cond: () => boolean | Promise<boolean>, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("condition not met in time");
};
const dbText = async () => (await (await db()).query("SELECT content_text FROM documents WHERE id = $1", [docId])).rows[0].content_text as string;

beforeAll(async () => {
  server = createServer();
  attachCollab(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections?.();
  server.close();
  await pool().end();
});
beforeEach(async () => {
  cleanups.splice(0).forEach((f) => f());
  await new Promise((r) => setTimeout(r, 100));
  await (await db()).query("TRUNCATE users, sessions, documents, document_members, revisions RESTART IDENTITY CASCADE");
  globalThis.__draftlyRooms?.clear();
  [owner, editor, viewer, stranger] = [await person("owner"), await person("editor"), await person("viewer"), await person("stranger")];
  const pg = await db();
  docId = (await pg.query("INSERT INTO documents (owner_id, title) VALUES ($1,'Spec') RETURNING id", [owner.id])).rows[0].id;
  await pg.query("INSERT INTO document_members VALUES ($1,$2,'editor'), ($1,$3,'viewer')", [docId, editor.id, viewer.id]);
});

describe("access control on the WebSocket", () => {
  it("roleFor reflects owner / editor / viewer / none", async () => {
    expect([await roleFor(docId, owner.id), await roleFor(docId, editor.id), await roleFor(docId, viewer.id), await roleFor(docId, stranger.id)]).toEqual(["owner", "editor", "viewer", null]);
    expect(await roleFor("not-a-uuid", owner.id)).toBeNull();
  });

  const status = (headers: Record<string, string> = {}, id = docId) =>
    new Promise<number>((resolve) => {
      const ws = new WebSocket(`${base}/collab/${id}`, { headers });
      ws.on("unexpected-response", (_r, res) => resolve(res.statusCode ?? 0));
      ws.on("open", () => { ws.close(); resolve(101); });
      ws.on("error", () => {});
    });

  it("refuses anonymous visitors, strangers and foreign origins", async () => {
    expect(await status()).toBe(401);
    expect(await status({ cookie: "draftly_session=garbage" })).toBe(401);
    expect(await status({ cookie: `draftly_session=${stranger.token}` })).toBe(404);
    expect(await status({ cookie: `draftly_session=${owner.token}`, origin: "https://evil.example" })).toBe(403);
    expect(await status({ cookie: `draftly_session=${owner.token}` })).toBe(101);
    expect(await status({ cookie: `draftly_session=${viewer.token}` })).toBe(101);
  });
});

describe("real-time collaboration", () => {
  it("syncs edits between an owner and an editor in both directions", async () => {
    const a = connect(owner), b = connect(editor);
    await Promise.all([synced(a.provider), synced(b.provider)]);
    a.text().insert(0, "# Hello");
    await until(() => b.text().toString() === "# Hello");
    b.text().insert(7, " world");
    await until(() => a.text().toString() === "# Hello world");
  });

  it("merges simultaneous edits instead of overwriting either one", async () => {
    const a = connect(owner), b = connect(editor);
    await Promise.all([synced(a.provider), synced(b.provider)]);
    a.text().insert(0, "start");
    await until(() => b.text().toString() === "start");
    // both type at the same moment, in different places, while "offline"
    a.provider.disconnect();
    b.provider.disconnect();
    a.text().insert(0, "A:");
    b.text().insert(5, ":B");
    a.text().insert(2, "again");
    a.provider.connect();
    b.provider.connect();
    await until(() => a.text().toString() === b.text().toString() && a.text().toString().includes(":B") && a.text().toString().includes("A:"));
    expect(a.text().toString()).toContain("again");
    expect(a.text().toString()).toContain("start");
  });

  it("a viewer receives the document but cannot change it, and the server ignores their edits", async () => {
    const o = connect(owner), v = connect(viewer);
    await Promise.all([synced(o.provider), synced(v.provider)]);
    o.text().insert(0, "owner text");
    await until(() => v.text().toString() === "owner text");
    v.text().insert(0, "VIEWER HACK ");
    await new Promise((r) => setTimeout(r, 300));
    expect(o.text().toString()).toBe("owner text");
    const late = connect(editor);
    await synced(late.provider);
    expect(late.text().toString()).toBe("owner text");
  });

  it("autosaves to the database and a later session loads the saved text", async () => {
    const a = connect(owner);
    await synced(a.provider);
    a.text().insert(0, "persist me");
    await until(async () => (await dbText()) === "persist me");
    a.provider.destroy();
    await until(() => !globalThis.__draftlyRooms?.has(docId)); // room freed after the last client left
    const again = connect(editor);
    await synced(again.provider);
    await until(() => again.text().toString() === "persist me");
  });

  it("shows other people's presence", async () => {
    const a = connect(owner), b = connect(editor);
    await Promise.all([synced(a.provider), synced(b.provider)]);
    a.provider.awareness.setLocalStateField("user", { name: "Ann" });
    await until(() => [...b.provider.awareness.getStates().values()].some((s) => (s as { user?: { name: string } }).user?.name === "Ann"));
  });
});

describe("revisions and restore", () => {
  it("records revisions as text changes and restores an older one into the live document", async () => {
    const a = connect(owner), b = connect(editor);
    await Promise.all([synced(a.provider), synced(b.provider)]);
    a.text().insert(0, "version one");
    await until(async () => (await dbText()) === "version one");
    await until(async () => ((await (await db()).query("SELECT count(*)::int AS n FROM revisions")).rows[0].n) >= 1);
    const first = (await (await db()).query("SELECT id FROM revisions ORDER BY id LIMIT 1")).rows[0].id;

    a.text().delete(0, a.text().length);
    a.text().insert(0, "version two, much longer");
    await until(async () => (await dbText()) === "version two, much longer");

    await replaceContent(docId, "version one", owner.id, "Restored");
    await until(() => a.text().toString() === "version one" && b.text().toString() === "version one");
    const revs = (await (await db()).query("SELECT content, label FROM revisions ORDER BY id")).rows;
    expect(revs.some((r) => r.content === "version two, much longer" && r.label === "Before restore")).toBe(true); // nothing lost
    expect(revs.some((r) => r.content === "version one" && r.label === "Restored")).toBe(true);
    expect(first).toBeDefined();
  });

  it("restoring while someone else is typing keeps their later edits", async () => {
    const a = connect(owner), b = connect(editor);
    await Promise.all([synced(a.provider), synced(b.provider)]);
    a.text().insert(0, "base");
    await until(() => b.text().toString() === "base");
    await replaceContent(docId, "restored", owner.id, "Restored");
    await until(() => b.text().toString() === "restored");
    b.text().insert(8, "!!");
    await until(() => a.text().toString() === "restored!!");
  });

  it("saveVersion stores a named revision", async () => {
    const room = await getRoom(docId);
    room.doc.getText("content").insert(0, "named");
    await saveVersion(docId, owner.id, "Milestone");
    const rows = (await (await db()).query("SELECT label, content FROM revisions")).rows;
    expect(rows).toContainEqual({ label: "Milestone", content: "named" });
  });
});
