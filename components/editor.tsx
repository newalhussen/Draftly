"use client";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import { renderMarkdown } from "@/lib/markdown";

interface Meta { id: string; title: string; folder: string; ownerName: string; role: "owner" | "editor" | "viewer" }
interface Rev { id: string; label: string; createdAt: string; author: string | null; size: number }
interface Member { id: string; name: string; email: string; role: "viewer" | "editor" }
type Panel = "none" | "history" | "share";

const COLORS = ["#dc2626", "#d97706", "#16a34a", "#0891b2", "#4f46e5", "#c026d3"];
const colorFor = (s: string) => COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, headers: init?.body ? { "content-type": "application/json" } : undefined, cache: "no-store" });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Request failed");
  return body as T;
}

export function Editor({ id, userName }: { id: string; userName: string }) {
  const router = useRouter();
  const host = useRef<HTMLDivElement>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<"connecting" | "connected" | "offline">("connecting");
  const [peers, setPeers] = useState<{ name: string; color: string }[]>([]);
  const [panel, setPanel] = useState<Panel>("none");
  const [error, setError] = useState("");
  const [view, setView] = useState<{ rev: Rev; content: string } | null>(null);
  const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit");

  useEffect(() => {
    api<Meta>(`/documents/${id}`).then((m) => { setMeta(m); setTitle(m.title); }).catch((e) => setError(e.message));
  }, [id]);

  // editor + real-time connection
  useEffect(() => {
    if (!meta || !host.current) return;
    const writable = meta.role !== "viewer";
    const doc = new Y.Doc();
    const ytext = doc.getText("content");
    const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/collab`;
    const provider = new WebsocketProvider(wsUrl, id, doc);
    provider.awareness.setLocalStateField("user", { name: userName, color: colorFor(userName), colorLight: colorFor(userName) + "33" });
    provider.on("status", ({ status: s }: { status: string }) => setStatus(s === "connected" ? "connected" : s === "connecting" ? "connecting" : "offline"));
    const updatePeers = () => {
      const mine = provider.awareness.clientID;
      setPeers([...provider.awareness.getStates().entries()].filter(([cid, s]) => cid !== mine && (s as { user?: unknown }).user).map(([, s]) => (s as { user: { name: string; color: string } }).user));
    };
    provider.awareness.on("change", updatePeers);

    let timer: ReturnType<typeof setTimeout>;
    const onText = () => { clearTimeout(timer); timer = setTimeout(() => setSource(ytext.toString()), 120); };
    ytext.observe(onText);

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(), history(), markdown(), EditorView.lineWrapping,
        keymap.of([...yUndoManagerKeymap, ...defaultKeymap, ...historyKeymap]),
        yCollab(ytext, provider.awareness),
        EditorState.readOnly.of(!writable), EditorView.editable.of(writable),
      ],
    });
    const cm = new EditorView({ state, parent: host.current });
    return () => { clearTimeout(timer); ytext.unobserve(onText); cm.destroy(); provider.destroy(); doc.destroy(); };
  }, [meta, id, userName]);

  async function rename() {
    if (!meta || title.trim() === meta.title || !title.trim()) return setTitle(meta?.title ?? "");
    try { await api(`/documents/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }); setMeta({ ...meta, title: title.trim() }); }
    catch (e) { setError((e as Error).message); setTitle(meta.title); }
  }

  const preview = useMemo(() => renderMarkdown(view ? view.content : source), [view, source]);
  if (error && !meta) return <div className="mx-auto mt-16 max-w-md rounded-xl border border-line bg-card p-6 text-center"><p>{error}</p><Link className="btn mt-4" href="/">Back to documents</Link></div>;
  if (!meta) return <p className="p-6 text-sm text-muted">Loading…</p>;
  const canEdit = meta.role !== "viewer";

  return (
    <div className="flex h-[calc(100vh-49px)] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-card px-4 py-2">
        <Link href="/" className="text-sm text-muted hover:underline">← Documents</Link>
        <input aria-label="Title" className="input !w-72 !font-semibold" value={title} readOnly={!canEdit} maxLength={150}
          onChange={(e) => setTitle(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        <span className={`rounded-full px-2 py-0.5 text-xs ${status === "connected" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`} role="status">
          {status === "connected" ? "Live · changes save automatically" : status === "connecting" ? "Connecting…" : "Offline: edits will sync when you reconnect"}
        </span>
        {!canEdit && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">View only</span>}
        <span className="flex-1" />
        <div className="flex -space-x-1" aria-label="People editing">{peers.map((p, i) => <span key={i} title={p.name} className="grid size-7 place-items-center rounded-full border-2 border-card text-xs font-semibold text-white" style={{ background: p.color }}>{p.name.slice(0, 1).toUpperCase()}</span>)}</div>
        <button className="btn" aria-pressed={panel === "history"} onClick={() => setPanel(panel === "history" ? "none" : "history")}>History</button>
        {meta.role === "owner" && <button className="btn" aria-pressed={panel === "share"} onClick={() => setPanel(panel === "share" ? "none" : "share")}>Share</button>}
        {meta.role === "owner" && <button className="btn btn-danger" onClick={async () => { if (confirm("Delete this document and its history for everyone?")) { await api(`/documents/${id}`, { method: "DELETE" }); router.push("/"); router.refresh(); } }}>Delete</button>}
      </div>
      {error && <p role="alert" className="bg-red-50 px-4 py-1 text-sm text-red-700">{error}</p>}

      <div className="flex gap-2 border-b border-line px-4 py-1 md:hidden">
        <button className="chip" aria-current={mobileTab === "edit"} onClick={() => setMobileTab("edit")}>Write</button>
        <button className="chip" aria-current={mobileTab === "preview"} onClick={() => setMobileTab("preview")}>Preview</button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className={`min-w-0 flex-1 overflow-hidden ${mobileTab === "preview" ? "hidden md:block" : ""}`} ref={host} aria-label="Markdown editor" />
        <article className={`min-w-0 flex-1 overflow-auto border-l border-line bg-card p-6 ${mobileTab === "edit" ? "hidden md:block" : ""}`} aria-label="Preview">
          {view && <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Viewing the version from {new Date(view.rev.createdAt).toLocaleString()}. The document itself has not changed.</div>}
          {preview ? <div className="prose-doc" dangerouslySetInnerHTML={{ __html: preview }} /> : <p className="text-sm text-muted">The preview appears here as you write.</p>}
        </article>
        {panel === "history" && <History id={id} canEdit={canEdit} view={view} onView={setView} onError={setError} />}
        {panel === "share" && <Share id={id} onError={setError} />}
      </div>
    </div>
  );
}

function History({ id, canEdit, view, onView, onError }: { id: string; canEdit: boolean; view: { rev: Rev; content: string } | null; onView: (v: { rev: Rev; content: string } | null) => void; onError: (m: string) => void }) {
  const [revs, setRevs] = useState<Rev[] | null>(null);
  const [label, setLabel] = useState("");
  const load = useCallback(() => api<{ revisions: Rev[] }>(`/documents/${id}/revisions`).then((b) => setRevs(b.revisions)).catch((e) => onError(e.message)), [id, onError]);
  useEffect(() => { void load(); }, [load]);
  return (
    <aside className="w-72 flex-none overflow-auto border-l border-line bg-card p-3" aria-label="Revision history">
      <h2 className="mb-2 text-sm font-semibold">Version history</h2>
      {canEdit && (
        <form className="mb-3 flex gap-1" onSubmit={async (e) => { e.preventDefault(); try { await api(`/documents/${id}/revisions`, { method: "POST", body: JSON.stringify({ label }) }); setLabel(""); await load(); } catch (er) { onError((er as Error).message); } }}>
          <input className="input" placeholder="Name this version" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} aria-label="Version name" />
          <button className="btn">Save</button>
        </form>
      )}
      {revs === null ? <p className="text-sm text-muted">Loading…</p> : revs.length === 0 ? <p className="text-sm text-muted">Versions are saved automatically as you write.</p> : (
        <ul className="space-y-1">
          {revs.map((r) => (
            <li key={r.id} className={`rounded-lg border p-2 text-sm ${view?.rev.id === r.id ? "border-accent" : "border-line"}`}>
              <div className="font-medium">{r.label || "Autosaved version"}</div>
              <div className="text-xs text-muted">{new Date(r.createdAt).toLocaleString()} · {r.author ?? "unknown"} · {r.size} chars</div>
              <div className="mt-1 flex gap-1">
                <button className="btn !px-2 !py-0.5 text-xs" onClick={async () => { try { const b = await api<{ content: string }>(`/documents/${id}/revisions/${r.id}`); onView({ rev: r, content: b.content }); } catch (e) { onError((e as Error).message); } }}>Preview</button>
                {canEdit && <button className="btn !px-2 !py-0.5 text-xs" onClick={async () => { if (!confirm("Restore this version? The current text is saved as a version first.")) return; try { await api(`/documents/${id}/revisions/${r.id}/restore`, { method: "POST" }); onView(null); await load(); } catch (e) { onError((e as Error).message); } }}>Restore</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {view && <button className="btn mt-3 w-full justify-center" onClick={() => onView(null)}>Close preview</button>}
    </aside>
  );
}

function Share({ id, onError }: { id: string; onError: (m: string) => void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("editor");
  const [msg, setMsg] = useState("");
  const load = useCallback(() => api<{ members: Member[] }>(`/documents/${id}/members`).then((b) => setMembers(b.members)).catch((e) => onError(e.message)), [id, onError]);
  useEffect(() => { void load(); }, [load]);
  return (
    <aside className="w-72 flex-none overflow-auto border-l border-line bg-card p-3" aria-label="Sharing">
      <h2 className="mb-2 text-sm font-semibold">Share this document</h2>
      <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); setMsg(""); try { await api(`/documents/${id}/members`, { method: "POST", body: JSON.stringify({ email, role }) }); setEmail(""); setMsg("Shared."); await load(); } catch (er) { setMsg((er as Error).message); } }}>
        <input className="input" type="email" placeholder="Their account email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" required />
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as "viewer" | "editor")} aria-label="Permission"><option value="editor">Can edit</option><option value="viewer">Can view</option></select>
        <button className="btn btn-primary w-full justify-center">Share</button>
        {msg && <p role="status" className="text-sm text-muted">{msg}</p>}
      </form>
      <ul className="mt-4 space-y-1">
        {members?.map((m) => (
          <li key={m.id} className="flex items-center gap-2 rounded-lg border border-line p-2 text-sm">
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{m.name}</div><div className="truncate text-xs text-muted">{m.email} · {m.role}</div></div>
            <button className="btn btn-danger !px-2 !py-0.5 text-xs" onClick={async () => { await api(`/documents/${id}/members?userId=${m.id}`, { method: "DELETE" }); await load(); }}>Remove</button>
          </li>
        ))}
        {members?.length === 0 && <li className="text-sm text-muted">Only you have access.</li>}
      </ul>
    </aside>
  );
}
