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
import { slotInstantsOn } from "../schedule/slot-instants";
import { dayAnchor } from "../tz-day";

/** A candidate PlannedDose row, as the matcher consumes it. */
export interface PlannableSlot {
  id: string;
  scheduledAt: Date;
  status: string;       // "planned" or unlinked "missed" rows are eligible
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
 * Day reference for planned-dose lookup. A stamped tracking day overrides the
 * instant's runtime calendar day, so a phone-local 01:00 dose can consume the
 * preceding day's still-unfulfilled plan while travelling.
 */
export function plannedMatchDay(takenAt: Date, localDay: string | null): Date {
  return localDay ? dayAnchor(localDay) : takenAt;
}

/**
 * Pick the planned dose a log taken at `takenAt` should link to: the earliest
 * still-unfulfilled, unlinked slot on the same local day. A row the Brisbane
 * cron already marked missed remains reclaimable during a traveller's 02:00
 * grace window. Mirrors the action's `planned|missed` query.
 * `orderBy: { scheduledAt: "asc" }`. Returns null when nothing matches.
 */
export function matchPlannedDose(takenAt: Date, slots: PlannableSlot[]): PlannedMatch | null {
  const { dayStart, dayEnd } = plannedDayWindow(takenAt);
  const eligible = slots
    .filter(
      (s) =>
        (s.status === "planned" || s.status === "missed") &&
        !s.hasDoseLog &&
        s.scheduledAt.getTime() >= dayStart.getTime() &&
        s.scheduledAt.getTime() < dayEnd.getTime(),
    )
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const planned = eligible[0];
  if (!planned) return null;
  return { plannedDoseId: planned.id, scheduledAt: planned.scheduledAt };
}

/** Status to restore when a linked log is deleted. */
export function unlinkedPlannedStatus(scheduledAt: Date, now: Date): "planned" | "missed" {
  return scheduledAt < plannedDayWindow(now).dayStart ? "missed" : "planned";
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

/**
 * The intended slot INSTANT for a dose taken on `day` — the clock time the
 * dose was actually aimed at.
 *
 * `PlannedDose.scheduledAt` cannot answer this. It is deliberately a LOCAL
 * MIDNIGHT day anchor: `materialize.ts` collapses a day's slots to one row per
 * protocol per day, and both `today-overrides.ts` and `today.ts` depend on that
 * invariant. Measuring lateness against it reports a 21:00 dose taken 52 min
 * late as ~22 h late, which is what reached CSV export and the PDF report.
 *
 * So re-derive the time from the schedule rule and pick the slot nearest
 * `takenAt` (ties resolve to the earlier slot, matching `pickNearestPlanned`).
 * Returns null when the protocol has no schedule or the day has no TIMED slot;
 * callers then keep the prior day-anchor behaviour.
 */
export function scheduledSlotInstant(args: {
  scheduleRule: string | null;
  day: Date;
  takenAt: Date;
  startDate?: Date | null;
  endDate?: Date | null;
}): Date | null {
  const instants = slotInstantsOn(args.scheduleRule, args.day, args.startDate, args.endDate);
  if (instants.length === 0) return null;

  const t = args.takenAt.getTime();
  let best: Date | null = null;
  let bestDist = Infinity;
  for (const inst of instants) {
    const dist = Math.abs(inst.getTime() - t);
    if (best === null || dist < bestDist || (dist === bestDist && inst.getTime() < best.getTime())) {
      best = inst;
      bestDist = dist;
    }
  }
  return best;
}

/** Signed minutes between an actual `takenAt` and its scheduled time (null when unscheduled). */
export function doseDeltaMinutes(takenAt: Date, scheduledAt: Date | null): number | null {
  return scheduledAt ? Math.round((takenAt.getTime() - scheduledAt.getTime()) / 60000) : null;
}
