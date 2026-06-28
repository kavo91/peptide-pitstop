"use client";

/**
 * TitrationCalcChart — a live preview of the titration ramp on the edit-protocol
 * screen. Recomputes from the saved steps (via titrationPlanSummary, the SAME
 * math the live resolver uses) every time a step is added/edited/removed, so you
 * can see how the ramp and its per-phase dose-counts change as you set it up.
 *
 * Shows: a stepped per-injection dose curve over weeks, each phase annotated with
 * its computed dose-count, and a one-line explainer of the calculation. The final
 * indefinite step renders as an open-ended (dashed) maintenance segment.
 *
 * Colours are theme tokens (rgb(var(--token))) so it stays legible on dark carbon
 * and the light Gulf palette alike.
 */
import { titrationPlanSummary, type PlanStepInput } from "@/lib/titration/plan-summary";

const W = 320;
const H = 188;
const PAD = { top: 16, right: 14, bottom: 30, left: 34 };

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function TitrationCalcChart({
  steps,
  injectionsPerWeek,
  doseBasis,
  startDate = null,
  nowWeek = null,
}: {
  steps: PlanStepInput[];
  injectionsPerWeek: number | null;
  doseBasis: string;
  /** Protocol start date (ISO) — when set, the x-axis shows real dates. */
  startDate?: string | null;
  /** Weeks elapsed since startDate at request time — draws a "now" marker. */
  nowWeek?: number | null;
}) {
  if (steps.length === 0) return null;

  // When the protocol has a start date, label the time axis with real calendar
  // dates (start + week·7d) instead of relative week numbers.
  const start = startDate ? new Date(startDate) : null;
  const startValid = start != null && !Number.isNaN(start.getTime());
  const weekDate = (wk: number): string => {
    const d = new Date(start!.getTime() + wk * 7 * 86_400_000);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  };

  const plan = titrationPlanSummary({ steps, injectionsPerWeek, doseBasis });

  // per_week with no schedule → can't divide or count. Tell the user what to fix.
  if (!plan.resolved) {
    return (
      <div className="rounded-card bg-surface p-4 text-sm text-muted shadow-sm ring-1 ring-line/10">
        <p className="font-medium text-ink">Titration ramp</p>
        <p className="mt-1">Set an injection schedule on this protocol to preview the ramp — a weekly dose needs the injection frequency to split into per-injection doses.</p>
      </div>
    );
  }

  // Plot domain. The indefinite final phase gets a short visual tail so it reads
  // as "continues" rather than ending at the last step-up.
  const lastTimedEnd = plan.phases.reduce((a, p) => (p.endWeek != null ? Math.max(a, p.endWeek) : a), 0);
  const tail = plan.hasIndefinite ? Math.max(2, lastTimedEnd * 0.22) : 0;
  const xMax = Math.max(1, lastTimedEnd + tail);
  const yMax = Math.max(plan.maxPerInjection * 1.2, plan.maxPerInjection + 0.5);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (wk: number) => PAD.left + (wk / xMax) * innerW;
  const y = (dose: number) => PAD.top + innerH - (dose / yMax) * innerH;

  // Build the stepped line: a horizontal run per phase at its per-injection dose,
  // joined by vertical risers between phases.
  type Pt = { wk: number; dose: number };
  const pts: Pt[] = [];
  plan.phases.forEach((p) => {
    if (p.perInjectionNum == null) return;
    const start = p.startWeek;
    const end = p.endWeek ?? xMax; // indefinite → run to the right edge
    pts.push({ wk: start, dose: p.perInjectionNum });
    pts.push({ wk: end, dose: p.perInjectionNum });
  });
  const path = pts.map((pt, i) => `${i === 0 ? "M" : "L"}${x(pt.wk).toFixed(1)},${y(pt.dose).toFixed(1)}`).join(" ");

  // y-axis ticks: 0 and the max per-injection dose (plus the distinct phase doses).
  const yTicks = Array.from(new Set([0, ...plan.phases.map((p) => p.perInjectionNum).filter((n): n is number => n != null)]))
    .sort((a, b) => a - b);

  const ipwLabel = plan.injectionsPerWeek != null ? fmt(plan.injectionsPerWeek) : "?";

  return (
    <div className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">Titration ramp</p>
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted tabular-nums">
          {plan.totalDoses != null ? `${plan.totalDoses} doses` : "open-ended"}
          {plan.totalWeeks != null ? ` · ${fmt(plan.totalWeeks)} wk` : ""}
        </p>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
        aria-label={`Titration ramp: ${plan.phases.map((p) => `${p.dose}${p.unit}${p.doses != null ? ` for ${p.doses} doses` : " maintenance"}`).join(", ")}`}>
        {/* y gridlines + dose labels */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.left} y1={y(t)} x2={W - PAD.right} y2={y(t)}
              stroke="rgb(var(--line) / 0.15)" strokeWidth="1" strokeDasharray={t === 0 ? undefined : "3 3"} />
            <text x={PAD.left - 4} y={y(t) + 3} textAnchor="end"
              className="fill-muted font-mono" style={{ fontSize: 8 }}>{fmt(t)}</text>
          </g>
        ))}

        {/* phase shading + step-up markers + dose-count labels */}
        {plan.phases.map((p) => {
          if (p.perInjectionNum == null) return null;
          const xs = x(p.startWeek);
          const xe = x(p.endWeek ?? xMax);
          const yd = y(p.perInjectionNum);
          const mid = (xs + xe) / 2;
          return (
            <g key={p.stepIndex}>
              {/* shaded column under the segment */}
              <rect x={xs} y={yd} width={Math.max(0, xe - xs)} height={PAD.top + innerH - yd}
                fill="rgb(var(--accent-2) / 0.08)" />
              {/* step-up vertical guide at the phase start (skip first) */}
              {p.stepIndex !== plan.phases[0].stepIndex && (
                <line x1={xs} y1={PAD.top} x2={xs} y2={PAD.top + innerH}
                  stroke="rgb(var(--line) / 0.25)" strokeWidth="1" strokeDasharray="2 2" />
              )}
              {/* dose-count label above the segment */}
              <text x={mid} y={yd - 4} textAnchor="middle"
                className="fill-muted font-mono tabular-nums" style={{ fontSize: 8 }}>
                {p.indefinite ? "maint." : `${p.doses}×`}
              </text>
            </g>
          );
        })}

        {/* the ramp line */}
        <path d={path} fill="none" stroke="rgb(var(--accent-2))" strokeWidth="2.5"
          strokeLinejoin="round" strokeLinecap="round"
          strokeDasharray={plan.hasIndefinite ? undefined : undefined} />
        {/* open-ended arrow on the indefinite tail */}
        {plan.hasIndefinite && pts.length >= 2 && (
          <text x={W - PAD.right} y={y(pts[pts.length - 1].dose) - 4} textAnchor="end"
            className="font-bold" style={{ fontSize: 10, fill: "rgb(var(--accent-2))" }}>›</text>
        )}

        {/* "now" marker — where you are on the ramp today (only when dated + in range) */}
        {startValid && nowWeek != null && nowWeek >= 0 && (
          <g>
            <line x1={x(Math.min(nowWeek, xMax))} y1={PAD.top} x2={x(Math.min(nowWeek, xMax))} y2={PAD.top + innerH}
              stroke="rgb(var(--accent))" strokeWidth="1.5" strokeDasharray="3 2" />
            <text x={x(Math.min(nowWeek, xMax))} y={PAD.top - 6} textAnchor="middle"
              className="font-mono uppercase" style={{ fontSize: 8, letterSpacing: 0.5, fill: "rgb(var(--accent))" }}>now</text>
          </g>
        )}

        {/* x-axis ticks: each phase start — real dates when the protocol has a start date, else relative weeks */}
        {plan.phases.map((p) => (
          <text key={`x${p.stepIndex}`} x={x(p.startWeek)} y={H - PAD.bottom + 12} textAnchor="middle"
            className="fill-muted font-mono tabular-nums" style={{ fontSize: 8 }}>
            {startValid ? weekDate(p.startWeek) : fmt(p.startWeek)}
          </text>
        ))}
        <text x={PAD.left + innerW / 2} y={H - 4} textAnchor="middle"
          className="fill-muted font-mono uppercase" style={{ fontSize: 8, letterSpacing: 0.5 }}>
          {startValid ? `from ${weekDate(0)}` : "weeks"}
        </text>
      </svg>

      {/* explainer: how the dose-count is calculated */}
      <p className="mt-1 text-[11px] text-muted">
        Doses per phase = weeks × {ipwLabel} inj/wk (rounded).
        {plan.doseBasis === "per_week" && " Weekly dose shown split per injection."}
      </p>
    </div>
  );
}
