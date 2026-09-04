/**
 * Section 4 — co-occurring exposure in a window. Alphabetical, every compound
 * with equal weight, no effect column: this is the regimen during the interval,
 * not attribution.
 */
import type { ExposureRowExt } from "@/lib/bodycomp-data";
import { BODY_COPY } from "@/lib/bodycomp-copy";
import { CARD, fmtDate } from "./format";

const DAY = 86_400_000;

interface Props {
  rows: ExposureRowExt[];
  from: Date;
  to: Date;
  /** Extra label under the header, e.g. BODY_COPY.noComparator for the pre-baseline window. */
  label?: string;
}

export function ExposureLedger({ rows, from, to, label }: Props) {
  const windowDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));
  const sorted = [...rows].sort((a, b) => a.peptideName.localeCompare(b.peptideName));

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-medium text-muted">{BODY_COPY.exposureHeader}{label && <span className="sr-only"> — {label}</span>}</h2>
      <p className="mb-3 text-xs text-muted">
        {fmtDate(from)} → {fmtDate(to)} · {windowDays} days{label ? ` · ${label}` : ""}
      </p>
      <div className={CARD}>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted">No doses were logged in this window.</p>
        ) : (
          <>
            {/* Lane strip: one row per compound, aligned to the window. */}
            <ul className="mb-3 space-y-1" aria-label="Exposure lanes">
              {sorted.map((r) => {
                const endT = r.lastDoseDay ? Date.parse(r.lastDoseDay) + DAY : null;
                const startT = endT == null ? null : Math.max(from.getTime(), endT - r.daysActive * DAY);
                const leftPct = startT == null ? 0 : ((startT - from.getTime()) / (windowDays * DAY)) * 100;
                const widthPct = startT == null || endT == null ? 0 : Math.max(1, ((Math.min(endT, to.getTime() + DAY) - startT) / (windowDays * DAY)) * 100);
                return (
                  <li key={r.peptideId} className="flex items-center gap-2 text-xs">
                    <span className="w-32 shrink-0 truncate text-ink" title={r.peptideName}>{r.peptideName}</span>
                    <span className="relative h-2 flex-1 rounded-full bg-line/10">
                      <span className="absolute top-0 h-2 rounded-full bg-muted/50" style={{ left: `${Math.min(100, Math.max(0, leftPct))}%`, width: `${Math.min(100 - Math.max(0, leftPct), widthPct)}%` }} />
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="py-1 pr-2 font-medium">Compound</th>
                    <th className="py-1 pr-2 text-right font-medium">Days active</th>
                    <th className="py-1 pr-2 text-right font-medium">Doses</th>
                    <th className="py-1 pr-2 text-right font-medium">Cumulative mg</th>
                    <th className="py-1 text-right font-medium">Days since last dose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/10 tabular-nums">
                  {sorted.map((r) => (
                    <tr key={r.peptideId}>
                      <td className="py-1.5 pr-2 text-ink">
                        {r.peptideName}
                        {r.derived && <span className="ml-1 text-[10px] text-muted">derived ({r.source ?? "label"})</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-right">{r.daysActive}</td>
                      <td className="py-1.5 pr-2 text-right">{r.doseCount}</td>
                      <td className="py-1.5 pr-2 text-right">{(r.totalMcg / 1000).toFixed(2)}</td>
                      <td className="py-1.5 text-right">{r.daysSinceLastDoseAtWindowEnd ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] text-muted">
              Lane bar = days active in the window, right edge at the last logged dose; not a dose-by-dose timeline.
              Blend rows marked derived use the blend&apos;s stated composition ratio, not a separately measured dose.
              Listed alphabetically; days since last dose is counted at the window end.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
