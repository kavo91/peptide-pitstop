"use client";

/**
 * Plasma mini-tile — compact COMBINED plasma chart (all peptides overlaid,
 * each historical + forecast), mirroring the /analytics view it links to.
 *
 * Receives pre-computed plasmaByPeptide from the Dashboard RSC (computed
 * server-side to avoid the heavy analytics import running client-side).
 * `mostRecentPeptideId` is retained for call-site compatibility but no longer
 * used now that the tile shows every peptide.
 */
import Link from "next/link";
import { MultiPlasmaChart } from "@/components/MultiPlasmaChart";
import type { PeptidePlasma } from "@/lib/analytics";

interface Props {
  plasmaByPeptide: PeptidePlasma[];
  mostRecentPeptideId: string | null;
  now: Date;
  /** Missed-dose times for the chart's redline markers. */
  missedDoses?: Date[];
}

export function PlasmaMiniTile({ plasmaByPeptide, now, missedDoses = [] }: Props) {
  const hasData = plasmaByPeptide.some((p) => p.series.length >= 2);

  if (!hasData) {
    return (
      <div className="rounded-card bg-surface p-4 ring-1 ring-line/10 shadow-sm">
        <p className="text-xs font-medium text-muted">Plasma</p>
        <p className="mt-1 text-sm text-muted">No curve data yet</p>
      </div>
    );
  }

  return (
    <Link href="/analytics" className="block">
      <div className="rounded-card bg-surface p-4 ring-1 ring-line/10 shadow-sm">
        <p className="mb-2 text-xs font-medium text-muted">Plasma — all peptides</p>
        <MultiPlasmaChart plasmaByPeptide={plasmaByPeptide} now={now} compactOnPhone missedDoses={missedDoses} />
      </div>
    </Link>
  );
}
