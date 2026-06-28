"use client";

import { ArrowRight, Check } from "lucide-react";

import { useState } from "react";
import { startEnrolment, finishSetup } from "@/app/actions/auth";

export function SetupForm() {
  const [phase, setPhase] = useState<"password" | "enrol">("password");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function next() {
    setBusy(true);
    setError(null);
    const res = await startEnrolment(password, confirm);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSecret(res.secret);
    setQr(res.qr);
    setPhase("enrol");
  }

  async function finish() {
    setBusy(true);
    setError(null);
    const res = await finishSetup({ password, confirm, secret, code });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    window.location.href = "/";
  }

  return (
    <div className="mt-6 space-y-4">
      {phase === "password" ? (
        <>
          <label className="block text-sm text-muted">
            Password (min 10 chars)
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-ink" />
          </label>
          <label className="block text-sm text-muted">
            Confirm password
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-ink" />
          </label>
          <button type="button" onClick={next} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40">{busy ? "…" : <>Continue <ArrowRight className="h-4 w-4" aria-hidden /></>}</button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">Scan this in your authenticator app, then enter the 6-digit code.</p>
          {/* bg-white intentional — QR code modules require true white background for scanner compatibility */}
          {qr && <img src={qr} alt="TOTP QR code" className="mx-auto h-48 w-48 rounded-card bg-white p-2" />}
          <p className="break-all text-center text-xs text-muted">Manual key: {secret}</p>
          <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" className="w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-center text-2xl tabular-nums tracking-widest text-ink" />
          <button type="button" onClick={finish} disabled={busy || code.length !== 6} className="flex w-full items-center justify-center gap-2 rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40">{busy ? "…" : <><Check className="h-4 w-4" aria-hidden /> Finish setup</>}</button>
        </>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
