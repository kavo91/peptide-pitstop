"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check, AlertCircle, Clock } from "lucide-react";
import { syncNowMessages, type SyncNowStarted } from "@/lib/sync-now-messages";

type State = "idle" | "starting" | "waiting" | "done" | "slow" | "error";

const TICK_MS = 1000;
const POLL_EVERY_TICKS = 2;
// A typical on-demand pull takes ~15–20 s. Garmin can be slower.
const GIVE_UP_MS = 90_000;

/**
 * "Sync now" trigger — POSTs /api/wellness/sync-now (session-authed) which kicks
 * the garmin-sync and eight-sleep-sync sidecars. The sidecar pulls asynchronously and POSTs the data
 * back later, so the POST only means "started". The button then polls
 * /api/wellness/sync-status until the newest `syncedAt` of the device it waits on
 * (Garmin when its pull started, else Eight Sleep) moves past the baseline the POST returned, shows "Synced" and router.refresh()es the charts.
 * Past GIVE_UP_MS it stops watching but does NOT call it a failure — the pull
 * usually lands later. Red is only for a POST that came back not-ok.
 */
export function SyncNowButton() {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Bumped on every press: a poll still in flight from an earlier press must not finish this one.
  const run = useRef(0);

  function stopWatching() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }
  useEffect(() => stopWatching, []);

  async function sync() {
    stopWatching();
    const myRun = ++run.current;
    setState("starting");
    setMsg("Asking for your latest data");
    setElapsed(0);

    let baseline: string | null;
    let otherBaseline: string | null;
    let started: ReturnType<typeof syncNowMessages>;
    try {
      const res = await fetch("/api/wellness/sync-now", { method: "POST" });
      const data: ({ ok?: boolean; error?: string; recent?: boolean; baseline?: string | null; otherBaseline?: string | null } & SyncNowStarted) | null = await res
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
      if (data.recent) {
        setState("done");
        setMsg("Synced moments ago");
        router.refresh();
        return;
      }
      baseline = data.baseline ?? null;
      otherBaseline = data.otherBaseline ?? null;
      started = syncNowMessages(data);
    } catch {
      setState("error");
      setMsg("Could not reach the server");
      return;
    }

    setState("waiting");
    setMsg(started.waiting);
    // Client clock is used only for the counter and the give-up — never compared with server times.
    const startedAt = Date.now();
    const baselineMs = baseline ? Date.parse(baseline) : null;
    let ticks = 0;
    let inFlight = false;
    // The other device (Eight Sleep beside Garmin): refresh quietly once its data lands.
    let otherPending = started.other != null;
    let mainDone = false;
    const otherBaselineMs = otherBaseline ? Date.parse(otherBaseline) : null;

    timer.current = setInterval(async () => {
      ticks += 1;
      const ms = Date.now() - startedAt;
      setElapsed(Math.floor(ms / 1000));
      if (ms >= GIVE_UP_MS) {
        stopWatching();
        if (!mainDone) {
          setState("slow");
          setMsg(started.slow);
        }
        return;
      }
      if (ticks % POLL_EVERY_TICKS !== 0 || inFlight) return;
      inFlight = true;
      try {
        if (otherPending && started.other) {
          const oq = `?source=${started.other}${otherBaseline ? `&since=${encodeURIComponent(otherBaseline)}` : ""}`;
          const o = await fetch(`/api/wellness/sync-status${oq}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
          const oMs = o?.latestSyncedAt ? Date.parse(o.latestSyncedAt) : null;
          if (run.current === myRun && o?.ok && oMs != null && (otherBaselineMs == null || oMs > otherBaselineMs)) {
            otherPending = false;
            router.refresh();
          }
        }
        if (mainDone) {
          // Main device already "Synced": keep watching only the other one, then stop.
          if (!otherPending) stopWatching();
          return;
        }
        const q = `?source=${started.source}${baseline ? `&since=${encodeURIComponent(baseline)}` : ""}`;
        const res = await fetch(`/api/wellness/sync-status${q}`, { cache: "no-store" });
        const data: { ok?: boolean; latestSyncedAt?: string | null; updated?: number } | null = await res
          .json()
          .catch(() => null);
        const latestMs = data?.latestSyncedAt ? Date.parse(data.latestSyncedAt) : null;
        if (res.ok && data?.ok && latestMs != null && (baselineMs == null || latestMs > baselineMs)) {
          // Already stopped (give-up or unmount), or a newer press took over, while this poll was in flight.
          if (!timer.current || run.current !== myRun) return;
          mainDone = true;
          if (!otherPending) stopWatching();
          const n = data.updated ?? 0;
          setState("done");
          setMsg((n > 0 ? `Synced — ${n} ${n === 1 ? "day" : "days"} updated` : "Synced") + started.doneNote);
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
