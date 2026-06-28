/**
 * The ONE place a Prisma Protocol (+ its DoseLogs) becomes a resolver
 * `ResolveInput`. Every read consumer (today/inventory/reorder) builds its
 * resolver input through here so the basis-aware conversion, frequency
 * derivation, and field mapping stay identical across call sites.
 *
 * Pure: no I/O. The caller supplies the already-loaded DoseLogs (the protocol's
 * FULL delivered history — the resolver's phase cursor needs it).
 */
import { dosesPerWeek } from "../schedule/frequency";
import type { DoseUnit } from "../dosing/types";
import type { ResolveInput } from "./types";

/** A `.toString()`-able value (Prisma Decimal, number, or string). */
type Stringable = { toString(): string };

/** Structural shape of the Protocol fields the resolver needs (Prisma-compatible). */
export interface ProtocolForResolve {
  doseBasis: string | null;
  targetDose: Stringable | null;
  doseInputUnit: string | null;
  scheduleRule: string | null;
  rebaseMode: string | null;
  startDate: Date | null;
  endDate: Date | null;
  adherenceWindowMin: number | null;
  steps: {
    stepIndex: number;
    dose: Stringable;
    doseInputUnit: string;
    durationDays: number | null;
  }[];
}

/** A delivered DoseLog as the resolver consumes it (only id + takenAt matter). */
export interface DeliveredLogInput {
  id: string;
  takenAt: Date | string;
}

export interface BuildResolveInputArgs {
  protocol: ProtocolForResolve;
  deliveredLogs: DeliveredLogInput[];
  range: { start: Date; end: Date };
  now: Date;
}

export function buildResolveInput(args: BuildResolveInputArgs): ResolveInput {
  const { protocol, deliveredLogs, range, now } = args;
  return {
    doseBasis: protocol.doseBasis === "per_week" ? "per_week" : "per_injection",
    steps: protocol.steps
      .map((s) => ({
        stepIndex: s.stepIndex,
        dose: s.dose.toString(),
        doseInputUnit: s.doseInputUnit,
        durationDays: s.durationDays,
      })),
    fallbackDose: protocol.targetDose != null ? protocol.targetDose.toString() : null,
    fallbackUnit: (protocol.doseInputUnit as DoseUnit) ?? "mcg",
    scheduleRule: protocol.scheduleRule,
    rebaseMode: protocol.rebaseMode === "rolling" ? "rolling" : "fixed_anchor",
    startDate: protocol.startDate,
    endDate: protocol.endDate,
    injectionsPerWeek: dosesPerWeek(protocol.scheduleRule),
    delivered: deliveredLogs.map((l) => ({ id: l.id, takenAt: new Date(l.takenAt) })),
    skipped: [], // no skip UI yet (Phase 2)
    range,
    now,
    adherenceWindowMin: protocol.adherenceWindowMin ?? 120,
  };
}
