/**
 * The one column template every row of a card's week grid is drawn on — the
 * protocol rows and the Before/After totals rows are separate elements, so a
 * shared constant is the only thing keeping their columns from drifting apart
 * by a stray class edit.
 *
 * Written as ONE literal string on purpose: Tailwind's content scan reads
 * source text, so an arbitrary value assembled at runtime (`grid-cols-[${n}px…`)
 * would never be emitted into the stylesheet. Verify after a build with
 * `grep "grid-cols-\[64px" .next/static/css/*.css`.
 *
 * 64px label at 375 (name only, truncated) widens to 128px from `sm`, where
 * there is room for the protocol/times second line.
 */
export const SHIFT_GRID_COLS =
  "grid-cols-[64px_repeat(7,minmax(0,1fr))] sm:grid-cols-[128px_repeat(7,minmax(0,1fr))]";

/**
 * DosesWeek's two-letter day codes, re-ordered Monday-first to match DayCounts
 * (index 0 = Mon). DosesWeek indexes its own list by `Date.getDay()` (0 = Sun);
 * here the index IS the strip position, so the list is rotated instead.
 */
export const WEEKDAY_MONDAY_FIRST = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
