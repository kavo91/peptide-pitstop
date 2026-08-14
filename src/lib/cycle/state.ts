/**
 * Cycle state machine — where a protocol sits in its planned on/off course.
 *
 * The single authority behind the cycle banner, the cycle notifications and the
 * protocol list's cycle chip. Everything downstream reads a `CycleState` rather
 * than re-deriving dates, so "day 41 of 56" can never disagree between surfaces.
 *
 * Vocabulary, and why it is not the schedule's `cycle` DayPattern: that one is
 * an intra-week dosing RHYTHM in DAYS (5-on/2-off within a week, still the same
 * course). This is the COURSE itself, in WEEKS — whether the protocol should be
 * running at all. A protocol can have both: 5-on/2-off days, for 8 weeks.
 *
 * Phases:
 *   on     — dosing; `daysRemaining` counts down to the planned stop.
 *   off    — planned break with a known restart (offWeeks set).
 *   ended  — on-cycle complete and NO restart planned (offWeeks null). Terminal.
 *
 * PURE — calendar arithmetic only, DST-safe via addDays, and date-only
 * throughout (time-of-day on either input is ignored).
 */
import { startOfDay, daysBetween, addDays } from "../schedule/schedule";

export type CyclePhase = "on" | "off" | "ended";

export interface CycleState {
  phase: CyclePhase;
  /** 1-based on-cycle number, counting the current one. */
  cycleNumber: number;
  /** 1-based day within the current phase. For `ended`, days since the stop. */
  dayOfPhase: number;
  /** Length of the current phase in days. 0 for `ended`. */
  phaseDays: number;
  /** Days left in this phase INCLUDING today — 1 means today is the last. 0 for `ended`. */
  daysRemaining: number;
  /** Last DOSING day of the current (or most recent) on-cycle. */
  onCycleEndsOn: Date;
  /** First day of the next phase; null when the course has ended for good. */
  nextPhaseStartsOn: Date | null;
  /** Fraction of the current phase elapsed, 0..1. Always 1 for `ended`. */
  progress: number;
}

export interface CyclePlanInput {
  /** Protocol.cycleAnchor ?? Protocol.startDate. */
  anchor: Date | null;
  /** Protocol.cycleOnWeeks — null/≤0 means no cycle plan at all. */
  onWeeks: number | null;
  /** Protocol.cycleOffWeeks — null/≤0 means stop without a planned restart. */
  offWeeks: number | null;
  /** The day being asked about (the viewer's today). */
  today: Date;
}

/** Is there a usable cycle plan here at all? */
const planned = (weeks: number | null | undefined): weeks is number =>
  typeof weeks === "number" && Number.isFinite(weeks) && weeks > 0;

/**
 * The last DOSING day of an on-cycle starting at `anchor`.
 *
 * Inclusive of the anchor: an 8-week cycle from Sun 5 Jul covers 56 days and
 * ends Sat 29 Aug — NOT 30 Aug, which is the first day off. Getting this
 * off-by-one wrong would tell the user to take one extra dose.
 */
export function cyclePlanEnd(anchor: Date | null, onWeeks: number | null): Date | null {
  if (!anchor || !planned(onWeeks)) return null;
  return addDays(startOfDay(anchor), onWeeks * 7 - 1);
}

/**
 * Where `today` sits in the protocol's cycle plan, or null when there is
 * nothing to report: no cycle length set, no anchor to count from, or the
 * cycle has not started yet (a future anchor).
 */
export function cycleState(input: CyclePlanInput): CycleState | null {
  const { onWeeks, offWeeks } = input;
  if (!planned(onWeeks) || !input.anchor) return null;

  const anchor = startOfDay(input.anchor);
  const today = startOfDay(input.today);
  const elapsed = daysBetween(anchor, today); // 0 on the anchor day
  if (elapsed < 0) return null; // not started yet

  const onDays = onWeeks * 7;

  // No planned restart: one on-cycle, then terminal.
  if (!planned(offWeeks)) {
    const onCycleEndsOn = addDays(anchor, onDays - 1);
    if (elapsed < onDays) {
      const dayOfPhase = elapsed + 1;
      return {
        phase: "on",
        cycleNumber: 1,
        dayOfPhase,
        phaseDays: onDays,
        daysRemaining: onDays - elapsed,
        onCycleEndsOn,
        nextPhaseStartsOn: addDays(anchor, onDays),
        progress: dayOfPhase / onDays,
      };
    }
    return {
      phase: "ended",
      cycleNumber: 1,
      dayOfPhase: elapsed - onDays + 1, // 1 on the first day off
      phaseDays: 0,
      daysRemaining: 0,
      onCycleEndsOn,
      nextPhaseStartsOn: null,
      progress: 1,
    };
  }

  // Repeating course: period = on + off, indefinitely.
  const offDays = offWeeks * 7;
  const period = onDays + offDays;
  const cycleIndex = Math.floor(elapsed / period); // 0-based
  const dayInPeriod = elapsed - cycleIndex * period; // 0-based
  const cycleStart = addDays(anchor, cycleIndex * period);
  const onCycleEndsOn = addDays(cycleStart, onDays - 1);

  if (dayInPeriod < onDays) {
    const dayOfPhase = dayInPeriod + 1;
    return {
      phase: "on",
      cycleNumber: cycleIndex + 1,
      dayOfPhase,
      phaseDays: onDays,
      daysRemaining: onDays - dayInPeriod,
      onCycleEndsOn,
      nextPhaseStartsOn: addDays(cycleStart, onDays),
      progress: dayOfPhase / onDays,
    };
  }

  const dayOfOff = dayInPeriod - onDays; // 0-based within the break
  const dayOfPhase = dayOfOff + 1;
  return {
    phase: "off",
    cycleNumber: cycleIndex + 1,
    dayOfPhase,
    phaseDays: offDays,
    daysRemaining: offDays - dayOfOff,
    onCycleEndsOn,
    nextPhaseStartsOn: addDays(cycleStart, period), // start of the next on-cycle
    progress: dayOfPhase / offDays,
  };
}
