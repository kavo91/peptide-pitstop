import type { TitrationStep } from "../schedule/schedule";

/** Per-phase target dose-count from authored durations. null = indefinite final phase. */
export function phaseTargets(steps: TitrationStep[], injectionsPerWeek: number): (number | null)[] {
  const ordered = [...steps].sort((a, b) => a.stepIndex - b.stepIndex);
  return ordered.map((s) => {
    if (s.durationDays == null) return null;
    // Guard hand-authored garbage: a negative duration can never be a real phase
    // length and would otherwise produce a negative dose-count target.
    if (s.durationDays < 0) throw new Error("durationDays must be >= 0");
    return Math.round((s.durationDays / 7) * injectionsPerWeek);
  });
}

/** Index of the phase active after `deliveredCount` doses (cumulative targets). */
export function activePhaseAt(targets: (number | null)[], deliveredCount: number): number {
  let cum = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (t == null) return i;           // indefinite final — never advances past
    cum += t;
    if (deliveredCount < cum) return i;
  }
  return targets.length - 1;           // delivered beyond all timed phases
}
