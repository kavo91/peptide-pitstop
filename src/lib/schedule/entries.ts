/**
 * Custom-schedule engine — pure date logic, no I/O. A schedule is a set of
 * entries; each entry pairs a day-pattern with optional clock times. The
 * schedule is the union of its entries. See
 * docs/superpowers/specs/2026-06-16-custom-schedules-design.md.
 */
import { type WeekdayCode, weekdayCode, startOfDay, daysBetween, addDays, parseRule, DAY_LABELS } from "./schedule";

export type DayPattern =
  | { kind: "daily" }
  | { kind: "weekly"; byDays: WeekdayCode[] }
  | { kind: "interval"; everyDays: number }
  | { kind: "cycle"; onDays: number; offDays: number };

export interface ScheduleEntry {
  dayPattern: DayPattern;
  /** "HH:MM" 24h local times. [] = one untimed dose that day. */
  times: string[];
}

export type Schedule = ScheduleEntry[];

/** Does this single entry's day-pattern fall on `date`? Pure pattern test — no start/end window. */
export function entryDueOn(entry: ScheduleEntry, date: Date, startDate?: Date | null): boolean {
  const day = startOfDay(date);
  const p = entry.dayPattern;
  switch (p.kind) {
    case "daily":
      return true;
    case "weekly":
      return p.byDays.length > 0 && p.byDays.includes(weekdayCode(day));
    case "interval": {
      if (!startDate || p.everyDays <= 0) return false;
      const elapsed = daysBetween(startOfDay(startDate), day);
      return elapsed >= 0 && elapsed % p.everyDays === 0;
    }
    case "cycle": {
      if (!startDate) return false;
      const period = p.onDays + p.offDays;
      if (period <= 0) return false;
      const elapsed = daysBetween(startOfDay(startDate), day);
      if (elapsed < 0) return false;
      return elapsed % period < p.onDays;
    }
  }
}

export interface Slot {
  /** "HH:MM" local, or null for an untimed dose. */
  time: string | null;
}

/** Numeric "HH:MM" comparator so "9:00" sorts before "20:00" (not lexically after). */
const cmpTime = (a: string, b: string) => {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return ah !== bh ? ah - bh : am - bm;
};

/**
 * Distinct due-slots on `date`: union across entries, identical times deduped.
 * Sorted untimed-first then ascending time. Applies the optional start/end
 * window (outside it → no slots), mirroring isDueOn.
 */
export function slotsOn(schedule: Schedule, date: Date, startDate?: Date | null, endDate?: Date | null): Slot[] {
  const day = startOfDay(date);
  if (startDate && day < startOfDay(startDate)) return [];
  if (endDate && day > startOfDay(endDate)) return [];

  let hasUntimed = false;
  const seen = new Set<string>();
  const out: Slot[] = [];
  for (const entry of schedule) {
    if (!entryDueOn(entry, day, startDate)) continue;
    const times = entry.times.length > 0 ? entry.times : [null];
    for (const t of times) {
      if (t === null) {
        if (hasUntimed) continue;
        hasUntimed = true;
      } else {
        if (seen.has(t)) continue;
        seen.add(t);
      }
      out.push({ time: t });
    }
  }
  return out.sort((a, b) => {
    if (a.time === b.time) return 0;
    if (a.time === null) return -1;
    if (b.time === null) return 1;
    return cmpTime(a.time, b.time);
  });
}

export interface DatedSlot {
  date: Date; // local midnight
  time: string | null;
  /**
   * True when this slot was produced by a fixed_anchor within-week rebase
   * (an off-grid trigger dose re-anchored the week). Drives the distinct
   * "shifted" display colour. Absent/false for standing-grid slots.
   */
  rebased?: boolean;
}

/** All due-slots (date × time) within [rangeStart, rangeEnd], inclusive. */
export function slotsInRange(
  schedule: Schedule,
  rangeStart: Date,
  rangeEnd: Date,
  startDate?: Date | null,
  endDate?: Date | null,
): DatedSlot[] {
  const out: DatedSlot[] = [];
  let day = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);
  while (day <= end) {
    for (const slot of slotsOn(schedule, day, startDate, endDate)) {
      out.push({ date: day, time: slot.time });
    }
    day = addDays(day, 1);
  }
  return out;
}

/** Convert a legacy RRULE-ish string into an equivalent Schedule. */
export function legacyToEntry(rule: string): Schedule {
  const p = parseRule(rule);
  if (p.freq === "DAILY") return [{ dayPattern: { kind: "daily" }, times: [] }];
  // WEEKLY
  if (p.byDay && p.byDay.length > 0) {
    return [{ dayPattern: { kind: "weekly", byDays: p.byDay }, times: [] }];
  }
  // Bare weekly = once a week on the start weekday → every-7-days interval.
  return [{ dayPattern: { kind: "interval", everyDays: 7 }, times: [] }];
}

/**
 * Read a Protocol.scheduleRule into a Schedule. JSON (starts with "[") parses
 * directly; anything else is a legacy RRULE string. Malformed input → [].
 */
export function parseSchedule(scheduleRule: string | null | undefined): Schedule {
  const raw = (scheduleRule ?? "").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (e): e is ScheduleEntry => e != null && typeof e === "object" && "dayPattern" in e,
      );
    } catch {
      return [];
    }
  }
  return legacyToEntry(raw);
}

/** Monday-first weekday ordering — display + even-spacing reference. */
export const DAY_ORDER: WeekdayCode[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** Default dose time for the N×/week preset — must sit inside the dose window. */
export const DEFAULT_DOSE_TIME = "08:00";

const DOSE_WINDOW_START_MIN = 6 * 60; // 06:00 inclusive
const DOSE_WINDOW_END_MIN = 20 * 60; // 20:00 inclusive

/**
 * True iff `hhmm` is a well-formed "HH:MM" 24h time within 06:00–20:00 inclusive.
 * Malformed input (empty, non-numeric, out-of-range, wrong shape) → false.
 */
export function isWithinDoseWindow(hhmm: string): boolean {
  const m = (hhmm ?? "").match(/^(\d{2}):(\d{2})$/);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return false;
  const total = h * 60 + min;
  return total >= DOSE_WINDOW_START_MIN && total <= DOSE_WINDOW_END_MIN;
}

/**
 * Maximally-even weekday spreads for an "N× per week" cadence, expressed as
 * DAY_ORDER indices (0..6, Monday-first) for the UNANCHORED (Monday-first) case.
 * The `anchor` rotation is applied on top of these in `evenlySpacedDays`.
 *
 * N=2/N=3 preserve the product-owner contract (Mon/Thu, Mon/Wed/Fri); N=4/5/6
 * are hand-tuned to avoid the index-math clustering (e.g. N=5 had three-in-a-row
 * Mon/Tue/Wed). Gaps are as even as a 7-day week allows:
 *   N=4 → gaps 2,2,2,1   N=5 → gaps 1,2,1,2,1   N=6 → one gap of 2
 */
const EVEN_SPREAD: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 2, 4, 6],
  5: [0, 1, 3, 4, 6],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

/**
 * Evenly-spaced weekdays for an "N× per week" cadence. Looks up a curated,
 * maximally-even base spread (Monday-first), then rotates it onto a wheel offset
 * by `anchor` (so `evenlySpacedDays(2,"TU")` → Tue/Fri). Dedups defensively and
 * sorts by DAY_ORDER (Mon-first). The curated table has no collisions, so the
 * dedup is belt-and-braces only.
 *
 * `perWeek < 1` → []. `perWeek >= 7` → all 7 days. Pure; no I/O.
 */
export function evenlySpacedDays(perWeek: number, anchor: WeekdayCode = "MO"): WeekdayCode[] {
  const n = Math.floor(perWeek);
  if (n < 1) return [];
  if (n >= 7) return [...DAY_ORDER];

  const offset = DAY_ORDER.indexOf(anchor); // wheel rotation so index 0 == anchor
  const base = EVEN_SPREAD[n];

  const used = new Set<number>(); // wheel positions 0..6 (0 == anchor)
  for (const pos of base) used.add((pos + offset) % 7);

  const days = [...used].map((pos) => DAY_ORDER[pos]);
  return days.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
}

function patternLabel(p: DayPattern): string {
  switch (p.kind) {
    case "daily":
      return "Daily";
    case "weekly":
      return [...p.byDays].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)).map((x) => DAY_LABELS[x]).join(", ");
    case "interval":
      return p.everyDays === 1 ? "Every day" : `Every ${p.everyDays} days`;
    case "cycle":
      return `${p.onDays} on / ${p.offDays} off`;
  }
}

/** Human-readable summary for display. */
export function scheduleSummary(schedule: Schedule): string {
  if (schedule.length === 0) return "No schedule";
  return schedule
    .map((e) => {
      const days = patternLabel(e.dayPattern);
      return e.times.length > 0 ? `${days} · ${[...e.times].sort(cmpTime).join(", ")}` : days;
    })
    .join(" + ");
}

/** Union of weekday codes across weekly entries — drives weekly-only rebase. [] if none. */
export function weeklyDays(schedule: Schedule): WeekdayCode[] {
  const set = new Set<WeekdayCode>();
  for (const e of schedule) {
    if (e.dayPattern.kind === "weekly") for (const day of e.dayPattern.byDays) set.add(day);
  }
  return [...set].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
}

export interface CyclePosition {
  phase: "on" | "off";
  /** 1-based day within the current phase. */
  dayOfPhase: number;
  /** Total days in this phase (onDays or offDays). */
  phaseDays: number;
}

/**
 * Given a cycle schedule's startDate, onDays, offDays, and a target date,
 * returns which phase and day-within-phase the target date falls on.
 * Returns null if: before startDate, or invalid parameters (onDays/offDays ≤ 0).
 *
 * Pure function — no I/O, fully testable.
 */
export function cyclePosition(
  startDate: Date,
  onDays: number,
  offDays: number,
  today: Date,
): CyclePosition | null {
  if (onDays <= 0 || offDays <= 0) return null;
  const elapsed = daysBetween(startOfDay(startDate), startOfDay(today));
  if (elapsed < 0) return null;
  const period = onDays + offDays;
  const posInPeriod = elapsed % period;
  if (posInPeriod < onDays) {
    return { phase: "on", dayOfPhase: posInPeriod + 1, phaseDays: onDays };
  }
  return { phase: "off", dayOfPhase: posInPeriod - onDays + 1, phaseDays: offDays };
}
