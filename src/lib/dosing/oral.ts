/**
 * Oral / non-injection dose assembly — pure functions, no I/O, no framework.
 *
 * Oral doses have NO preparation, NO syringe, NO volume/needle maths. The user
 * enters a mass (mcg or mg) directly; we canonicalise to mcg the same way the
 * injection engine does (× 1000 for mg) and store it. The DoseLog still has
 * NOT-NULL `volumeMl`, so oral writes a `0` sentinel (no liquid was drawn).
 *
 * Injection behaviour is untouched: this module is a separate additive branch
 * used only when a peptide's `route == "oral"`.
 */
import Decimal from "decimal.js";
import { MCG_PER_MG } from "./engine";
import type { DoseUnit } from "./types";

/** A dose unit valid for an oral medication (mass only — no volume/needle units). */
export type OralDoseUnit = "mcg" | "mg";

export function isOralDoseUnit(unit: string): unit is OralDoseUnit {
  return unit === "mcg" || unit === "mg";
}

/**
 * Canonicalise an oral dose (mass entered as mcg or mg) to micrograms.
 * Throws on a non-mass unit (ml/units make no sense without a preparation) or a
 * negative/non-finite value — the caller validates before persisting.
 */
export function oralDoseMcg(value: Decimal.Value, unit: DoseUnit): Decimal {
  if (!isOralDoseUnit(unit)) {
    throw new Error(`Oral doses must be entered in mcg or mg, not "${unit}"`);
  }
  const v = new Decimal(value);
  if (v.lt(0)) throw new Error("Dose value cannot be negative");
  return unit === "mg" ? v.times(MCG_PER_MG) : v;
}

/**
 * The DoseLog column values for an ORAL dose. Mirrors the field set the
 * injection path writes, but with every injection-specific field neutralised:
 *   - preparationId / syringeId / syringeUnits / injectionSite → null
 *   - volumeMl → "0" (NOT-NULL sentinel; no liquid drawn)
 *   - route → "oral"
 * doseMcg is the canonicalised mass; doseInputUnit is the unit the user entered.
 *
 * Pure: takes the validated inputs, returns a plain object. The server action
 * adds identity, timing, planned-dose linking, and clientUuid around this.
 */
export interface OralDoseRecord {
  preparationId: null;
  syringeId: null;
  syringeUnits: null;
  injectionSite: null;
  volumeMl: "0";
  route: "oral";
  doseMcg: string;
  doseInputUnit: DoseUnit;
}

export function buildOralDoseRecord(args: { doseValue: Decimal.Value; doseUnit: DoseUnit }): OralDoseRecord {
  const doseMcg = oralDoseMcg(args.doseValue, args.doseUnit);
  return {
    preparationId: null,
    syringeId: null,
    syringeUnits: null,
    injectionSite: null,
    volumeMl: "0",
    route: "oral",
    doseMcg: doseMcg.toString(),
    doseInputUnit: args.doseUnit,
  };
}

/**
 * Patient-facing label for a logged dose. Injection doses show their canonical
 * mass in mcg (anchored to a measured volume). Oral doses have no volume/syringe
 * context, so they show the entered amount in its input unit (mg = mcg/1000) for
 * clarity. Null-safe on a missing/empty unit (falls back to mcg).
 */
export function formatLoggedDoseDisplay(args: { doseMcg: string; doseInputUnit: string; route: string }): string {
  const mcg = Number(args.doseMcg);
  if (args.route === "oral") {
    if (args.doseInputUnit === "mg") return `${(mcg / 1000).toLocaleString()} mg`;
    return `${mcg.toLocaleString()} ${args.doseInputUnit || "mcg"}`;
  }
  return `${mcg.toLocaleString()} mcg`;
}
