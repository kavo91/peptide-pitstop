/**
 * Doctor-readable per-step component breakdown for a BLEND peptide's titration
 * ladder — pure, no I/O. One row per step (sorted by stepIndex, never array
 * position), one column per component: "if you titrate KLOW, this is how each
 * compound's per-injection mass moves."
 *
 * Unit honesty (spec §6): per_week step doses are divided through the SAME
 * perInjectionDose seam the resolver uses; ml needs the prep concentration;
 * units is syringe-relative → the cell stays null (rendered as an em-dash),
 * never a guessed number.
 */
import { splitProspectiveDose, weakestBlendSource, roundSplitForDisplay, type BlendComponent, type BlendSource } from "./blends-core";
import { perInjectionDose } from "./titration/dose-basis";
import type { DoseUnit } from "./dosing/types";

export interface BreakdownStep {
  stepIndex: number;
  dose: string | number;
  doseInputUnit: string;
  durationDays: number | null;
}

export interface BlendStepRow {
  stepIndex: number;
  stepLabel: string; // e.g. "300 mcg"
  durationDays: number | null;
  /** Per-component mcg in component sortIndex order; null = unsplittable. */
  componentMcg: (number | null)[];
}

export interface BlendStepBreakdownData {
  componentNames: string[];
  source: BlendSource;
  rows: BlendStepRow[];
}

export function buildBlendStepBreakdown(args: {
  steps: BreakdownStep[];
  components: BlendComponent[];
  doseBasis: string | null;
  injectionsPerWeek: number | null;
  concentrationMcgPerMl?: string | null;
}): BlendStepBreakdownData | null {
  const { steps, components, doseBasis, injectionsPerWeek, concentrationMcgPerMl } = args;
  if (steps.length === 0 || components.length === 0) return null;
  const sortedComponents = [...components].sort((a, b) => a.sortIndex - b.sortIndex);
  const sortedSteps = [...steps].sort((a, b) => a.stepIndex - b.stepIndex);
  const fmt1 = (v: string | number) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : String(v);
  };
  const rows: BlendStepRow[] = sortedSteps.map((s) => {
    // Do NOT coerce an out-of-enum unit to mcg — an unknown unit is
    // unsplittable and must fail safe (raw label, em-dash cells).
    const known = (["mcg", "mg", "ml", "units"] as const).includes(s.doseInputUnit as DoseUnit);
    const per = known
      ? perInjectionDose({
          doseBasis: doseBasis === "per_week" ? "per_week" : "per_injection",
          value: s.dose.toString(),
          unit: s.doseInputUnit as DoseUnit,
          injectionsPerWeek: injectionsPerWeek ?? 0,
        })
      : null;
    const split = per ? splitProspectiveDose(per.value, per.unit, sortedComponents, concentrationMcgPerMl) : null;
    // Unresolvable per_week: the raw figure is a WEEKLY total — say so, exactly
    // as StepsEditor does, instead of printing it bare as if per-injection.
    const rawLabel =
      doseBasis === "per_week" ? `${fmt1(s.dose)} ${s.doseInputUnit} / week` : `${fmt1(s.dose)} ${s.doseInputUnit}`;
    const rounded = split ? roundSplitForDisplay(split.map((c) => c.doseMcg)) : null;
    return {
      stepIndex: s.stepIndex,
      stepLabel: per ? `${fmt1(per.value)} ${per.unit}` : rawLabel,
      durationDays: s.durationDays,
      componentMcg: rounded ?? sortedComponents.map(() => null),
    };
  });
  return { componentNames: sortedComponents.map((c) => c.componentName), source: weakestBlendSource(sortedComponents), rows };
}
