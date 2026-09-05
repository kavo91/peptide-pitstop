/**
 * Dose-shift TRANSITION math — deriving a successor's real first dose (and what
 * that implies for the predecessor's tail) from a user-editable start date.
 *
 * Pure, client-safe module: no `node:crypto`, no `@/lib/db`, nothing from
 * `./shift-suggest.ts` (which imports `node:crypto` and must never be
 * value-imported from a client component). Shared by the engine
 * (`shift-suggest.ts`'s `successorStartDate`), the `applyShiftSuggestion`
 * server action and the `ShiftConfirmSheet` client component, so the three
 * places that decide "when does the new pattern actually start" can never
 * drift apart.
 *
 * The bug this module fixes: the sheet let the user pick ANY date in
 * [today, today+14] and the server used it VERBATIM as the successor's
 * `startDate`, even when that weekday was not in the rotated pattern (so the
 * successor's real first dose lands later than the date shown) — and the sheet
 * kept showing the ORIGINAL `removedDoseDates`/gap measured to the chosen date
 * instead of to the first real dose. `snapStartToPattern` and
 * `transitionPreview` below are the one place that answers "when does the
 * pattern actually start", and every caller re-derives from it.
 */
import { type WeekdayCode, startOfDay, addDays, daysBetween, weekdayCode } from "./schedule";

/** Local "YYYY-MM-DD" → local midnight. Never `new Date(key)` (UTC parsing). */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Inverse of parseDayKey — local "YYYY-MM-DD", the app's day-key shape. The
 * one home for this: `shift-suggest.ts` imports and re-exports it rather
 * than keeping its own copy, and any client file (e.g. ShiftConfirmSheet)
 * imports it from here, never from shift-suggest.ts (which value-imports
 * `node:crypto` and must never load into a client bundle).
 */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The first real dosing day for a rotated pattern, given the earliest day the
 * caller will accept (already clamped to on/after today by the caller — e.g.
 * the sheet's `min={today}` date input, or the server's own bounds check).
 *
 * The result is always: on/after `earliest`, on/after tomorrow when today's
 * dose is already logged (never a same-day second dose), and strictly after
 * the protocol's own start date (a revision can't start on/before its
 * predecessor's own first day). Whichever of those three floors is latest
 * wins, then the search walks forward at most 7 days to the first weekday in
 * `toDays`.
 */
export function snapStartToPattern(args: {
  toDays: WeekdayCode[];
  earliest: Date;
  today: Date;
  todayLogged: boolean;
  protocolStartDate: Date | null;
}): Date {
  const today = startOfDay(args.today);
  const earliest = startOfDay(args.earliest);
  const notBeforeToday = startOfDay(args.todayLogged ? addDays(today, 1) : today);
  const notOnOrBeforeStart = args.protocolStartDate
    ? addDays(startOfDay(args.protocolStartDate), 1)
    : null;

  let day = earliest > notBeforeToday ? earliest : notBeforeToday;
  if (notOnOrBeforeStart && notOnOrBeforeStart > day) day = notOnOrBeforeStart;

  const want = new Set(args.toDays);
  for (let i = 0; i < 7; i++) {
    if (want.has(weekdayCode(day))) return day;
    day = addDays(day, 1);
  }
  return day; // only reachable for an empty pattern, which is never a candidate
}

/**
 * Everything the sheet (and the engine's own suggestion) needs to describe one
 * transition: the real first dose, which of the predecessor's planned doses in
 * the gap are retired rather than moved, and the true post-apply gap.
 *
 * `removedDoseDates` only needs to check "is today logged", not the full
 * logged-day set: every other day in `[today, startDate)` is still in the
 * future relative to `today`, so it cannot already have a logged dose.
 */
export function transitionPreview(args: {
  fromDays: WeekdayCode[];
  toDays: WeekdayCode[];
  today: Date;
  earliest: Date;
  todayLogged: boolean;
  lastDoseDate: string | null;
  usualGapDays: number;
  protocolStartDate: Date | null;
  /**
   * The predecessor's course end (`courseEnd(p)`) — a day after it was
   * never a planned dose, so it can never belong in `removedDoseDates`.
   * Optional/omitted for a course with no end at all.
   */
  courseEnd?: Date | null;
}): { startDate: string; removedDoseDates: string[]; gapDays: number | null; shorterThanUsual: boolean } {
  const today = startOfDay(args.today);
  const start = snapStartToPattern({
    toDays: args.toDays,
    earliest: args.earliest,
    today,
    todayLogged: args.todayLogged,
    protocolStartDate: args.protocolStartDate,
  });

  const fromSet = new Set(args.fromDays);
  const todayKey = dayKey(today);
  const end = args.courseEnd ? startOfDay(args.courseEnd) : null;
  const removedDoseDates: string[] = [];
  for (let day = today; day < start; day = addDays(day, 1)) {
    // Past the course's planned last dosing day there is nothing left to
    // retire — every later day in [today, start) was never a planned dose.
    if (end && day > end) break;
    const key = dayKey(day);
    if (key === todayKey && args.todayLogged) continue;
    if (fromSet.has(weekdayCode(day))) removedDoseDates.push(key);
  }

  const gapDays = args.lastDoseDate === null ? null : daysBetween(parseDayKey(args.lastDoseDate), start);
  const shorterThanUsual = gapDays !== null && gapDays < args.usualGapDays;

  return { startDate: dayKey(start), removedDoseDates, gapDays, shorterThanUsual };
}
