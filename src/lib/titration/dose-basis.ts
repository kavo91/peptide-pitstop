import Decimal from "decimal.js";
import type { DoseUnit } from "../dosing/types";

export interface PerInjectionArgs {
  doseBasis: "per_injection" | "per_week";
  value: string;
  unit: DoseUnit;
  injectionsPerWeek: number | null;
}

/**
 * The ONE place a protocol/step dose becomes a per-injection amount.
 * per_week divides the weekly dose by injections/week; per_injection passes through.
 * Returns null when per_week can't be resolved (missing/zero frequency) — callers
 * must fall back rather than risk a 0/NaN dose.
 */
export function perInjectionDose(args: PerInjectionArgs): { value: string; unit: DoseUnit } | null {
  if (args.doseBasis !== "per_week") return { value: args.value, unit: args.unit };
  if (!args.injectionsPerWeek || args.injectionsPerWeek <= 0) return null;
  // Clamp display precision to 6dp so a non-terminating division (e.g. 8/3) can't
  // leak a 40-digit string. 6dp is sub-microgram for mg/mcg doses; the real
  // syringe rounding still happens downstream in computeDraw.
  const per = new Decimal(args.value).div(args.injectionsPerWeek).toDecimalPlaces(6);
  return { value: per.toString(), unit: args.unit };
}
