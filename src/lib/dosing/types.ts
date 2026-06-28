/**
 * Dosing engine types.
 *
 * SAFETY-CRITICAL MODULE. Canonical internal units:
 *   - mass   : micrograms (mcg)
 *   - volume : millilitres (mL)
 *   - concentration: mcg per mL
 *
 * All arithmetic uses decimal.js. Never use the native `number` type for a
 * value that participates in a dose calculation.
 */
import Decimal from "decimal.js";

/** Unit a dose may be *entered* in. Distinct from a peptide's substance class. */
export type DoseUnit = "mcg" | "mg" | "ml" | "units";

/** How a peptide's strength is defined. IU substances never convert to/from mass. */
export type SubstanceClass = "mass" | "IU";

/** How a syringe barrel is graduated. */
export type GraduationType = "units" | "ml";

export interface Syringe {
  name: string;
  graduationType: GraduationType;
  /** Units per mL. U-100 = 100. Only meaningful for unit-graduated syringes. */
  unitsPerMl: number;
  /** Total barrel capacity in mL (e.g. 0.3 / 0.5 / 1.0). */
  capacityMl: Decimal.Value;
  /** Total barrel capacity in units (e.g. 30 / 50 / 100). */
  capacityUnits: number;
  /** Smallest measurable mark, in the barrel's native scale (units or mL). */
  increment: Decimal.Value;
}

/** A vial's prepared state — the source of concentration for every dose. */
export interface Preparation {
  prepType: "reconstituted" | "premixed";
  /** Concentration in mcg/mL — computed for reconstituted, entered for premixed. */
  concentrationMcgPerMl: Decimal;
}

export interface DoseInput {
  value: Decimal.Value;
  unit: DoseUnit;
}

export type WarningSeverity = "warn" | "block";

export interface DosingWarning {
  code: string;
  severity: WarningSeverity;
  message: string;
}

export interface DrawResult {
  /** What the user asked for, canonicalised. */
  targetMassMcg: Decimal;
  targetVolumeMl: Decimal;
  /** Unrounded units (informational). */
  rawUnits: Decimal;
  /** Value to draw to, in the syringe's native scale. */
  markingValue: Decimal;
  markingScale: GraduationType;
  /** What is actually delivered after rounding to the syringe increment. */
  deliveredMassMcg: Decimal;
  deliveredVolumeMl: Decimal;
  /** deliveredMass − targetMass. Positive = slight overdose from rounding. */
  roundingErrorMcg: Decimal;
  warnings: DosingWarning[];
}
