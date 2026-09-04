/**
 * Section 5 — one row per scan interval: the deltas beside their confounders.
 * Confounder cells are non-optional; missing intake prints the same-weight
 * "not logged — attribution blocked" and the whole row is visually demoted.
 */
import { Fragment } from "react";
import type { DeltaFlag } from "@/lib/body-comp-core";
import type { BodyInterval } from "@/lib/bodycomp-data";
import { BODY_COPY } from "@/lib/bodycomp-copy";
import { CARD, comparabilityPill, flagPill, fmtDateShort, num, signed } from "./format";

function DeltaCell({ d, unit, digits }: { d: DeltaFlag | null; unit: string; digits: number }) {
  if (!d) return <span className="text-muted">—</span>;
  const pill = flagPill(d);
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span>{signed(d.delta, digits)} {unit}</span>
      <span className={pill.cls} title={pill.title}>{pill.label}</span>
    </span>
  );
}

/**
 * Wellness median. When event days were removed the cell shows the median WITHOUT
 * those days, as "median (n, excl. N event days)"; otherwise the plain median.
 */
function Median({ m, excl, excludedDays, digits = 0, unit = "" }: { m: { median: number | null; n: number }; excl?: { median: number | null; n: number }; excludedDays?: number; digits?: number; unit?: string }) {
  const useExcl = excl != null && (excludedDays ?? 0) > 0;
  const shown = useExcl ? excl : m;
  return (
    <span className="flex flex-col items-end">
      <span>{num(shown.median, digits)}{unit && shown.median != null ? ` ${unit}` : ""}</span>
      <span className="text-[10px] text-muted">{useExcl ? `(n = ${shown.n}, excl. ${excludedDays} event day${excludedDays === 1 ? "" : "s"})` : `n = ${shown.n}`}</span>
    </span>
  );
}

function IntakeCell({ p, label }: { p: number; label: string }) {
  if (p < 80) {
    return (
      <span className="flex flex-col items-end">
        <span className="text-[10px] text-muted">{label} {p.toFixed(0)} % logged</span>
        <span className="font-bold text-ink">{BODY_COPY.attributionBlocked}</span>
      </span>
    );
  }
  return <span>{label} {p.toFixed(0)} % logged</span>;
}

export function IntervalTable({ intervals }: { intervals: BodyInterval[] }) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-medium text-muted">Intervals beside their confounders</h2>
      <p className="mb-3 text-xs text-muted">{BODY_COPY.intervalTableIntro}</p>
      <div className={`${CARD} overflow-x-auto`}>
        <table className="w-full min-w-[1320px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="py-1 pr-2 font-medium">Interval</th>
              <th className="py-1 pr-2 text-right font-medium">Δ fat</th>
              <th className="py-1 pr-2 text-right font-medium">Δ lean</th>
              <th className="py-1 pr-2 text-right font-medium">Δ ALM</th>
              <th className="py-1 pr-2 text-right font-medium">Δ VAT</th>
              <th className="py-1 pr-2 text-right font-medium">Δ RMR</th>
              <th className="py-1 pr-2 text-right font-medium">Training</th>
              <th className="py-1 pr-2 text-right font-medium">Sleep</th>
              <th className="py-1 pr-2 text-right font-medium">HRV</th>
              <th className="py-1 pr-2 text-right font-medium">RHR</th>
              <th className="py-1 pr-2 text-right font-medium">Steps</th>
              <th className="py-1 pr-2 text-right font-medium">Intake</th>
              <th className="py-1 pr-2 text-right font-medium">Weight days</th>
              <th className="py-1 pr-2 text-right font-medium">Partial days</th>
              <th className="py-1 pr-2 text-right font-medium">Illness d</th>
              <th className="py-1 pr-2 text-right font-medium">Travel d</th>
              <th className="py-1 text-right font-medium">Completeness</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {intervals.map((iv) => {
              const dim = iv.completeness.attributionBlocked;
              const comp = comparabilityPill(iv.comparability);
              return (
                <Fragment key={iv.to.id}>
                  <tr className={`border-t border-line/10 align-top ${dim ? "opacity-60" : ""}`}>
                    <td className="py-2 pr-2 text-ink">
                      <span className="block">{fmtDateShort(iv.from.scannedAt)} → {fmtDateShort(iv.to.scannedAt)}</span>
                      <span className="block text-[10px] text-muted">{iv.days} days</span>
                      <span className={`mt-0.5 ${comp.cls}`} title={comp.title}>{comp.label}</span>
                    </td>
                    <td className="py-2 pr-2 text-right"><DeltaCell d={iv.deltas.fat} unit="kg" digits={2} /></td>
                    <td className="py-2 pr-2 text-right"><DeltaCell d={iv.deltas.lean} unit="kg" digits={2} /></td>
                    <td className="py-2 pr-2 text-right"><DeltaCell d={iv.deltas.alm} unit="kg" digits={2} /></td>
                    <td className="py-2 pr-2 text-right"><DeltaCell d={iv.deltas.vat} unit="g" digits={0} /></td>
                    <td className="py-2 pr-2 text-right"><DeltaCell d={iv.deltas.rmr} unit="kcal" digits={0} /></td>
                    <td className="py-2 pr-2 text-right">
                      <span className="flex flex-col items-end">
                        <span>{iv.wellness.intensityMinutesSum} min</span>
                        <span className="text-[10px] text-muted">{iv.wellness.activityCountSum} activities · {iv.wellness.days} d</span>
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-right"><Median m={iv.wellness.sleepHours} excl={iv.wellnessExcludingEvents.sleepHours} excludedDays={iv.wellnessExcludingEvents.excludedEventDays} digits={1} unit="h" /></td>
                    <td className="py-2 pr-2 text-right"><Median m={iv.wellness.hrvMs} excl={iv.wellnessExcludingEvents.hrvMs} excludedDays={iv.wellnessExcludingEvents.excludedEventDays} unit="ms" /></td>
                    <td className="py-2 pr-2 text-right"><Median m={iv.wellness.restingHr} excl={iv.wellnessExcludingEvents.restingHr} excludedDays={iv.wellnessExcludingEvents.excludedEventDays} unit="bpm" /></td>
                    <td className="py-2 pr-2 text-right"><Median m={iv.wellness.steps} excl={iv.wellnessExcludingEvents.steps} excludedDays={iv.wellnessExcludingEvents.excludedEventDays} /></td>
                    <td className="py-2 pr-2 text-right">
                      <span className="flex flex-col items-end gap-0.5">
                        <IntakeCell p={iv.intake.caloriesPct} label="kcal" />
                        <IntakeCell p={iv.intake.proteinPct} label="protein" />
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-right">{iv.intake.weightDaysPct.toFixed(0)} %</td>
                    <td className="py-2 pr-2 text-right">{iv.wellness.excludedPartialDays}</td>
                    <td className="py-2 pr-2 text-right">
                      <span className="flex flex-col items-end">
                        <span>{iv.lifeEventDays.illnessDays}</span>
                        {iv.lifeEventDays.otherDays > 0 && <span className="text-[10px] text-muted">other {iv.lifeEventDays.otherDays}</span>}
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-right">{iv.lifeEventDays.travelDays}</td>
                    <td className="py-2 text-right">{iv.completeness.score} / 100</td>
                  </tr>
                  <tr className={dim ? "opacity-60" : ""}>
                    <td colSpan={17} className="pb-3 text-xs text-muted">{iv.sentence}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
