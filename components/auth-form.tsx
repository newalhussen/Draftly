"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setFields({});
    const res = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Cannot reach the server.");
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setFields(b.fields ?? {});
      return setError(b.error ?? "Something went wrong.");
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-12 max-w-sm space-y-4 rounded-xl border border-line bg-card p-6" noValidate>
      <h1 className="text-lg font-semibold">{mode === "login" ? "Sign in to Draftly" : "Create your account"}</h1>
      {mode === "register" && (
        <label className="block text-sm">Name<input className="input mt-1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />{fields.name && <span className="text-xs text-red-600">{fields.name}</span>}</label>
      )}
      <label className="block text-sm">Email<input className="input mt-1" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" />{fields.email && <span className="text-xs text-red-600">{fields.email}</span>}</label>
      <label className="block text-sm">Password{mode === "register" && " (10+ characters)"}<input className="input mt-1" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete={mode === "login" ? "current-password" : "new-password"} />{fields.password && <span className="text-xs text-red-600">{fields.password}</span>}</label>
      {error && !Object.keys(fields).length && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button className="btn btn-primary w-full justify-center" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
      <p className="text-center text-sm text-muted">{mode === "login" ? <>No account? <Link className="underline" href="/register">Register</Link></> : <>Have an account? <Link className="underline" href="/login">Sign in</Link></>}</p>
    </form>
  );
}
