import type { DoseUnit } from "../dosing/types";
import type { TitrationStep } from "../schedule/schedule";

export type ResolvedStatus = "taken" | "missed" | "pending" | "projected" | "skipped";

export interface DeliveredDose {
  id: string;
  takenAt: Date;
}

export interface SkippedSlot {
  date: Date;
  time: string | null;
}

export interface ResolveInput {
  doseBasis: "per_injection" | "per_week";
  steps: TitrationStep[];          // [] → non-titration: use fallbackDose
  fallbackDose: string | null;     // Protocol.targetDose
  fallbackUnit: DoseUnit;
  scheduleRule: string | null;
  rebaseMode: "fixed_anchor" | "rolling";
  startDate: Date | null;
  endDate: Date | null;
  injectionsPerWeek: number | null; // dosesPerWeek(scheduleRule)
  delivered: DeliveredDose[];        // this protocol's DoseLogs, ANY order
  skipped: SkippedSlot[];            // PlannedDose rows with status="skipped"
  range: { start: Date; end: Date };
  now: Date;
  adherenceWindowMin: number;
}

export interface ResolvedSlot {
  date: Date;
  time: string | null;
  phaseIndex: number | null;       // null when non-titration / unresolved
  perInjectionValue: string;
  perInjectionUnit: DoseUnit;
  status: ResolvedStatus;
  isProjected: boolean;
  matchedLogId: string | null;     // the DoseLog matched to this slot, or null
  /** True when this slot came from a fixed_anchor within-week rebase (shifted). */
  rebased: boolean;
}

export interface PhaseProgress {
  phaseIndex: number;
  phaseCount: number;
  deliveredInPhase: number;
  targetInPhase: number | null;    // null on indefinite final phase
}

export interface ResolveResult {
  slots: ResolvedSlot[];
  stepUpDates: Date[];
  phaseProgress: PhaseProgress | null; // null when non-titration
}
