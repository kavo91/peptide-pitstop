import type { DoseUnit } from "../dosing/types";
import { perInjectionDose } from "./dose-basis";

export interface PerInjectionPreviewArgs {
  value: string;
  unit: DoseUnit;
  injectionsPerWeek: number | null;
}

/**
 * Human-readable per-injection preview for a per_week dose entry, e.g.
 * "≈ 4 mg/injection at 2×/week". Returns null when the value is blank/non-numeric
 * or the frequency is missing/zero — the caller surfaces the guard instead.
 *
 * Pure + display-only: safe to call during client render (no Date/locale).
 */
export function perInjectionPreview(a: PerInjectionPreviewArgs): string | null {
  const value = a.value.trim();
  if (!value || !Number.isFinite(Number(value))) return null;
  const per = perInjectionDose({
    doseBasis: "per_week",
    value,
    unit: a.unit,
    injectionsPerWeek: a.injectionsPerWeek,
  });
  if (!per) return null;
  return `≈ ${per.value} ${per.unit}/injection at ${a.injectionsPerWeek}×/week`;
}
