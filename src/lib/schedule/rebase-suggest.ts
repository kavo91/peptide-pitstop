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
import { parseSchedule, weeklyDays } from "./entries";
import { rebaseWeek } from "./rebase";

export interface RebaseSuggestion {
  protocolId: string;
  plannedDateISO: string;
  actualDateISO: string;
  suggestedDays: string[];
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
  const wdays = weeklyDays(parseSchedule(proto.scheduleRule));
  if (wdays.length === 0 || (proto.rebaseMode ?? "fixed_anchor") !== "fixed_anchor") return undefined;

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
