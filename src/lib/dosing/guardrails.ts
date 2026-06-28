/**
 * Dosing guardrails — typed safety checks. These are a primary safety control,
 * not UI polish. Each returns a structured warning the UI must surface.
 */
import Decimal from "decimal.js";
import type { DosingWarning, Syringe } from "./types";

/** Below this many units on an insulin syringe, measurement is unreliable. */
export const MIN_MEASURABLE_UNITS = new Decimal(2);
/** Flag rounding error above this fraction of the target dose. */
export const ROUNDING_ERROR_WARN_FRACTION = new Decimal("0.05"); // 5%

export function evaluateGuardrails(args: {
  targetVolumeMl: Decimal;
  rawUnits: Decimal;
  syringe: Syringe;
  targetMassMcg: Decimal;
  deliveredMassMcg: Decimal;
  remainingMl?: Decimal;
}): DosingWarning[] {
  const warnings: DosingWarning[] = [];
  const capacityMl = new Decimal(args.syringe.capacityMl);

  // 1. Does the dose physically fit the syringe? (hard block)
  if (args.targetVolumeMl.gt(capacityMl)) {
    warnings.push({
      code: "EXCEEDS_SYRINGE_CAPACITY",
      severity: "block",
      message: `Dose volume ${args.targetVolumeMl.toString()} mL exceeds the ${capacityMl.toString()} mL capacity of the ${args.syringe.name}. Use a larger syringe or split the dose.`,
    });
  }

  // 2. Enough left in the vial? (hard block when known)
  if (args.remainingMl != null && args.targetVolumeMl.gt(args.remainingMl)) {
    warnings.push({
      code: "EXCEEDS_REMAINING_VIAL",
      severity: "block",
      message: `Dose needs ${args.targetVolumeMl.toString()} mL but only ${args.remainingMl.toString()} mL remains in the vial.`,
    });
  }

  // 3. Too small to measure accurately on this syringe? (warn)
  if (
    args.syringe.graduationType === "units" &&
    args.rawUnits.gt(0) &&
    args.rawUnits.lt(MIN_MEASURABLE_UNITS)
  ) {
    warnings.push({
      code: "BELOW_MEASURABLE_MINIMUM",
      severity: "warn",
      message: `Draw is only ${args.rawUnits.toDecimalPlaces(2).toString()} units — hard to measure accurately. Consider a smaller syringe, or more dilution for a reconstituted vial.`,
    });
  }

  // 4. Whole-barrel draw — works but no headroom. (warn)
  if (args.targetVolumeMl.equals(capacityMl)) {
    warnings.push({
      code: "FULL_BARREL",
      severity: "warn",
      message: `Dose fills the entire ${args.syringe.name} with no headroom.`,
    });
  }

  // 5. Rounding error material relative to the target dose. (warn)
  if (args.targetMassMcg.gt(0)) {
    const errFraction = args.deliveredMassMcg
      .minus(args.targetMassMcg)
      .abs()
      .div(args.targetMassMcg);
    if (errFraction.gt(ROUNDING_ERROR_WARN_FRACTION)) {
      warnings.push({
        code: "ROUNDING_ERROR_HIGH",
        severity: "warn",
        message: `Rounding to the nearest mark delivers ${args.deliveredMassMcg.toDecimalPlaces(1).toString()} mcg vs the ${args.targetMassMcg.toDecimalPlaces(1).toString()} mcg target (${errFraction.times(100).toDecimalPlaces(1).toString()}%).`,
      });
    }
  }

  return warnings;
}
