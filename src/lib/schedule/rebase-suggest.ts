/**
 * Off-grid rebase SUGGESTION for a weekly fixed-anchor protocol.
 *
 * When a dose lands on a non-grid day, offer to snap the rest of the week onto
 * the actual cadence (see rebaseWeek). This is the read/decide half — the write
 * half is confirmRebase in app/actions/rebase.ts.
 *
 * Lives in a plain (non-"use server") module so it is unit-testable and is NOT
 * exposed as a client-callable server action (it takes a caller userId — the
 * same boundary concern the audit raised for getStacks).
 */
import { prisma } from "@/lib/db";
import { startOfDay, addDays, WEEKDAYS } from "./schedule";
import { parseSchedule, weeklyDays, entryDueOn } from "./entries";
import { rebaseWeek } from "./rebase";

export interface RebaseSuggestion {
  protocolId: string;
  plannedDateISO: string;
  actualDateISO: string;
  /** Weekly shift preview (weekday codes). Empty for interval rolls. */
  suggestedDays: string[];
  /** Absent (legacy) = "weekly". "interval" = catch-up roll prompt. */
  kind?: "weekly" | "interval";
  /** Interval rolls: the cadence, for prompt copy ("every N days"). */
  intervalDays?: number;
  /** Interval rolls: the first rolled dates (actual+N, actual+2N), for preview. */
  nextDatesISO?: string[];
}

/**
 * Returns a rebase suggestion, or undefined when none applies.
 *
 * `matchedPlanned` is true when the dose already linked to a PlannedDose for its
 * day — i.e. it lands on an existing planned slot, whether the raw BYDAY grid OR
 * a slot the user already shifted this week. On-plan doses must NOT re-prompt:
 * otherwise every dose after an accepted weekly shift re-prompts, because the
 * suggestion is measured against the raw grid, not the (already-shifted) plan.
 */
export async function computeRebaseSuggestion(args: {
  protocolId: string | undefined;
  userId: string;
  takenAt: Date;
  matchedPlanned: boolean;
}): Promise<RebaseSuggestion | undefined> {
  const { protocolId, userId, takenAt, matchedPlanned } = args;
  if (!protocolId) return undefined;
  if (matchedPlanned) return undefined;

  const proto = await prisma.protocol.findFirst({ where: { id: protocolId, userId } });
  if (!proto?.scheduleRule) return undefined;
  const schedule = parseSchedule(proto.scheduleRule);
  const mode = proto.rebaseMode ?? "fixed_anchor";

  // Interval catch-up roll: an off-grid dose on a rolling every-N-days
  // protocol offers to re-base the cadence from the actual dose day
  // (confirmRebase appends a rule anchor — see interval-anchor.ts).
  // fixed_anchor interval protocols stay rigid: no shift, no prompt.
  const interval = schedule.find((e) => e.dayPattern.kind === "interval");
  if (interval?.dayPattern.kind === "interval" && mode === "rolling" && proto.startDate) {
    const everyDays = interval.dayPattern.everyDays;
    const actual = startOfDay(takenAt);
    if (everyDays <= 0 || actual < startOfDay(proto.startDate)) return undefined;
    if (entryDueOn(interval, actual, proto.startDate)) return undefined; // on-grid — nothing to roll
    // The most recent grid day this catch-up satisfies (for the prompt copy).
    let planned = actual;
    for (let back = 1; back < everyDays; back++) {
      const candidate = addDays(actual, -back);
      if (entryDueOn(interval, candidate, proto.startDate)) {
        planned = candidate;
        break;
      }
    }
    const nextDates = [addDays(actual, everyDays), addDays(actual, 2 * everyDays)].filter(
      (d) => !proto.endDate || d <= startOfDay(proto.endDate),
    );
    if (nextDates.length === 0) return undefined; // roll would push everything past the end date
    return {
      kind: "interval",
      protocolId: proto.id,
      plannedDateISO: planned.toISOString(),
      actualDateISO: actual.toISOString(),
      suggestedDays: [],
      intervalDays: everyDays,
      nextDatesISO: nextDates.map((d) => d.toISOString()),
    };
  }

  const wdays = weeklyDays(schedule);
  if (wdays.length === 0 || mode !== "fixed_anchor") return undefined;

  const actual = startOfDay(takenAt);
  const ws = startOfDay(addDays(actual, -actual.getDay()));
  const gridDates = wdays.map((c) => addDays(ws, WEEKDAYS.indexOf(c)));
  const nearest = gridDates.reduce(
    (best, dte) => (Math.abs(dte.getTime() - actual.getTime()) < Math.abs(best.getTime() - actual.getTime()) ? dte : best),
    gridDates[0],
  );
  const shifted = rebaseWeek({
    rebaseMode: "fixed_anchor",
    freq: "WEEKLY",
    weekStart: ws,
    plannedDays: wdays,
    actual: { plannedDate: nearest, actualDate: actual },
    today: actual,
  });
  if (nearest.getTime() !== actual.getTime() && shifted.length > 0) {
    return {
      protocolId: proto.id,
      plannedDateISO: nearest.toISOString(),
      actualDateISO: actual.toISOString(),
      suggestedDays: shifted.map((dte) => WEEKDAYS[dte.getDay()]),
    };
  }
  return undefined;
}
