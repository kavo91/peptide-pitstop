/**
 * Day bounds for the date-only Protocol.startDate column — PURE, so the
 * Prisma `where` fragments the pages build can be tested without a database.
 *
 * A start date is a calendar DAY (00:00 UTC of it; a server-local midnight for
 * rows the cycle actions wrote before v1.25.9). Comparing it as an instant
 * against a local midnight or `now` is off by the UTC offset: in Brisbane a
 * 00:00Z start is 10:00 local, so a protocol starting today was "not started"
 * until 10:00 and a range ending today left it out. These compare by day, and
 * accept both stored forms.
 */
import { startOfDay, dateOnlyDay, dateOnlyCeil } from "./schedule/schedule";

/** Prisma bound: `startDate` falls on or before the server-local `day`. */
export function startsOnOrBefore(day: Date): { lt: Date } {
  return { lt: dateOnlyCeil(day) };
}

/**
 * Home tiles: the protocol has started by the viewer's day — from the first
 * minute of its start day, not from 00:00 UTC of it. Same bound as
 * startsOnOrBefore; kept as its own name so the home-tile rule has one place
 * (and one test) of its own.
 */
export function homeStartBound(viewDate: Date): { lt: Date } {
  return startsOnOrBefore(viewDate);
}

/** Analytics: a protocol with no start, or one whose start day is today or earlier. */
export function hasStartedBy(startDate: Date | null, now: Date): boolean {
  return startDate == null || dateOnlyDay(startDate) <= startOfDay(now);
}
