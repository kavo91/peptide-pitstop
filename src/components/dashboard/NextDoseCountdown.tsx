"use client";

/**
 * NextDoseCountdown — a live relative countdown to the next scheduled dose,
 * folded into the Today tile's empty state (see page.tsx / TodaySummaryTile).
 *
 * Server computes the next dose (src/lib/next-dose.ts) and passes an ISO string
 * + peptide name; this client component ticks each minute so the relative label
 * stays fresh without a refetch. Format:
 *   ≥ 1 day  → "in 2d 4h"
 *   < 1 day  → "in 3h 20m"
 *   < 1 hour → "in 14m"
 *   ≤ now    → "now" (within the same minute) / "overdue" (past)
 */
import { useEffect, useState } from "react";

/**
 * Pure relative formatter — exported for testability. `atMs`/`nowMs` are epoch
 * millis. Returns the bare relative phrase ("in 2d 4h", "now", "overdue").
 */
export function formatCountdown(atMs: number, nowMs: number): string {
  const diffMs = atMs - nowMs;
  const diffMin = Math.round(diffMs / 60_000);

  if (diffMin < 0) return "overdue";
  if (diffMin === 0) return "now";

  const days = Math.floor(diffMin / 1440);
  const hours = Math.floor((diffMin % 1440) / 60);
  const mins = diffMin % 60;

  if (days >= 1) return `in ${days}d ${hours}h`;
  if (hours >= 1) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}

interface Props {
  peptideName: string;
  /** ISO string of the next dose instant, from getNextDose(...).at. */
  atISO: string;
}

export function NextDoseCountdown({ peptideName, atISO }: Props) {
  const atMs = new Date(atISO).getTime();
  // Initialise to null and fill on mount so SSR/CSR markup matches (the server
  // can't know the client's exact "now"); avoids a hydration mismatch.
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setLabel(formatCountdown(atMs, Date.now()));
    tick(); // immediate paint after hydration
    const id = setInterval(tick, 60_000); // refresh each minute
    return () => clearInterval(id);
  }, [atMs]);

  return (
    <>
      Next dose: <span className="font-mono text-ink">{peptideName}</span>
      {label ? ` ${label}` : ""}
    </>
  );
}
