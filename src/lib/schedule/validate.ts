/**
 * Strict stack-schedule validation — pure, dependency-light. Guards against the
 * never-due / malformed rules a direct POST could write (the editor blocks these
 * in the UI, but `updateStackSchedule` must not persist them). Parses the same
 * rule string the protocol UI uses (parseSchedule) so the kinds/field names match
 * reality, then checks each entry plus the start-date requirement that makes
 * interval/cycle rules actually fire.
 */
import { parseSchedule, type DayPattern, type ScheduleEntry } from "./entries";
import { WEEKDAYS, type WeekdayCode } from "./schedule";

export type ValidateResult = { ok: true } | { ok: false; error: string };

const VALID_WEEKDAYS = new Set<string>(WEEKDAYS); // MO TU WE TH FR SA SU

/** True when `v` is a non-empty, parseable date string/Date (the schedule anchor). */
function hasValidStartDate(startDate?: string | Date | null): boolean {
  if (startDate == null) return false;
  if (startDate instanceof Date) return !isNaN(startDate.getTime());
  const s = startDate.trim();
  if (!s) return false;
  return !isNaN(new Date(s).getTime());
}

/** Validate a single day-pattern's own fields (kind + counts/weekdays). */
function validatePattern(p: DayPattern): ValidateResult {
  switch (p.kind) {
    case "daily":
      return { ok: true };
    case "weekly": {
      if (!Array.isArray(p.byDays) || p.byDays.length === 0) {
        return { ok: false, error: "Weekly schedule needs at least one weekday." };
      }
      const bad = p.byDays.find((d: WeekdayCode) => !VALID_WEEKDAYS.has(d));
      if (bad !== undefined) return { ok: false, error: `Invalid weekday code: ${bad}.` };
      return { ok: true };
    }
    case "interval":
      if (typeof p.everyDays !== "number" || !Number.isFinite(p.everyDays) || p.everyDays < 1) {
        return { ok: false, error: "Interval must repeat every 1 day or more." };
      }
      return { ok: true };
    case "cycle":
      if (typeof p.onDays !== "number" || !Number.isFinite(p.onDays) || p.onDays < 1) {
        return { ok: false, error: "Cycle 'on' days must be 1 or more." };
      }
      if (typeof p.offDays !== "number" || !Number.isFinite(p.offDays) || p.offDays < 1) {
        return { ok: false, error: "Cycle 'off' days must be 1 or more." };
      }
      return { ok: true };
    default:
      return { ok: false, error: `Unknown schedule kind: ${(p as { kind?: unknown }).kind}.` };
  }
}

/**
 * Validate a stack schedule rule. `rule` is the stored rule string (JSON entries
 * or legacy RRULE); `startDate` is the protocol's anchor ("yyyy-mm-dd", Date, or
 * null). Returns `{ ok: true }` only when every entry is well-formed AND any
 * interval/cycle entry has a valid startDate (without one it is never due).
 */
export function validateScheduleRule(rule: string, startDate?: string | Date | null): ValidateResult {
  const entries: ScheduleEntry[] = parseSchedule(rule);
  if (entries.length === 0) return { ok: false, error: "Set a valid schedule first." };

  const startOk = hasValidStartDate(startDate);
  for (const e of entries) {
    const p = e.dayPattern;
    const res = validatePattern(p);
    if (!res.ok) return res;
    // interval/cycle rules anchor to a startDate — without one they never fire.
    if ((p.kind === "interval" || p.kind === "cycle") && !startOk) {
      return { ok: false, error: "This schedule needs a start date to know when to begin." };
    }
  }
  return { ok: true };
}
