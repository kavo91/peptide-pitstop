/**
 * TodaySummaryTile — compact dashboard summary of today's doses. Links to the
 * full /today page (the actionable per-slot log list) rather than embedding it,
 * so the Dashboard stays a scannable command center, not a long scroll.
 */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { NextDoseCountdown } from "./NextDoseCountdown";

interface Props {
  dueCount: number; // doses still to take today
  loggedCount: number; // doses logged today
  nextLabel: string | null; // e.g. "BPC-157 · 20:00" — next unlogged dose, if any
  /**
   * Next upcoming dose AFTER today (peptide name + ISO instant), or null.
   * Folded into the empty state: when nothing is scheduled/logged today this
   * REPLACES the "Nothing scheduled today" text with a live countdown — keeping
   * the tile (and the phone dashboard) height-neutral.
   */
  nextDose?: { peptideName: string; atISO: string } | null;
}

/** Pitstop status disc: orange check when clear, orange count when due. */
function StatusDisc({ dueCount, loggedCount }: { dueCount: number; loggedCount: number }) {
  const clear = dueCount === 0;
  return (
    <svg width="42" height="42" viewBox="0 0 42 42" aria-hidden="true" className="shrink-0">
      <circle cx="21" cy="21" r="19" strokeWidth="2.5" style={{ fill: "rgb(var(--accent) / 0.12)", stroke: "rgb(var(--accent))" }} />
      {clear && loggedCount > 0 ? (
        <path d="M12.5 21.5 L18.5 27.5 L29.5 14.5" fill="none" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "rgb(var(--accent))" }} />
      ) : dueCount > 0 ? (
        <text x="21" y="27.5" textAnchor="middle" fontSize="17" fontWeight="700" style={{ fill: "rgb(var(--accent))", fontFamily: "var(--font-mono)" }}>{dueCount}</text>
      ) : (
        <circle cx="21" cy="21" r="4" style={{ fill: "rgb(var(--muted))" }} />
      )}
    </svg>
  );
}

export function TodaySummaryTile({ dueCount, loggedCount, nextLabel, nextDose }: Props) {
  const clear = dueCount === 0;
  const ringClass = clear && loggedCount > 0 ? "ring-accent/40" : dueCount > 0 ? "ring-warn/30" : "ring-line/10";
  return (
    <Link
      href="/today"
      className={`mb-6 flex items-center gap-3.5 rounded-card bg-surface p-4 shadow-sm ring-1 transition-colors hover:ring-accent/60 ${ringClass}`}
    >
      <StatusDisc dueCount={dueCount} loggedCount={loggedCount} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Today</p>
        <p className="mt-0.5 text-sm">
          {dueCount > 0 ? (
            <>
              <span className="font-mono font-semibold text-ink">{dueCount}</span> to take
              {loggedCount > 0 && (
                <span className="text-muted">{" · "}<span className="font-mono text-ok">{loggedCount}</span> logged</span>
              )}
            </>
          ) : loggedCount > 0 ? (
            <span className="font-medium text-accent">All done — {loggedCount} logged</span>
          ) : nextDose ? (
            <NextDoseCountdown peptideName={nextDose.peptideName} atISO={nextDose.atISO} />
          ) : (
            <span className="text-muted">Nothing scheduled today</span>
          )}
        </p>
        {nextLabel && (
          <p className="mt-1 text-xs text-muted">Next: <span className="font-mono text-ink">{nextLabel}</span></p>
        )}
      </div>
      <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-muted" />
    </Link>
  );
}
