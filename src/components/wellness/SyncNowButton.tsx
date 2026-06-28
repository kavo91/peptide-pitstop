"use client";

import { useState } from "react";
import { RefreshCw, Check, AlertCircle } from "lucide-react";

type State = "idle" | "pending" | "ok" | "error";

/**
 * "Sync now" trigger — POSTs /api/wellness/sync-now (session-authed) which kicks
 * the garmin-sync sidecar. The sidecar pulls asynchronously and POSTs the data
 * back later, so success here means "sync started", not "data is ready" — hence
 * the refresh hint rather than an auto-reload.
 */
export function SyncNowButton() {
  const [state, setState] = useState<State>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setState("pending");
    setMsg(null);
    try {
      const res = await fetch("/api/wellness/sync-now", { method: "POST" });
      const data: { ok?: boolean; error?: string } | null = await res
        .json()
        .catch(() => null);
      if (res.ok && data?.ok) {
        setState("ok");
        setMsg("Sync started — refresh shortly");
      } else {
        setState("error");
        setMsg(data?.error ?? `Error ${res.status}`);
      }
    } catch {
      setState("error");
      setMsg("Could not reach the server");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={sync}
        disabled={state === "pending"}
        className="inline-flex items-center gap-1.5 rounded-control bg-bg px-3 py-1.5 text-sm font-medium ring-1 ring-line/15 transition-colors hover:bg-surface disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${state === "pending" ? "animate-spin" : ""}`} aria-hidden />
        {state === "pending" ? "Syncing…" : "Sync now"}
      </button>
      {msg && (
        <span
          className={`inline-flex items-center gap-1 text-xs ${
            state === "error" ? "text-danger" : "text-muted"
          }`}
        >
          {state === "ok" && <Check className="h-3.5 w-3.5" aria-hidden />}
          {state === "error" && <AlertCircle className="h-3.5 w-3.5" aria-hidden />}
          {msg}
        </span>
      )}
    </span>
  );
}
