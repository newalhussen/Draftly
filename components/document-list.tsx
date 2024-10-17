"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface Doc { id: string; title: string; folder: string; updatedAt: string; ownerName: string; role: "owner" | "editor" | "viewer"; excerpt: string }

export function DocumentList() {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [newFolder, setNewFolder] = useState("");

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (folder !== null) p.set("folder", folder);
    const res = await fetch(`/api/documents?${p}`, { cache: "no-store" }).catch(() => null);
    if (!res) return setError("Cannot reach the server.");
    if (res.status === 401) return router.push("/login");
    const b = await res.json();
    setDocs(b.documents);
    setFolders(b.folders);
    setError("");
  }, [q, folder, router]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function create() {
    const res = await fetch("/api/documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Untitled", folder: newFolder || (folder ?? "") }) });
    if (res.ok) router.push(`/d/${(await res.json()).id}`);
    else setError("Could not create the document.");
  }

  const chip = (label: string, value: string | null) => (
    <button key={label} className="chip" aria-current={folder === value} onClick={() => setFolder(value)}>{label}</button>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Documents</h1>
        <input className="input !w-64" placeholder="Search titles and text…" aria-label="Search documents" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="flex-1" />
        <input className="input !w-40" placeholder="Folder (optional)" aria-label="Folder for the new document" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} maxLength={60} />
        <button className="btn btn-primary" onClick={create}>New document</button>
      </div>
      {folders.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="text-sm text-muted">Folders</span>{chip("All", null)}{folders.map((f) => chip(f, f))}</div>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {docs === null && !error && <p className="text-sm text-muted">Loading…</p>}
      {docs?.length === 0 && (
        <div className="rounded-xl border border-dashed border-line p-10 text-center">
          <p className="font-medium">{q || folder !== null ? "No documents match" : "No documents yet"}</p>
          <p className="mt-1 text-sm text-muted">{q || folder !== null ? "Try a different search or folder." : "Create one to start writing. Invite others to edit together in real time."}</p>
        </div>
      )}
      {docs && docs.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
          {docs.map((d) => (
            <li key={d.id}>
              <Link href={`/d/${d.id}`} className="block px-4 py-3 hover:bg-bg">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{d.title}</span>
                  {d.folder && <span className="chip !py-0 text-xs">{d.folder}</span>}
                  {d.role !== "owner" && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">{d.role} · {d.ownerName}</span>}
                  <span className="flex-1" />
                  <span className="text-xs text-muted">{new Date(d.updatedAt).toLocaleString()}</span>
                </div>
                {d.excerpt && <p className="mt-0.5 truncate text-sm text-muted">{d.excerpt}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
