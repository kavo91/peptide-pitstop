/** Pure week arithmetic for the /doses week navigator. All dates are local, Monday-first. */

/** "YYYY-MM-DD" for a date (local). */
export function weekKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Duplicated from weekStartOf (doses-timeline is "server-only") to keep this module
// isomorphic/unit-testable. Snaps to the local Monday of the week containing `d`.
function mondayOf(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}

/** Anchor (Monday) from a `?weekStart=YYYY-MM-DD` param; fall back to ref's week. */
export function parseWeekParam(param: string | undefined, ref: Date): Date {
  const m = (param ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return mondayOf(ref);
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const dt = new Date(year, month, day);
  // Reject overflow dates (e.g. month 13, day 40) which JS Date silently
  // normalises into a valid neighbouring date — round-trip the components.
  if (
    isNaN(dt.getTime()) ||
    dt.getFullYear() !== year ||
    dt.getMonth() !== month ||
    dt.getDate() !== day
  ) {
    return mondayOf(ref);
  }
  return mondayOf(dt);
}

/** Shift by whole weeks (handles month/year boundaries via Date normalisation). */
export function shiftWeek(anchor: Date, deltaWeeks: number): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7 * deltaWeeks);
}
