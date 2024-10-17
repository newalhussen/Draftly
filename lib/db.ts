import fs from "node:fs";
import path from "node:path";
import pg from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __draftlyPool: pg.Pool | undefined;
  // eslint-disable-next-line no-var
  var __draftlyMigrated: Promise<void> | undefined;
}

/** One pool per process, shared by the Next.js handlers and the WebSocket server (globalThis survives module reloads). */
export function pool(): pg.Pool {
  globalThis.__draftlyPool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://draftly:draftly@localhost:5432/draftly", max: 10 });
  return globalThis.__draftlyPool;
}

export async function migrate(): Promise<void> {
  const p = pool();
  await p.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const dir = path.join(process.cwd(), "migrations");
  const done = new Set((await p.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    const c = await p.connect();
    try {
      await c.query("BEGIN");
      await c.query(fs.readFileSync(path.join(dir, f), "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}

export async function db(): Promise<pg.Pool> {
  globalThis.__draftlyMigrated ??= migrate().catch((e) => {
    globalThis.__draftlyMigrated = undefined;
    throw e;
  });
  await globalThis.__draftlyMigrated;
  return pool();
}
