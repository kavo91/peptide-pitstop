import type { DatedSlot } from "../schedule/entries";
import type { WeekdayCode } from "../schedule/schedule";
import { rebaseWeek } from "../schedule/rebase";
import { WEEKDAYS, addDays, startOfDay } from "../schedule/schedule";

export interface ReconstructArgs {
  weekSlots: DatedSlot[];           // this week's standing-grid slots
  weekStart: Date;                  // Sunday/Monday week origin (match rebaseWeek)
  plannedDays: WeekdayCode[];
  rebaseMode: "fixed_anchor" | "rolling";
  freq: "DAILY" | "WEEKLY";
  delivered: { id: string; takenAt: Date }[];
}

/**
 * Reconstruct a week's slots under a fixed_anchor within-week rebase, for
 * DISPLAY (calendar / adherence resolver). When the first off-grid delivered
 * dose of the week triggers a rebase:
 *   - the satisfied (nearest-grid) slot MOVES to the ACTUAL dose day, so the
 *     untimed same-calendar-day matcher links the trigger dose (→ taken)
 *     instead of leaving the grid day "missed" and the dose "off-schedule";
 *   - the grid days AFTER the satisfied slot slide by the same delta;
 *   - every produced slot is tagged `rebased: true` for the "shifted" colour.
 *
 * Unlike the write path (rebaseWeek filters to still-upcoming days via `today`),
 * this reconstructs the WHOLE week — a past rebased week must render its full
 * shifted shape, not collapse once its days are behind us. rolling / non-weekly /
 * on-grid / empty-grid → input unchanged.
 *
 * Assumes ONE slot per grid day (untimed, or a single time). A multi-time-per-day
 * fixed_anchor week would collapse to one slot per rebased day — no such protocol
 * exists today; revisit if a multi-dose-per-day titration ever uses fixed_anchor.
 */
export function reconstructRebasedSlots(args: ReconstructArgs): DatedSlot[] {
  if (args.freq !== "WEEKLY" || args.rebaseMode !== "fixed_anchor") return args.weekSlots;
  const grid = args.plannedDays.map((c) => addDays(startOfDay(args.weekStart), WEEKDAYS.indexOf(c)));
  if (grid.length === 0) return args.weekSlots;

  // Rebase from the chronologically EARLIEST off-grid dose (the anchor). Sort a
  // copy: the input order is NOT guaranteed (DB rows are unordered; a backfilled
  // or time-edited dose breaks insertion order), and anchoring off the wrong dose
  // re-creates the garbled week this function exists to prevent.
  const delivered = [...args.delivered].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  for (const dose of delivered) {
    const actual = startOfDay(dose.takenAt);
    const nearest = grid.reduce((best, dte) =>
      Math.abs(dte.getTime() - actual.getTime()) < Math.abs(best.getTime() - actual.getTime()) ? dte : best, grid[0]);
    if (nearest.getTime() === actual.getTime()) continue; // on grid — nothing to do

    // Slide the grid days AFTER the satisfied slot. weekStart as `today` so NO
    // in-week day is filtered out (this is a full-week reconstruction, not the
    // live "what's still upcoming" write path).
    const shifted = rebaseWeek({
      rebaseMode: "fixed_anchor", freq: "WEEKLY", weekStart: args.weekStart,
      plannedDays: args.plannedDays, actual: { plannedDate: nearest, actualDate: actual },
      today: args.weekStart,
    });

    // Drop the satisfied grid day AND every grid day after it; re-add the actual
    // anchor day plus the shifted later days, all flagged rebased. Grid days
    // strictly before the satisfied (nearest) slot keep their own (non-rebased) slots.
    const droppedKeys = new Set(grid.filter((g) => g >= nearest).map((g) => g.getTime()));
    const rebasedDays = new Set<number>([actual.getTime()]);
    for (const s of shifted) rebasedDays.add(startOfDay(s).getTime());

    const keptTime = args.weekSlots[0]?.time ?? null;
    return [
      ...args.weekSlots.filter((s) => !droppedKeys.has(startOfDay(s.date).getTime())),
      ...[...rebasedDays].map((ms) => ({ date: new Date(ms), time: keptTime, rebased: true })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());
  }
  return args.weekSlots;
}
