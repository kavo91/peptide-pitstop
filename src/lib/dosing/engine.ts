/**
 * Reconstitution & dosing engine — pure functions, no I/O, no framework.
 *
 * This is the highest-stakes code in the application. Every function is total
 * and deterministic; all maths is decimal. See engine.test.ts for the contract.
 */
import Decimal from "decimal.js";
import type {
  DoseInput,
  DrawResult,
  Preparation,
  Syringe,
} from "./types";
import { evaluateGuardrails } from "./guardrails";

// Decimal config: plenty of precision, round half-up for display rounding.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const MCG_PER_MG = new Decimal(1000);

export const mgToMcg = (mg: Decimal.Value): Decimal =>
  new Decimal(mg).times(MCG_PER_MG);
export const mcgToMg = (mcg: Decimal.Value): Decimal =>
  new Decimal(mcg).div(MCG_PER_MG);

/**
 * Concentration for a *reconstituted* (dry) vial.
 *   concentration (mcg/mL) = (total mass in mg × 1000) / BAC water (mL)
 */
export function computeConcentrationMcgPerMl(args: {
  totalMassMg: Decimal.Value;
  bacWaterMl: Decimal.Value;
}): Decimal {
  const bac = new Decimal(args.bacWaterMl);
  if (bac.lte(0)) {
    throw new Error("BAC water volume must be greater than zero");
  }
  return mgToMcg(args.totalMassMg).div(bac);
}

/**
 * Canonicalise any dose input into mass (mcg) and volume (mL) given the
 * preparation's concentration and (for unit input) the syringe's units/mL.
 */
export function canonicaliseDose(args: {
  dose: DoseInput;
  preparation: Preparation;
  syringe: Syringe;
}): { massMcg: Decimal; volumeMl: Decimal } {
  const { dose, preparation, syringe } = args;
  const conc = preparation.concentrationMcgPerMl;
  const value = new Decimal(dose.value);

  if (conc.lte(0)) throw new Error("Concentration must be greater than zero");
  if (value.lt(0)) throw new Error("Dose value cannot be negative");

  switch (dose.unit) {
    case "mcg": {
      const massMcg = value;
      return { massMcg, volumeMl: massMcg.div(conc) };
    }
    case "mg": {
      const massMcg = mgToMcg(value);
      return { massMcg, volumeMl: massMcg.div(conc) };
    }
    case "ml": {
      const volumeMl = value;
      return { massMcg: volumeMl.times(conc), volumeMl };
    }
    case "units": {
      const volumeMl = value.div(syringe.unitsPerMl);
      return { massMcg: volumeMl.times(conc), volumeMl };
    }
    default: {
      // Exhaustiveness guard.
      const _never: never = dose.unit;
      throw new Error(`Unsupported dose unit: ${String(_never)}`);
    }
  }
}

/** Round a value to the nearest multiple of `increment` (half-up). */
function roundToIncrement(value: Decimal, increment: Decimal.Value): Decimal {
  const inc = new Decimal(increment);
  if (inc.lte(0)) return value;
  return value.div(inc).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(inc);
}

/**
 * Compute everything needed to draw and log a dose on a specific syringe.
 * Handles both unit-graduated (insulin) and mL-graduated syringes, rounds to
 * the measurable increment, reports the actually-delivered dose, and attaches
 * guardrail warnings.
 *
 * Optional `remainingMl` enables the "exceeds remaining vial" guardrail.
 */
export function computeDraw(args: {
  dose: DoseInput;
  preparation: Preparation;
  syringe: Syringe;
  remainingMl?: Decimal.Value;
}): DrawResult {
  const { dose, preparation, syringe } = args;
  const conc = preparation.concentrationMcgPerMl;

  const { massMcg: targetMassMcg, volumeMl: targetVolumeMl } = canonicaliseDose({
    dose,
    preparation,
    syringe,
  });

  const rawUnits = targetVolumeMl.times(syringe.unitsPerMl);

  let markingValue: Decimal;
  let deliveredVolumeMl: Decimal;

  if (syringe.graduationType === "units") {
    const roundedUnits = roundToIncrement(rawUnits, syringe.increment);
    markingValue = roundedUnits;
    deliveredVolumeMl = roundedUnits.div(syringe.unitsPerMl);
  } else {
    const roundedMl = roundToIncrement(targetVolumeMl, syringe.increment);
    markingValue = roundedMl;
    deliveredVolumeMl = roundedMl;
  }

  const deliveredMassMcg = deliveredVolumeMl.times(conc);
  const roundingErrorMcg = deliveredMassMcg.minus(targetMassMcg);

  const warnings = evaluateGuardrails({
    targetVolumeMl,
    rawUnits,
    syringe,
    targetMassMcg,
    deliveredMassMcg,
    remainingMl: args.remainingMl != null ? new Decimal(args.remainingMl) : undefined,
  });

  return {
    targetMassMcg,
    targetVolumeMl,
    rawUnits,
    markingValue,
    markingScale: syringe.graduationType,
    deliveredMassMcg,
    deliveredVolumeMl,
    roundingErrorMcg,
    warnings,
  };
}

/** Doses obtainable from a vial of `totalVolumeMl` at a given per-dose volume. */
export function dosesPerVial(args: {
  totalVolumeMl: Decimal.Value;
  doseVolumeMl: Decimal.Value;
}): Decimal {
  const dv = new Decimal(args.doseVolumeMl);
  if (dv.lte(0)) throw new Error("Dose volume must be greater than zero");
  return new Decimal(args.totalVolumeMl).div(dv).floor();
}
