import type { ResolvedStatus } from "./types";

export interface SlotStatusArgs {
  slotStart: Date;             // slot date+time (00:00 if untimed)
  now: Date;
  matchedLog: { id: string; takenAt: Date } | null;
  nextSlotStart: Date | null;  // next scheduled slot's start, or null if none
  adherenceWindowMin: number;
}

/**
 * Live status (§4a). Never trusts stored PlannedDose.status.
 * Skipped slots are handled by the orchestrator before calling this.
 */
export function slotStatus(a: SlotStatusArgs): ResolvedStatus {
  if (a.matchedLog) return "taken";
  if (a.slotStart.getTime() > a.now.getTime()) return "projected";
  // Past slot, no log: pending until the NEXT slot's start has passed; then missed.
  if (a.nextSlotStart && a.now.getTime() >= a.nextSlotStart.getTime()) return "missed";
  return "pending";
}
