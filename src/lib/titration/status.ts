import type { ResolvedStatus } from "./types";

export interface SlotStatusArgs {
  slotStart: Date;             // slot date+time (00:00 if untimed)
  now: Date;
  matchedLog: { id: string; takenAt: Date } | null;
  nextSlotStart: Date | null;  // next scheduled slot's start, or null if none
  /**
   * NOT CONSULTED — deliberately. A same-day dose counts as taken however far
   * off-time it was (resolve.ts PASS 1); gating on this window falsely marked
   * real doses "missed". Kept on the args so the protocol setting stays
   * threaded and a future "logged late" FLAG can use it WITHOUT changing what
   * counts as taken. Do not start gating status on it — that would retroactively
   * rewrite historical adherence.
   */
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
