/**
 * Cell contents for the /doses week grid — pure, shared by `DosesWeek` and its test.
 */
import type { TimelineEntry } from "./doses-timeline-core";

/**
 * Every timeline entry one peptide row shows in one day cell, in slot-time
 * order (untimed last). A twice-daily peptide gets two glyphs — keeping only
 * the first hid a missed second dose.
 */
export function weekCellEntries(entries: TimelineEntry[], peptideId: string, day: string): TimelineEntry[] {
  return entries
    .filter((x) => x.peptideId === peptideId && x.date === day)
    .sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
}
