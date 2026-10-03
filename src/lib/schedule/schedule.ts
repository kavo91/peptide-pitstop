/**
 * Schedule engine — pure date logic, no I/O. Decides which doses are due on a
 * given day and which titration step is active. Deliberately small: supports the
 * rules the MVP needs (daily, weekly-by-day). Extend as protocols demand.
 */

export type Freq = "DAILY" | "WEEKLY";

export interface ParsedRule {
  freq: Freq;
  /** Weekday codes for WEEKLY rules, e.g. ["MO","WE","FR"]. */
  byDay?: WeekdayCode[];
}

export type WeekdayCode = "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";
export const WEEKDAYS: WeekdayCode[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Build a minimal RRULE-ish string from a frequency + optional weekdays. */
export function buildRule(freq: Freq, byDay?: WeekdayCode[]): string {
  if (freq === "DAILY") return "FREQ=DAILY";
  if (byDay && byDay.length > 0) return `FREQ=WEEKLY;BYDAY=${byDay.join(",")}`;
  return "FREQ=WEEKLY";
}

export const DAY_LABELS: Record<WeekdayCode, string> = {
  SU: "Sun", MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat",
};

/** Human-readable summary of a schedule rule for display. */
export function describeRule(rule: string | null | undefined): string {
  if (!rule) return "No schedule";
  const p = parseRule(rule);
  if (p.freq === "DAILY") return "Daily";
  if (p.freq === "WEEKLY") {
    if (!p.byDay || p.byDay.length === 0) return "Weekly";
    if (p.byDay.length === 7) return "Daily";
    return p.byDay.map((d) => DAY_LABELS[d]).join(", ");
  }
  return rule;
}

/** Parse a minimal RRULE-ish string: "FREQ=WEEKLY;BYDAY=MO,WE,FR" or "FREQ=DAILY". */
export function parseRule(rule: string): ParsedRule {
  const parts = Object.fromEntries(
    rule.split(";").map((kv) => {
      const [k, v] = kv.split("=");
      return [k.trim().toUpperCase(), (v ?? "").trim().toUpperCase()];
    }),
  );
  const freq = parts.FREQ === "WEEKLY" ? "WEEKLY" : "DAILY";
  const byDay = parts.BYDAY
    ? (parts.BYDAY.split(",").map((d) => d.trim()) as WeekdayCode[])
    : undefined;
  return { freq, byDay };
}

/** Local-date weekday code for a Date. */
export function weekdayCode(date: Date): WeekdayCode {
  return WEEKDAYS[date.getDay()];
}

/** Strip time → midnight local, for whole-day comparisons. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * A date-only protocol field (`startDate`, `endDate`, `cycleAnchor`) as a
 * server-local day. Those columns hold 00:00 UTC of the picked calendar day
 * (convention 1, see lib/bud.ts). `startOfDay` reads that instant in the
 * server's zone, which WEST of UTC is the evening before — the end day lost its
 * slots and a slot appeared the day before the start. This reads the UTC
 * calendar day instead.
 *
 * Representation-safe: anything that is not exactly 00:00:00.000Z (a computed
 * local-midnight day handed through the same parameter) goes through
 * `startOfDay` unchanged. So the result equals `startOfDay` for every input in
 * every zone at or east of UTC (Brisbane included), it is idempotent, and it
 * differs only for a 00:00Z value west of UTC.
 */
export function dateOnlyDay(date: Date): Date {
  if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  return startOfDay(date);
}

/** `dateOnlyDay` as a local "YYYY-MM-DD" key. */
export function dateOnlyKey(date: Date): string {
  const d = dateOnlyDay(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The stored form of a server-local day: 00:00 UTC of its calendar date —
 * what the date inputs write.
 */
export function dateOnlyValue(day: Date): Date {
  return new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()));
}

/**
 * Query bound for "a date-only protocol field falls on or after `day`"
 * (`{ gte: dateOnlyFloor(day) }`). Before v1.25.9 the cycle actions
 * (startNextCycle, endCycle) stored a server-local midnight, so the bound is the
 * earlier of the two forms of `day`: both forms of `day` pass, both forms of the
 * day before fail. At or east of UTC the earlier one is the local midnight, i.e.
 * exactly the old `startOfDay(day)` bound.
 */
export function dateOnlyFloor(day: Date): Date {
  const local = startOfDay(day);
  const value = dateOnlyValue(local);
  return value < local ? value : local;
}

/**
 * Exclusive query bound for "a date-only protocol field falls on or before
 * `day`" (`{ lt: dateOnlyCeil(day) }`): the earlier form of the NEXT day, so
 * both forms of `day` pass and both forms of the day after fail.
 */
export function dateOnlyCeil(day: Date): Date {
  return dateOnlyFloor(addDays(startOfDay(day), 1));
}

export function daysBetween(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** Add whole calendar days (DST-safe — not ms arithmetic). */
export function addDays(date: Date, n: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + n);
  return result;
}

/** Grid occurrence dates (local midnight) for a rule within [rangeStart, rangeEnd]. */
export function occurrencesInRange(args: {
  rule: string;
  rangeStart: Date;
  rangeEnd: Date;
  startDate?: Date | null;
  endDate?: Date | null;
}): Date[] {
  const out: Date[] = [];
  let day = startOfDay(args.rangeStart);
  const end = startOfDay(args.rangeEnd);
  while (day <= end) {
    if (isDueOn({ rule: args.rule, date: day, startDate: args.startDate, endDate: args.endDate })) {
      out.push(day); // local-midnight, consistent with startOfDay and the local KEY() consumer
    }
    // Re-snap to midnight: where DST starts AT midnight (America/Santiago) that
    // day's "midnight" is 01:00, and carrying 01:00 forward would make the last
    // day fail `<= end`.
    day = startOfDay(addDays(day, 1));
  }
  return out;
}

/**
 * Is a dose due on `date` for a protocol with this rule and optional window?
 * Honours start/end dates when supplied.
 */
export function isDueOn(args: {
  rule: string;
  date: Date;
  startDate?: Date | null;
  endDate?: Date | null;
}): boolean {
  const { rule, date, startDate, endDate } = args;
  const day = startOfDay(date);
  if (startDate && day < dateOnlyDay(startDate)) return false;
  if (endDate && day > dateOnlyDay(endDate)) return false;

  const parsed = parseRule(rule);
  if (parsed.freq === "DAILY") return true;
  if (parsed.freq === "WEEKLY") {
    if (parsed.byDay && parsed.byDay.length > 0) return parsed.byDay.includes(weekdayCode(day));
    // No explicit days: a WEEKLY rule means once a week, anchored to the start
    // weekday (NOT every day — that would diverge from the depletion forecast).
    if (startDate) return weekdayCode(day) === weekdayCode(dateOnlyDay(startDate));
    return false; // weekly with no anchor day is indeterminate → not due
  }
  return false;
}

export interface TitrationStep {
  stepIndex: number;
  dose: string;
  doseInputUnit: string;
  /** null = indefinite (final maintenance step). */
  durationDays: number | null;
}

/**
 * Which titration step is active on `date`, walking cumulative durations from
 * the protocol start. Returns the final (indefinite) step once all timed steps
 * have elapsed. Returns null if no steps or before start.
 */
export function activeStep(args: {
  steps: TitrationStep[];
  startDate: Date;
  date: Date;
}): TitrationStep | null {
  const { startDate, date } = args;
  const steps = [...args.steps].sort((a, b) => a.stepIndex - b.stepIndex);
  if (steps.length === 0) return null;

  const elapsed = daysBetween(dateOnlyDay(startDate), date);
  if (elapsed < 0) return null;

  let cursor = 0;
  for (const step of steps) {
    if (step.durationDays == null) return step; // indefinite — final
    if (elapsed < cursor + step.durationDays) return step;
    cursor += step.durationDays;
  }
  return steps[steps.length - 1]; // past all timed steps → last
}
