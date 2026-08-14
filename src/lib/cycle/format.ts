/**
 * Date formatting for cycle strings.
 *
 * Hand-rolled rather than Intl on purpose. These strings are built on the
 * server, shipped into client components, and asserted in tests — so they must
 * be byte-identical everywhere. `toLocaleDateString("en-GB", {month:"short"})`
 * is not: ICU renders September as "Sept" (4 chars) while every other month is
 * 3, and the abbreviation set has changed between ICU releases — so the exact
 * string depends on the Node build the container happens to ship.
 *
 * A fixed table gives "29 Aug" / "27 Sep" consistently, on every runtime.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "29 Aug" — day of month + fixed 3-letter month, local calendar fields. */
export function fmtCycleDay(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}
