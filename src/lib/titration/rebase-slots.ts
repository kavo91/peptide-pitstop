import type { DatedSlot } from "../schedule/entries";
import type { WeekdayCode } from "../schedule/schedule";
import { rebaseWeek } from "../schedule/rebase";
import { WEEKDAYS, addDays, startOfDay } from "../schedule/schedule";
import { dayAnchor } from "../tz-day";

export interface ReconstructArgs {
  weekSlots: DatedSlot[];           // this week's standing-grid slots
  weekStart: Date;                  // Sunday/Monday week origin (match rebaseWeek)
  plannedDays: WeekdayCode[];
  rebaseMode: "fixed_anchor" | "rolling";
  freq: "DAILY" | "WEEKLY";
  /**
   * `localDay` is the tracking day FROZEN on the device that logged the dose.
   * It must drive the on-grid test: a traveller's dose can sit on a different
   * runtime-TZ (Brisbane) calendar day than the day it belongs to, and judging
   * "off-grid" by the raw instant makes an on-grid dose trigger a rebase that
   * DELETES the very slot it should have filled. Falls back to the instant for
   * legacy rows stamped before v1.4.0.
   */
  delivered: { id: string; takenAt: Date; localDay?: string | null }[];
  /** Inclusive protocol end date. Rebased display slots must not cross it. */
  endDate?: Date | null;
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
  const doseDay = (dz: { takenAt: Date; localDay?: string | null }) =>
    dz.localDay ? startOfDay(dayAnchor(dz.localDay)) : startOfDay(dz.takenAt);

  // A grid day that ALREADY has its own delivered dose is satisfied and cannot be
  // re-anchored: taking it as the anchor drops it (and every later grid day), so the
  // dose sitting on it loses its slot. Real case — GHK-Cu MO/TU/TH/FR/SU dosed on all
  // five grid days plus an extra Wednesday: the Wednesday anchored on Tuesday, and the
  // Tuesday and Thursday doses vanished behind a phantom Saturday.
  const satisfied = new Set(delivered.map((dz) => doseDay(dz).getTime()));
  const anchorable = grid.filter((g) => !satisfied.has(g.getTime()));

  for (const dose of delivered) {
    const actual = doseDay(dose);
    // When every grid day is already dosed there is nothing to re-anchor onto: keep
    // the plain grid and let the genuinely extra dose render as off-schedule.
    if (anchorable.length === 0) break;
    if (grid.some((g) => g.getTime() === actual.getTime())) continue; // on grid — nothing to do

    // NOTE: the anchor is deliberately NOT restricted to grid days on/before the
    // dose. Anchoring a LATER grid day onto an earlier dose is the legitimate
    // "started the week early" rebase (M/W/F dosed from Sunday → Sun/Tue/Thu) and
    // is covered by rebase-slots.test.ts. The backwards-slide damage came from the
    // drop set below, not from the direction of the anchor.
    const nearest = anchorable.reduce((best, dte) =>
      Math.abs(dte.getTime() - actual.getTime()) < Math.abs(best.getTime() - actual.getTime()) ? dte : best, anchorable[0]);

    // Slide the grid days AFTER the satisfied slot. weekStart as `today` so NO
    // in-week day is filtered out (this is a full-week reconstruction, not the
    // live "what's still upcoming" write path).
    const shifted = rebaseWeek({
      rebaseMode: "fixed_anchor", freq: "WEEKLY", weekStart: args.weekStart,
      plannedDays: args.plannedDays, actual: { plannedDate: nearest, actualDate: actual },
      today: args.weekStart,
      endDate: args.endDate,
    });

    // Drop the satisfied grid day AND every grid day after it; re-add the actual
    // anchor day plus the shifted later days, all flagged rebased. Grid days
    // strictly before the satisfied (nearest) slot keep their own (non-rebased) slots.
    // A grid day that already has its OWN delivered dose is never dropped. The
    // anchor guard above only stopped such a day being CHOSEN as the anchor; it
    // could still be swept up here by `g >= nearest`, orphaning its dose. The
    // orphaned dose then rendered nowhere on the schedule while still appearing
    // in the logged list, so its card read "Due" permanently.
    const droppedKeys = new Set(
      grid.filter((g) => g >= nearest && !satisfied.has(g.getTime())).map((g) => g.getTime()),
    );
    const kept = args.weekSlots.filter((s) => !droppedKeys.has(startOfDay(s.date).getTime()));
    const keptDays = new Set(kept.map((s) => startOfDay(s.date).getTime()));

    const rebasedDays = new Set<number>([actual.getTime()]);
    for (const s of shifted) rebasedDays.add(startOfDay(s).getTime());
    // Never emit a second slot on a day that kept its own.
    for (const k of keptDays) rebasedDays.delete(k);

    const keptTime = args.weekSlots[0]?.time ?? null;
    return [
      ...kept,
      ...[...rebasedDays].map((ms) => ({ date: new Date(ms), time: keptTime, rebased: true })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());
  }
  return args.weekSlots;
}
