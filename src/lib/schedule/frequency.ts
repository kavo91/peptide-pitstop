/**
 * Schedule frequency — pure, no I/O. Lives in `schedule/` (not `inventory.ts`)
 * so the resolver and its consumers can derive injections/week without pulling
 * in the DB-bound inventory module (avoids an import cycle).
 */
import { parseSchedule, slotsInRange } from "./entries";

// Fixed Monday anchor for a stable 28-day window: Mon 2026-01-05 → Sun 2026-02-01 (inclusive).
const _ANCHOR = new Date(2026, 0, 5);
const _ANCHOR_WINDOW_END = new Date(2026, 0, 5 + 27); // anchor + 27 days = 28-day inclusive range

/** Scheduled doses per week implied by a scheduleRule, or null if schedule is empty. */
export function dosesPerWeek(rule: string | null | undefined): number | null {
  if (!rule) return null;
  const schedule = parseSchedule(rule);
  if (schedule.length === 0) return null;
  // Expand over 4 exact weeks; divide by 4 for the weekly average. Count
  // SLOTS, not unique days — a twice-daily schedule is 14 doses/wk, not 7
  // (legacy single-time schedules yield one slot/day, so back-compat holds).
  const slots = slotsInRange(schedule, _ANCHOR, _ANCHOR_WINDOW_END, _ANCHOR, null);
  return slots.length === 0 ? null : slots.length / 4;
}
