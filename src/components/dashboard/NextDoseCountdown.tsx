"use client";

/**
 * NextDoseCountdown — the Today tile's empty-state line: says today is clear,
 * then names when the next dose is. Cross-day doses read as a DAY ("tomorrow",
 * "Tuesday", "14 Jul") rather than a ticking countdown; only a same-day dose
 * counts down live ("in 3h 20m" / "in 14m"). Formatting lives in the pure,
 * unit-tested formatNextDoseLabel (src/lib/next-dose.ts).
 *
 * Server computes the next dose (getNextDose) and passes an ISO string +
 * peptide name; this client component ticks each minute so a same-day
 * countdown stays fresh without a refetch.
 */
import { useEffect, useState } from "react";
import { formatNextDoseLabel } from "@/lib/next-dose-format";

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
    const tick = () => setLabel(formatNextDoseLabel(atMs, Date.now()));
    tick(); // immediate paint after hydration
    const id = setInterval(tick, 60_000); // refresh each minute
    return () => clearInterval(id);
  }, [atMs]);

  return (
    <>
      Nothing due today · Next: <span className="font-mono text-ink">{peptideName}</span>
      {label ? ` ${label}` : ""}
    </>
  );
}
