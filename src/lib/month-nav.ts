/** Pure month arithmetic for the /doses month navigator. All dates are local. */

/** "YYYY-MM" for a date. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Anchor date (1st of month) from a `?month=YYYY-MM` param; fall back to ref's month. */
export function parseMonthParam(param: string | undefined, ref: Date): Date {
  const m = (param ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return new Date(ref.getFullYear(), ref.getMonth(), 1);
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) return new Date(ref.getFullYear(), ref.getMonth(), 1);
  return new Date(year, month, 1);
}

/** Shift by whole months (handles year boundaries via Date normalisation). */
export function shiftMonth(anchor: Date, delta: number): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
}
