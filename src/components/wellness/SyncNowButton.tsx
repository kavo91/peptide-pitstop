"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check, AlertCircle, Clock } from "lucide-react";

type State = "idle" | "starting" | "waiting" | "done" | "slow" | "error";

const TICK_MS = 1000;
const POLL_EVERY_TICKS = 2;
// A typical on-demand pull takes ~15–20 s. Garmin can be slower.
const GIVE_UP_MS = 90_000;

/**
 * "Sync now" trigger — POSTs /api/wellness/sync-now (session-authed) which kicks
 * the garmin-sync sidecar. The sidecar pulls asynchronously and POSTs the data
 * back later, so the POST only means "started". The button then polls
 * /api/wellness/sync-status until the newest Garmin `syncedAt` moves past the
 * baseline the POST returned, shows "Synced" and router.refresh()es the charts.
 * Past GIVE_UP_MS it stops watching but does NOT call it a failure — the pull
 * usually lands later. Red is only for a POST that came back not-ok.
 */
export function SyncNowButton() {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopWatching() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }
  useEffect(() => stopWatching, []);

  async function sync() {
    stopWatching();
    setState("starting");
    setMsg("Asking Garmin for your latest data");
    setElapsed(0);

    let baseline: string | null;
    try {
      const res = await fetch("/api/wellness/sync-now", { method: "POST" });
      const data: { ok?: boolean; error?: string; baseline?: string | null } | null = await res
        .json()
        .catch(() => null);
      if (!res.ok || !data?.ok) {
        setState("error");
        setMsg(
          data?.error ??
            (data === null ? "Could not start the sync — you may have been signed out" : `Error ${res.status}`),
        );
        return;
      }
      baseline = data.baseline ?? null;
    } catch {
      setState("error");
      setMsg("Could not reach the server");
      return;
    }

    setState("waiting");
    setMsg("Getting your latest Garmin data");
    // Client clock is used only for the counter and the give-up — never compared with server times.
    const startedAt = Date.now();
    const baselineMs = baseline ? Date.parse(baseline) : null;
    let ticks = 0;
    let inFlight = false;

    timer.current = setInterval(async () => {
      ticks += 1;
      const ms = Date.now() - startedAt;
      setElapsed(Math.floor(ms / 1000));
      if (ms >= GIVE_UP_MS) {
        stopWatching();
        setState("slow");
        setMsg("Garmin is still working. New data will show the next time you open this page");
        return;
      }
      if (ticks % POLL_EVERY_TICKS !== 0 || inFlight) return;
      inFlight = true;
      try {
        const q = baseline ? `?since=${encodeURIComponent(baseline)}` : "";
        const res = await fetch(`/api/wellness/sync-status${q}`, { cache: "no-store" });
        const data: { ok?: boolean; latestSyncedAt?: string | null; updated?: number } | null = await res
          .json()
          .catch(() => null);
        const latestMs = data?.latestSyncedAt ? Date.parse(data.latestSyncedAt) : null;
        if (res.ok && data?.ok && latestMs != null && (baselineMs == null || latestMs > baselineMs)) {
          if (!timer.current) return; // already stopped (give-up or unmount) while this poll was in flight
          stopWatching();
          const n = data.updated ?? 0;
          setState("done");
          setMsg(n > 0 ? `Synced — ${n} ${n === 1 ? "day" : "days"} updated` : "Synced");
          router.refresh();
        }
      } catch {
        // transient network blip — keep polling until the give-up
      } finally {
        inFlight = false;
      }
    }, TICK_MS);
  }

  const busy = state === "starting" || state === "waiting";

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={sync}
        disabled={busy}
        aria-busy={busy}
        className="inline-flex items-center gap-1.5 rounded-control bg-bg px-3 py-1.5 text-sm font-medium ring-1 ring-line/15 transition-colors hover:bg-surface disabled:opacity-60"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden />
        {busy ? (
          <span className="tabular-nums">Syncing…{state === "waiting" && elapsed > 0 ? ` ${elapsed}s` : ""}</span>
        ) : (
          "Sync now"
        )}
      </button>
      <span
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-1 text-xs ${
          state === "error" ? "text-danger" : state === "done" ? "text-ok" : "text-muted"
        }`}
      >
        {msg && (
          <>
            {state === "done" && <Check className="h-3.5 w-3.5" aria-hidden />}
            {state === "error" && <AlertCircle className="h-3.5 w-3.5" aria-hidden />}
            {state === "slow" && <Clock className="h-3.5 w-3.5" aria-hidden />}
            {msg}
          </>
        )}
      </span>
    </span>
  );
}
