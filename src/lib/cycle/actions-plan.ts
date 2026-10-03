/**
 * What the two cycle-banner actions (actions/cycle.ts) write — PURE, so the
 * date arithmetic is testable without a server action or a database.
 *
 * Protocol dates are date-only: 00:00 UTC of the day, the form the date inputs
 * write. Before v1.25.9 these actions wrote a server-local midnight instead —
 * in Brisbane 14:00Z of the day before, so the forecast read the end a day
 * early and the audit text named the previous day. Readers still accept both
 * forms (`dateOnlyDay`, `dateOnlyKey`, `dateOnlyFloor`, `dateOnlyCeil`).
 */
import { startOfDay, dateOnlyDay, dateOnlyKey, dateOnlyValue } from "../schedule/schedule";
import { cyclePlanEnd } from "./state";

export interface EndCycleInput {
  startDate: Date | null;
  endDate: Date | null;
  cycleAnchor: Date | null;
  cycleOnWeeks: number | null;
}

/**
 * End the cycle: pin `endDate` to the last planned dosing day, unless the user
 * already set an earlier one. Returns the end date to write and the audit text.
 */
export function planEndCycle(protocol: EndCycleInput): { endDate: Date | null; audit: string } {
  const planned = cyclePlanEnd(protocol.cycleAnchor ?? protocol.startDate, protocol.cycleOnWeeks);
  const plannedEnd = planned && dateOnlyValue(planned);
  // Never PUSH an existing end date later — a user who already chose to finish
  // early meant it. Only fill a null, or pull a later end back in. Compared by
  // DAY: a stored end in either form on the planned day is kept as stored.
  const endDate =
    plannedEnd && (protocol.endDate === null || dateOnlyDay(protocol.endDate) > dateOnlyDay(plannedEnd))
      ? plannedEnd
      : protocol.endDate;
  return {
    endDate,
    audit: `cycle ended${endDate ? ` (endDate ${dateOnlyKey(endDate)})` : ""}`,
  };
}

/**
 * Start the next cycle on the server's day of `now`: the anchor moves to that
 * day, the end date to the new cycle's planned stop, and a protocol with no
 * start date gets that day as its start.
 */
export function planNextCycle(
  protocol: { startDate: Date | null; cycleOnWeeks: number },
  now: Date,
): {
  data: { cycleAnchor: Date; status: "active"; endDate: Date | null; startDate?: Date };
  audit: string;
} {
  const today = dateOnlyValue(startOfDay(now));
  const planned = cyclePlanEnd(today, protocol.cycleOnWeeks);
  const newEnd = planned && dateOnlyValue(planned);
  return {
    data: {
      cycleAnchor: today,
      status: "active",
      endDate: newEnd,
      // A protocol that never had a startDate gets one now, so day-N counters
      // and the titration resolver have an anchor for this cycle.
      ...(protocol.startDate ? {} : { startDate: today }),
    },
    audit: `next cycle started ${dateOnlyKey(today)}`,
  };
}
