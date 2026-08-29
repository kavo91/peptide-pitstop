import Decimal from "decimal.js";

/** Daily fixed_times schedule rule (no specific time) — matches ProtocolForm's default entry. */
export const DAILY_SCHEDULE_RULE = JSON.stringify([{ dayPattern: { kind: "daily" }, times: [] }]);

function pos(v: string): Decimal | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  try {
    const d = new Decimal(s);
    return d.isFinite() && d.gt(0) ? d : null;
  } catch {
    return null;
  }
}

/** Total peptide mass in a premixed vial, in mg. concentration(mcg/ml) * volume(ml) / 1000. */
export function vialLabelStrengthMg(concentrationMcgPerMl: string, vialSizeMl: string): string | null {
  const c = pos(concentrationMcgPerMl);
  const v = pos(vialSizeMl);
  if (!c || !v) return null;
  return c.times(v).div(1000).toString();
}

/** Mass delivered per injection, in mcg. doseMl * concentration(mcg/ml). dose may be 0. */
export function perInjectionMcg(doseMl: string, concentrationMcgPerMl: string): string | null {
  const c = pos(concentrationMcgPerMl);
  if (!c) return null;
  const s = (doseMl ?? "").trim();
  if (!s) return null;
  let d: Decimal;
  try {
    d = new Decimal(s);
  } catch {
    return null;
  }
  if (!d.isFinite() || d.lt(0)) return null;
  return d.times(c).toString();
}

/**
 * Resolved current-dose block for a stack component — pure, no I/O.
 *
 * A component is "titrating" exactly when the resolver would treat it so
 * (steps present AND startDate set — resolve.ts:23); everything else returns
 * null so no-steps stacks render byte-identically to before. SAFETY (§6): the
 * dose comes ONLY from the shared resolveCurrentDose seam ("" stays "" — the
 * card must render a hint, never a raw number), and the ml↔mcg alt display is
 * derived from the resolved value, never from step.dose/targetDose.
 */
import { resolveTitration } from "../titration/resolve";
import { buildResolveInput, type ProtocolForResolve, type DeliveredLogInput } from "../titration/from-protocol";
import { perInjectionDose } from "../titration/dose-basis";
import { dosesPerWeek } from "../schedule/frequency";
import type { DoseUnit } from "../dosing/types";

export interface StackComponentResolution {
  doseValue: string; // "" = unresolvable (fail-safe)
  doseUnit: string;
  /** e.g. "≈ 0.06 ml" for a mcg dose, "≈ 300 mcg" for an ml dose; null when no prep/conversion. */
  altDisplay: string | null;
  phaseIndex: number;
  phaseCount: number;
  deliveredInPhase: number;
  targetInPhase: number | null; // null on the indefinite final phase
}

export function stackComponentResolution(
  protocol: ProtocolForResolve,
  deliveredLogs: DeliveredLogInput[],
  concentrationMcgPerMl: string | null,
  now: Date = new Date(),
): StackComponentResolution | null {
  if (protocol.steps.length === 0 || protocol.startDate == null) return null;
  const resolved = resolveTitration(
    buildResolveInput({ protocol, deliveredLogs, range: { start: now, end: now }, now }),
  );
  const { phaseProgress } = resolved;
  if (!phaseProgress) return null; // resolver disagrees it titrates — trust it

  // Today's slot when one resolves; otherwise (pre-start, off-schedule, past
  // end) the ACTIVE STEP's dose through the same sanctioned perInjectionDose
  // divide — never the flat targetDose fallback, which showed the maintenance
  // volume as "current" for a ladder that hasn't started.
  const slot = resolved.slots[0] ?? null;
  let doseValue: string;
  let doseUnit: string;
  let displayPhase: number;
  if (slot) {
    doseValue = slot.perInjectionValue;
    doseUnit = slot.perInjectionUnit;
    displayPhase = slot.phaseIndex ?? phaseProgress.phaseIndex;
  } else {
    const sorted = [...protocol.steps].sort((a, b) => a.stepIndex - b.stepIndex);
    const step = sorted[Math.min(phaseProgress.phaseIndex, sorted.length - 1)];
    const unit = (["mcg", "mg", "ml", "units"].includes(step.doseInputUnit) ? step.doseInputUnit : "mcg") as DoseUnit;
    const per = perInjectionDose({
      doseBasis: protocol.doseBasis === "per_week" ? "per_week" : "per_injection",
      value: step.dose.toString(),
      unit,
      injectionsPerWeek: dosesPerWeek(protocol.scheduleRule),
    });
    doseValue = per?.value ?? "";
    doseUnit = per?.unit ?? unit;
    displayPhase = phaseProgress.phaseIndex;
  }
  // On the last day of a phase the slot's (pre-dose) value belongs to the OLD
  // phase while phaseProgress already counts today's log — pairing them invites
  // drawing the old dose for the new phase. Show the slot's own phase, and drop
  // the x/y counts whenever the two disagree.
  const countsAlign = displayPhase === phaseProgress.phaseIndex;

  let altDisplay: string | null = null;
  if (doseValue !== "" && concentrationMcgPerMl) {
    try {
      const conc = new Decimal(concentrationMcgPerMl);
      const v = new Decimal(doseValue);
      if (conc.gt(0) && v.isFinite()) {
        if (doseUnit === "ml") altDisplay = `≈ ${v.times(conc).toDecimalPlaces(1)} mcg`;
        else if (doseUnit === "mcg") altDisplay = `≈ ${v.div(conc).toDecimalPlaces(3)} ml`;
        else if (doseUnit === "mg") altDisplay = `≈ ${v.times(1000).div(conc).toDecimalPlaces(3)} ml`;
        // "units" is syringe-dependent — no honest conversion here.
      }
    } catch {
      altDisplay = null;
    }
  }
  return {
    doseValue,
    doseUnit,
    altDisplay,
    phaseIndex: displayPhase,
    phaseCount: phaseProgress.phaseCount,
    deliveredInPhase: countsAlign ? phaseProgress.deliveredInPhase : 0,
    targetInPhase: countsAlign ? phaseProgress.targetInPhase : null,
  };
}
