"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CircleCheck, RotateCw, TriangleAlert } from "lucide-react";
import { endCycle, startNextCycle } from "@/app/actions/cycle";
import type { CycleAlertLevel } from "@/lib/cycle/alerts";

/**
 * Cycle banner — the "stop / restart this peptide" prompt.
 *
 * Renders only warn/action alerts (the caller filters with bannerAlerts), and
 * carries the ONE action that resolves each state, so the banner is dismissed
 * by doing the thing rather than by an ignore button. Both actions are
 * reversible from the protocol form.
 *
 * Serialisable props only — the pure CycleAlert carries a live CycleState with
 * Date fields, so the server component flattens it to this shape first.
 */
export interface CycleBannerItem {
  protocolId: string;
  peptideName: string;
  kind: string;
  level: CycleAlertLevel;
  title: string;
  body: string;
}

const TONE: Record<CycleAlertLevel, { wrap: string; icon: string }> = {
  action: { wrap: "bg-warn/10 ring-warn/25", icon: "text-warn" },
  warn: { wrap: "bg-warn/5 ring-warn/20", icon: "text-warn" },
  info: { wrap: "bg-bg ring-line/15", icon: "text-muted" },
};

function CycleBannerRow({ alert }: { alert: CycleBannerItem }) {
  const [busy, setBusy] = useState<null | "end" | "start">(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const tone = TONE[alert.level] ?? TONE.info;

  // "stop_now" is the only state where ending the cycle is the resolution;
  // "restart_now" is the only one where starting the next is. Countdown states
  // (ending_soon / last_dose / restart_soon) are informational — the user acts
  // on the day, so offering an early stop there would invite mis-clicks.
  const canEnd = alert.kind === "stop_now";
  const canStart = alert.kind === "restart_now";

  async function run(which: "end" | "start") {
    setBusy(which);
    setError(null);
    const res = which === "end" ? await endCycle(alert.protocolId) : await startNextCycle(alert.protocolId);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className={`rounded-card p-3 text-sm ring-1 ${tone.wrap}`}>
      <div className="flex items-start gap-2">
        {alert.kind === "restart_now" ? (
          <RotateCw className={`mt-0.5 h-4 w-4 shrink-0 ${tone.icon}`} aria-hidden />
        ) : alert.kind === "stop_now" ? (
          <CircleCheck className={`mt-0.5 h-4 w-4 shrink-0 ${tone.icon}`} aria-hidden />
        ) : (
          <TriangleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${tone.icon}`} aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{alert.title}</p>
          <p className="mt-0.5 text-muted">{alert.body}</p>
          {error && <p className="mt-1 text-danger">{error}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {canEnd && (
              <button
                type="button"
                onClick={() => run("end")}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-onAccent disabled:opacity-40"
              >
                {busy === "end" ? "…" : <><CircleCheck className="h-3.5 w-3.5" aria-hidden /> Mark cycle complete</>}
              </button>
            )}
            {canStart && (
              <button
                type="button"
                onClick={() => run("start")}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-onAccent disabled:opacity-40"
              >
                {busy === "start" ? "…" : <><RotateCw className="h-3.5 w-3.5" aria-hidden /> Start next cycle</>}
              </button>
            )}
            <Link
              href={`/protocols/${alert.protocolId}/edit`}
              className="inline-flex items-center rounded-control bg-bg px-3 py-1.5 text-xs ring-1 ring-line/15"
            >
              {canEnd || canStart ? "Adjust plan" : "View protocol"}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Zero alerts renders nothing at all — no empty-state box on the dashboard. */
export function CycleBanner({ alerts }: { alerts: CycleBannerItem[] }) {
  if (alerts.length === 0) return null;
  return (
    <section className="mb-4 space-y-2" aria-label="Cycle status">
      {alerts.map((a) => (
        <CycleBannerRow key={`${a.protocolId}:${a.kind}`} alert={a} />
      ))}
    </section>
  );
}
