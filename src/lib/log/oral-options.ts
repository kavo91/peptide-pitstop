/**
 * Build the oral-medication options for the /log page — pure, no I/O.
 *
 * Each oral peptide is pre-linked to its single active protocol (if any) so the
 * oral log attributes and links the planned dose. The pre-filled dose comes from
 * `resolveCurrentDose` — the SAME seam /today and the injection picker use — so
 * a per_week target is divided once, a titrating protocol shows its active step
 * on a dose day (on a non-dose day the resolver's divided-target fallback, as
 * everywhere else), and an unresolvable frequency leaves the field BLANK. A raw `targetDose` must
 * never reach the input: it is one tap from being logged.
 */
import { resolveCurrentDose } from "../titration/resolve-current";
import type { ProtocolForOptions } from "./protocol-options";

/** An oral peptide with its active protocols (Prisma-compatible). */
export interface OralPeptideForOptions {
  id: string;
  name: string;
  protocols: { id: string; doseInputUnit: string | null; targetDose?: { toString(): string } | null }[];
}

export interface OralLogOption {
  peptideId: string;
  peptideName: string;
  protocolId?: string;
  initialDoseValue: string;
  initialDoseUnit: "mcg" | "mg";
}

/**
 * @param protocols the page's fully loaded active protocols (steps, schedule and
 *   delivered logs), looked up by id. An oral protocol missing from this list
 *   pre-fills blank rather than fall back to a raw target.
 */
export function buildOralLogOptions(
  oralPeptides: OralPeptideForOptions[],
  protocols: ProtocolForOptions[],
  now: Date = new Date(),
): OralLogOption[] {
  const byId = new Map(protocols.map((p) => [p.id, p]));
  return oralPeptides.map((p) => {
    const link = p.protocols.length === 1 ? p.protocols[0] : null;
    let unit: "mcg" | "mg" = link?.doseInputUnit === "mg" ? "mg" : "mcg";
    let value = "";
    const full = link ? byId.get(link.id) : undefined;
    if (full) {
      const cur = resolveCurrentDose(full, full.deliveredLogs, now);
      // Oral doses are mass-only. A volume/units result cannot be shown in the
      // oral form, so it stays blank rather than be relabelled.
      if (cur.doseUnit === "mcg" || cur.doseUnit === "mg") {
        value = cur.doseValue;
        if (value !== "") unit = cur.doseUnit;
      }
    }
    return {
      peptideId: p.id,
      peptideName: p.name,
      protocolId: link?.id,
      initialDoseValue: value,
      initialDoseUnit: unit,
    };
  });
}
