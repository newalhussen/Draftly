# Draftly

Collaborative Markdown editor. Several people edit the same document at once, with live cursors, a live preview, autosave and version history.

## Features
- Accounts (email + password), documents with folders, and search over titles and text.
- **Real-time collaboration** with [Yjs](https://yjs.dev) (a CRDT) over WebSockets: simultaneous edits are merged, never overwritten, and offline edits sync when you reconnect. Remote cursors and presence avatars.
- CodeMirror 6 editor with a side-by-side **live Markdown preview** (raw HTML is escaped, unsafe links refused).
- **Sharing** by email as *viewer* or *editor*. Viewers get a read-only editor, and the **server** discards any change they send.
- **Autosave** (debounced) and **revision history**: revisions are recorded automatically as the text changes (every 2 minutes at most) and you can save named versions. Preview any version, or **restore** it into the live document; the text you replace is kept as a revision first, and restoring merges with anyone typing at the time.

## Architecture
```
browser ──HTTP──▶ Next.js route handlers ──▶ PostgreSQL
   └────WebSocket /collab/<doc>──▶ ws server (same Node process) ──▶ Yjs rooms in memory ⇄ PostgreSQL
```
`server.ts` is a small custom Node server hosting Next.js plus the WebSocket endpoint. Each open document is a Yjs room; its state is stored in `documents.ydoc` (binary) with the plain text beside it for search, and revisions are plain-text snapshots. `lib/permissions.ts` is the single source of truth for who may do what, used by both REST and WebSocket.

## Security
Passwords: scrypt with a per-user salt. Sessions: random tokens stored only as SHA-256 hashes, HttpOnly + SameSite=Lax cookie. The WebSocket upgrade requires the session cookie, an allowed Origin, and a role on the document (no access answers 404 like a missing document). REST mutations check Origin too. Login and registration are rate limited. Only owners can delete, share or change folders; editors can edit and rename.

## Run
Prerequisites: Node 20+, PostgreSQL 14+.
```bash
createdb draftly
cp .env.example .env.local      # set DATABASE_URL
npm install
npm run dev                     # http://localhost:3000  (migrations run on start)
# production: npm run build && npm start
```
Open the same document in two browsers (sign in as different users, share it first) to see live editing.

## Tests
`npm test` (18 tests) starts a real WebSocket server against PostgreSQL (`TEST_DATABASE_URL`, default `postgres://postgres@127.0.0.1:5434/draftly_test`) and connects real Yjs clients: two-way sync, concurrent edits merging, viewers unable to change anything, anonymous/stranger/foreign-origin connections refused, autosave and reload, presence, revisions and restore (including restore during concurrent typing), plus password, markdown-sanitization and rate-limit unit tests.

## Limits
Single server instance (rooms live in memory; scale out needs a shared pub/sub). Plain-text Markdown only, no image uploads. Sharing requires the other person to have an account.
