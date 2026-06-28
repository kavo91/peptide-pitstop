import Decimal from "decimal.js";
import type { DoseUnit } from "../dosing/types";

export interface RampParams {
  startDose: string;
  targetDose: string;
  increment: string;
  weeksPerStep: number;
  doseInputUnit: DoseUnit;
}

export interface GeneratedStep {
  stepIndex: number;
  dose: string;
  doseInputUnit: DoseUnit;
  durationDays: number | null; // null on the final (maintenance) step
}

/** Parse a dose string into a finite Decimal or throw a clear domain error (never a raw DecimalError). */
function parseDose(raw: string, field: string): Decimal {
  let d: Decimal;
  try {
    d = new Decimal(raw);
  } catch {
    throw new Error(`${field} must be a number`);
  }
  if (!d.isFinite()) throw new Error(`${field} must be a number`);
  return d;
}

/** Build start→target in `increment` jumps, each `weeksPerStep` long; final step indefinite. */
export function generateRamp(p: RampParams): GeneratedStep[] {
  // Validate numeric parse FIRST so callers get a clear domain error, not a raw DecimalError.
  const start = parseDose(p.startDose, "startDose");
  const target = parseDose(p.targetDose, "targetDose");
  const inc = parseDose(p.increment, "increment");
  if (start.gt(target)) throw new Error("startDose must be <= targetDose");
  if (inc.lte(0)) throw new Error("increment must be > 0");
  if (!Number.isFinite(p.weeksPerStep) || p.weeksPerStep <= 0) throw new Error("weeksPerStep must be > 0");

  const doses: Decimal[] = [];
  let cur = start;
  while (cur.lt(target)) {
    doses.push(cur);
    cur = cur.plus(inc);
  }
  doses.push(target); // always finish exactly on target (clamps a non-multiple last jump)

  const durationDays = Math.round(p.weeksPerStep * 7);
  return doses.map((d, i) => ({
    stepIndex: i,
    dose: d.toString(),
    doseInputUnit: p.doseInputUnit,
    durationDays: i === doses.length - 1 ? null : durationDays,
  }));
}
