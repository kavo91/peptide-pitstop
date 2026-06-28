/**
 * Schedule rebasing: when a dose is logged off its planned day, recompute the
 * remaining upcoming occurrences for the CURRENT week. Pure, no I/O.
 *
 * fixed_anchor + weekly → snap-back: shift the still-upcoming grid days AFTER
 * the satisfied slot by the day-delta of the actual dose, keep only those still
 * in [today, end-of-week]. Next week reverts to the grid (caller writes only
 * this week's overrides). daily / rolling / delta 0 → no occurrences.
 */
import { startOfDay, addDays, WEEKDAYS, type WeekdayCode } from "./schedule";

function dayIndexInWeek(weekStart: Date, date: Date): number {
  return Math.round((startOfDay(date).getTime() - startOfDay(weekStart).getTime()) / 86_400_000);
}

export function rebaseWeek(args: {
  rebaseMode: "fixed_anchor" | "rolling";
  freq: "DAILY" | "WEEKLY";
  weekStart: Date;
  plannedDays: WeekdayCode[];
  actual: { plannedDate: Date; actualDate: Date };
  today: Date;
}): Date[] {
  if (args.freq !== "WEEKLY" || args.rebaseMode !== "fixed_anchor") return [];

  const start = startOfDay(args.weekStart);
  const weekEnd = addDays(start, 6);
  const today = startOfDay(args.today);
  const planned = startOfDay(args.actual.plannedDate);
  const actual = startOfDay(args.actual.actualDate);
  const delta = Math.round((actual.getTime() - planned.getTime()) / 86_400_000);
  if (delta === 0) return [];

  const gridDates = args.plannedDays
    .map((code) => addDays(start, WEEKDAYS.indexOf(code)))
    .filter((date) => date > planned)
    .sort((a, b) => a.getTime() - b.getTime());

  return gridDates
    .map((date) => addDays(date, delta))
    .filter((date) => date >= today && date <= weekEnd && dayIndexInWeek(start, date) >= 0);
}
