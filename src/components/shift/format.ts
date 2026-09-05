/**
 * Pure, presentation-only formatting for the dose-shift suggestions UI. No DOM,
 * no fetch, no server-only imports — safe from both server and client
 * components, and directly unit-testable.
 */
import { DAY_LABELS, type WeekdayCode } from "@/lib/schedule/schedule";
// Types only. shift-suggest.ts value-imports `node:crypto`, so it must never
// load into a client bundle — an `import type` is erased at transform and
// cannot pull it in.
import type { CombinedMove } from "@/lib/schedule/shift-suggest";
import type { ShiftConfirmInput } from "./ShiftConfirmSheet";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-09-05" → "Sat 5 Sep". Parsed as a LOCAL day (`new Date(y, m-1, d)`,
 * never `new Date(key)`), the same local-midnight construction every other
 * day-key parse in this codebase uses, so a UTC offset can never shift the
 * displayed day by one.
 *
 * Hand-rolled on purpose: this string is rendered by a client component, so it
 * is produced once on the server (the container's Node ICU) and again in the
 * browser (its own ICU). `toLocaleDateString` disagrees between the two on
 * details like "Sep" vs "Sept" and comma placement, which is a hydration
 * mismatch. Fixed tables render identically everywhere.
 */
export function formatDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAY_SHORT[date.getDay()]} ${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`;
}

/** ["MO","WE","FR"] → "Mon, Wed, Fri". */
export function dayList(days: WeekdayCode[]): string {
  return days.map((d) => DAY_LABELS[d]).join(", ");
}

/** ["07:00","20:00"] → "07:00, 20:00". */
export function timeList(times: string[]): string {
  return times.join(", ");
}

/**
 * The ONLY sentence this feature ever shows about a gap (copy rule) — purely
 * factual, never a recommendation either way. `gapDays === null` means there is
 * no earlier dose to measure from at all.
 */
export function gapSentence(s: {
  lastDoseDate: string | null;
  gapDays: number | null;
  usualGapDays: number;
  shorterThanUsual: boolean;
}): string {
  if (s.gapDays === null) return "No earlier dose to measure the gap from.";
  // gapDays is only ever non-null alongside a lastDoseDate (see shift-suggest.ts).
  const base = `Gap from your last dose (${formatDayKey(s.lastDoseDate as string)}) to the first new one: ${s.gapDays} ${s.gapDays === 1 ? "day" : "days"}.`;
  return s.shorterThanUsual ? `${base} That is shorter than your usual gap of ${s.usualGapDays} days.` : base;
}

/** Zero-padded two-digit field for a day key. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * "2026-09-14" + 3 → "2026-09-17". Built the same local-midnight way as
 * `formatDayKey`, with the offset handed straight to the Date constructor so
 * the platform normalises month and year roll-over for us (and a DST hour
 * cannot roll the day: the day field is set, never added to a timestamp).
 *
 * Never `toLocaleDateString` / `toISOString`: this walks the week under a
 * client component, and both would reintroduce the ICU/UTC mismatch
 * `formatDayKey`'s comment describes.
 */
export function addDayKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d + n);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** "2026-09-14" → 14. The number under the weekday code in a grid header. */
export function dayOfMonth(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).getDate();
}

/**
 * Which object the per-move "Apply just this" sheet opens for one move of the
 * combined plan. The standalone card for the SAME protocol AND the same
 * rotation is preferred — it is the identical set of facts the standalone-card list
 * already holds — and a card for a DIFFERENT `k` is not a match: it would open
 * a sheet naming days the move's own row never named, and land a week the
 * "Only this" strip above the button never showed. The move itself carries
 * every field the sheet reads, so it is the fallback.
 *
 * Typed on ShiftConfirmInput, not the whole ShiftSuggestion: the panel narrows
 * the cards to exactly those fields before they cross into the client bundle,
 * and a full suggestion still satisfies the parameter.
 */
export function confirmInputForMove(
  move: CombinedMove,
  suggestions: ShiftConfirmInput[],
): ShiftConfirmInput {
  return suggestions.find((s) => s.protocolId === move.protocolId && s.k === move.k) ?? move;
}
