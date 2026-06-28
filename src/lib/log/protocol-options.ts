/**
 * Build the Protocol picker options for the ad-hoc log form — pure, no I/O.
 *
 * Each option carries the protocol's CURRENT per-injection dose, resolved through
 * the shared `resolveCurrentDose` seam (the SAME path Today uses). SAFETY (§6):
 * a per_week protocol's weekly value is divided exactly once; if the injection
 * frequency can't be resolved, `doseValue` is "" so the picker leaves the dose
 * BLANK and submit stays disabled — never a raw weekly number.
 */
import { resolveCurrentDose } from "../titration/resolve-current";
import type { DeliveredLogInput, ProtocolForResolve } from "../titration/from-protocol";
import type { DoseUnit } from "../dosing/types";

/** The protocol shape the option builder needs (Prisma-compatible + delivered logs). */
export interface ProtocolForOptions extends ProtocolForResolve {
  id: string;
  peptideId: string;
  peptideName: string;
  /** This protocol's FULL delivered DoseLog history (resolver phase cursor needs it). */
  deliveredLogs: DeliveredLogInput[];
  /** Active preparation for this protocol's peptide, when one exists. */
  activePreparationId?: string;
}

export interface ProtocolDoseOption {
  protocolId: string;
  peptideId: string;
  peptideName: string;
  /** Active prep for the protocol's peptide; undefined → "needs reconstitution". */
  preparationId?: string;
  /** Resolved per-injection dose; "" when a per_week frequency can't be resolved. */
  doseValue: string;
  doseUnit: DoseUnit;
  /** "Phase N of M" style label, when titrating. */
  phaseLabel?: string;
}

export function buildProtocolDoseOptions(
  protocols: ProtocolForOptions[],
  now: Date = new Date(),
): ProtocolDoseOption[] {
  return protocols.map((p) => {
    const { doseValue, doseUnit } = resolveCurrentDose(p, p.deliveredLogs, now);
    return {
      protocolId: p.id,
      peptideId: p.peptideId,
      peptideName: p.peptideName,
      preparationId: p.activePreparationId,
      doseValue,
      doseUnit,
    };
  });
}
