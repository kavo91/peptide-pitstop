"use client";
import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { confirmRebase } from "@/app/actions/rebase";
import type { RebaseSuggestion } from "@/lib/schedule/rebase-suggest";

const DAY = { SU: "Sun", MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat" } as const;

/** "Mon 13 Jul" in the device locale/TZ — the prompt is a client component. */
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

export function RebasePrompt({ rebase }: { rebase: RebaseSuggestion }) {
  const [state, setState] = useState<"ask" | "busy" | "done" | "kept">("ask");
  const isRoll = rebase.kind === "interval";
  const days = rebase.suggestedDays.map((d) => DAY[d as keyof typeof DAY] ?? d).join(" / ");
  const nextDates = (rebase.nextDatesISO ?? []).map(fmtDay);

  async function accept() {
    setState("busy");
    const res = await confirmRebase({ protocolId: rebase.protocolId, plannedDateISO: rebase.plannedDateISO, actualDateISO: rebase.actualDateISO });
    setState(res.ok ? "done" : "ask");
  }

  if (state === "done")
    return (
      <p className="rounded-control bg-ok/10 px-3 py-2 text-sm font-medium text-ok">
        {isRoll
          ? `Schedule rolled — next dose ${nextDates[0] ?? "recalculated"}, then every ${rebase.intervalDays} days.`
          : `Schedule updated — rest of this week: ${days}`}
      </p>
    );
  if (state === "kept") return <p className="rounded-control bg-bg px-3 py-2 text-sm text-muted">Kept the original schedule.</p>;
  return (
    <div className="rounded-card bg-warn/10 p-3 text-sm">
      <p className="mb-2">
        {isRoll ? (
          <>
            That was off your every-{rebase.intervalDays}-day cadence. Roll the schedule from this dose?
            {nextDates.length > 0 && (
              <>
                {" "}
                Next: <strong>{nextDates.join(", ")}</strong>.
              </>
            )}
          </>
        ) : (
          <>
            That was off your usual day. Shift the rest of this week to <strong>{days}</strong>?
          </>
        )}
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={accept} disabled={state === "busy"} className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-accent px-3 py-2 font-medium text-onAccent disabled:opacity-40">
          {state === "busy" ? "…" : <><CalendarClock className="h-4 w-4" aria-hidden /> {isRoll ? "Roll schedule" : "Shift this week"}</>}
        </button>
        <button type="button" onClick={() => setState("kept")} className="rounded-control bg-bg px-3 py-2 ring-1 ring-line/15">
          {isRoll ? "Keep original dates" : "Keep grid"}
        </button>
      </div>
    </div>
  );
}
