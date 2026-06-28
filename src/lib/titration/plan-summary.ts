/**
 * Pure summary of a titration ramp for the edit-protocol calc chart. Turns the
 * authored steps + injection frequency into the per-phase numbers the chart draws
 * and labels — using the SAME math the live resolver uses (phaseTargets for the
 * dose-count, perInjectionDose for the per-injection value), so what you see while
 * editing matches what the tracker will actually do.
 *
 * "How it's calculating": doses-per-phase = round((durationDays / 7) × injectionsPerWeek).
 *
 * No I/O. The final step may be indefinite (durationDays = null) → its phase has
 * no end week / dose count (maintenance).
 */
import { phaseTargets } from "./phase";
import { perInjectionDose } from "./dose-basis";
import type { DoseUnit } from "../dosing/types";

export interface PlanStepInput {
  stepIndex: number;
  dose: string;
  doseInputUnit: string;
  durationDays: number | null;
}

export interface TitrationPhaseSummary {
  stepIndex: number;
  /** Authored dose for this step (weekly total for per_week, else per-injection). */
  dose: string;
  unit: string;
  /** Per-injection value as a string; null when per_week and frequency is unresolved. */
  perInjection: string | null;
  /** Per-injection value as a number for chart scaling; null when unresolved. */
  perInjectionNum: number | null;
  durationDays: number | null;
  /** round((durationDays/7) × injectionsPerWeek); null = indefinite or unresolved. */
  doses: number | null;
  weeks: number | null;
  startWeek: number;
  endWeek: number | null;
  indefinite: boolean;
}

export interface TitrationPlan {
  phases: TitrationPhaseSummary[];
  injectionsPerWeek: number | null;
  doseBasis: "per_injection" | "per_week";
  totalWeeks: number | null; // null when a phase is indefinite
  totalDoses: number | null; // null when a phase is indefinite or frequency unresolved
  hasIndefinite: boolean;
  /** false when per_week but the injection frequency is unknown (can't divide/count). */
  resolved: boolean;
  /** y-axis bounds over per-injection values (0 when unresolved). */
  minPerInjection: number;
  maxPerInjection: number;
}

export function titrationPlanSummary(args: {
  steps: PlanStepInput[];
  injectionsPerWeek: number | null;
  doseBasis: string;
}): TitrationPlan {
  const ipw = args.injectionsPerWeek;
  const doseBasis: "per_injection" | "per_week" = args.doseBasis === "per_week" ? "per_week" : "per_injection";
  const ordered = [...args.steps].sort((a, b) => a.stepIndex - b.stepIndex);

  // per_week needs a known frequency to divide AND to count doses. per_injection
  // can always show the dose ramp; dose-counts still need a frequency.
  const freqOk = ipw != null && ipw > 0;
  const resolved = doseBasis === "per_week" ? freqOk : true;

  // Dose-counts via the resolver's own phaseTargets (identical rounding).
  const targets = freqOk ? phaseTargets(ordered, ipw!) : ordered.map(() => null);

  let cumWeek = 0;
  const phases: TitrationPhaseSummary[] = ordered.map((s, i) => {
    const indefinite = s.durationDays == null;
    const weeks = indefinite ? null : s.durationDays! / 7;
    const startWeek = cumWeek;
    const endWeek = weeks == null ? null : cumWeek + weeks;
    if (weeks != null) cumWeek = endWeek!;

    const per = perInjectionDose({ doseBasis, value: s.dose, unit: s.doseInputUnit as DoseUnit, injectionsPerWeek: ipw });
    const perInjection = per ? per.value : (doseBasis === "per_week" ? null : s.dose);
    const perInjectionNum = perInjection != null && perInjection !== "" ? Number(perInjection) : null;

    return {
      stepIndex: s.stepIndex,
      dose: s.dose,
      unit: s.doseInputUnit,
      perInjection,
      perInjectionNum: perInjectionNum != null && Number.isFinite(perInjectionNum) ? perInjectionNum : null,
      durationDays: s.durationDays,
      doses: targets[i],
      weeks,
      startWeek,
      endWeek,
      indefinite,
    };
  });

  const hasIndefinite = phases.some((p) => p.indefinite);
  const totalWeeks = hasIndefinite ? null : phases.reduce((a, p) => a + (p.weeks ?? 0), 0);
  const totalDoses = !resolved || phases.some((p) => p.doses == null)
    ? null
    : phases.reduce((a, p) => a + (p.doses ?? 0), 0);

  const nums = phases.map((p) => p.perInjectionNum).filter((n): n is number => n != null);
  const minPerInjection = nums.length ? Math.min(...nums) : 0;
  const maxPerInjection = nums.length ? Math.max(...nums) : 0;

  return {
    phases, injectionsPerWeek: ipw, doseBasis,
    totalWeeks, totalDoses, hasIndefinite, resolved,
    minPerInjection, maxPerInjection,
  };
}
