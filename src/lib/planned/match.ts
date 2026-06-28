/**
 * Pure helpers for linking a freshly-logged dose to its PlannedDose row.
 *
 * `logDose` populates `DoseLog.plannedDoseId` / `scheduledAt` / `deltaMinutes`
 * so the planned-dose cron stops falsely marking a logged dose as "missed"
 * (the link was historically never set — a real bug). The DB query lives in
 * the server action; these helpers hold the day-window + delta arithmetic so
 * the matching contract is unit-testable without a database.
 */
import { startOfDay, addDays } from "../schedule/schedule";

/** A candidate PlannedDose row, as the matcher consumes it. */
export interface PlannableSlot {
  id: string;
  scheduledAt: Date;
  status: string;       // only "planned" rows are eligible
  hasDoseLog: boolean;  // already-linked rows are not eligible
}

export interface PlannedMatch {
  plannedDoseId: string;
  scheduledAt: Date;
}

/**
 * The [dayStart, dayEnd) window for `takenAt` — the same bounds the server
 * action uses in its `plannedDose.findFirst` query.
 */
export function plannedDayWindow(takenAt: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = startOfDay(takenAt);
  return { dayStart, dayEnd: addDays(dayStart, 1) };
}

/**
 * Pick the planned dose a log taken at `takenAt` should link to: the earliest
 * still-planned, unlinked slot on the same local day. Mirrors the action's
 * `where: { status: "planned", scheduledAt: { gte, lt }, doseLog: null }`,
 * `orderBy: { scheduledAt: "asc" }`. Returns null when nothing matches.
 */
export function matchPlannedDose(takenAt: Date, slots: PlannableSlot[]): PlannedMatch | null {
  const { dayStart, dayEnd } = plannedDayWindow(takenAt);
  const eligible = slots
    .filter(
      (s) =>
        s.status === "planned" &&
        !s.hasDoseLog &&
        s.scheduledAt.getTime() >= dayStart.getTime() &&
        s.scheduledAt.getTime() < dayEnd.getTime(),
    )
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const planned = eligible[0];
  if (!planned) return null;
  return { plannedDoseId: planned.id, scheduledAt: planned.scheduledAt };
}

/** Minimal shape the nearest-slot picker needs from an already-filtered candidate row. */
export interface NearestSlot {
  id: string;
  scheduledAt: Date;
}

/**
 * From a set of candidate slots the caller has already filtered (unlinked +
 * planned + same local day), pick the one whose `scheduledAt` is closest in
 * absolute time to `takenAt`. Ties resolve to the earliest slot, so the result
 * is deterministic regardless of input order. Returns undefined when empty.
 *
 * This is the per-slot refinement of `matchPlannedDose`'s earliest-in-day rule:
 * on a multi-slot day (e.g. AM + PM) an evening log links to the PM slot, not
 * the AM one — so adherence + delta are computed against the intended slot.
 */
export function pickNearestPlanned<T extends NearestSlot>(rows: T[], takenAt: Date): T | undefined {
  const t = takenAt.getTime();
  let best: T | undefined;
  let bestDist = Infinity;
  for (const row of rows) {
    const dist = Math.abs(row.scheduledAt.getTime() - t);
    if (
      best === undefined ||
      dist < bestDist ||
      (dist === bestDist && row.scheduledAt.getTime() < best.scheduledAt.getTime())
    ) {
      best = row;
      bestDist = dist;
    }
  }
  return best;
}

/** Signed minutes between an actual `takenAt` and its scheduled time (null when unscheduled). */
export function doseDeltaMinutes(takenAt: Date, scheduledAt: Date | null): number | null {
  return scheduledAt ? Math.round((takenAt.getTime() - scheduledAt.getTime()) / 60000) : null;
}
