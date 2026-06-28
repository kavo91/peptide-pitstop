"use client";

import { useState } from "react";
import { LogIn } from "lucide-react";
import { login } from "@/app/actions/auth";

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await login({ password, code });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    window.location.href = next;
  }

  return (
    <div className="mt-6 space-y-4">
      <label className="block text-sm text-muted">
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-ink" />
      </label>
      <label className="block text-sm text-muted">
        Authenticator code
        <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-center text-2xl tabular-nums tracking-widest text-ink" />
      </label>
      <button type="button" onClick={submit} disabled={busy || code.length !== 6 || !password} className="flex w-full items-center justify-center gap-2 rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40">{busy ? "…" : <><LogIn className="h-4 w-4" aria-hidden /> Sign in</>}</button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
