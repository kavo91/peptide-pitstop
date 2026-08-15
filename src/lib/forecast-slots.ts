/**
 * The ONE place a protocol becomes a forecast slot list.
 *
 * Both the reorder tile (`lib/reorder.ts`, whole-peptide coverage) and the
 * inventory page (`lib/inventory.ts`, per-vial coverage) walk the same slots.
 * They ask different questions — "when does this PEPTIDE run out" vs "when does
 * THIS VIAL run out" — but they must never disagree about what is scheduled,
 * when the course stops, or what each dose costs. Keeping the derivation here
 * is what stops the two numbers on the same page from drifting apart, which is
 * exactly what happened when inventory kept a flat `doses / perWeek * 7`
 * estimate beside a protocol-aware one.
 *
 * Pure apart from the resolver call: no I/O, no Prisma. The caller supplies the
 * already-loaded protocol and its FULL delivered history (the resolver's phase
 * cursor needs every log to know which titration step is live).
 */
import { parseSchedule } from "./schedule/entries";
import { startOfDay, addDays } from "./schedule/schedule";
import { cycleState, cyclePlanEnd } from "./cycle/state";
import { resolveTitration } from "./titration/resolve";
import { buildResolveInput, type ProtocolForResolve, type DeliveredLogInput } from "./titration/from-protocol";
import type { CoverageBasis, ForecastSlot } from "./reorder-forecast";

/** How far the walk looks, and the slot ceiling that bounds a dense schedule. */
export const HORIZON_DAYS = 365;
/** Bounded by SLOTS, not days — a twice-daily schedule emits ~730 a year (R17). */
export const HORIZON_SLOTS = 800;

/** The protocol fields the forecast needs on top of the resolver's own. */
export interface ProtocolForForecast extends ProtocolForResolve {
  scheduleRule: string | null;
  cycleAnchor: Date | null;
  cycleOnWeeks: number | null;
  cycleOffWeeks: number | null;
}

export interface ForecastPlan {
  /** Ascending, filtered to status ∈ {projected, pending}, slot-capped. */
  slots: ForecastSlot[];
  /** Why the slot list stops, when it is not depletion. */
  stopReason: CoverageBasis;
  courseEndDate: Date | null;
  /** False when the schedule cannot be evaluated at all (R26). */
  scheduleEvaluable: boolean;
  /** Cycle phase TODAY — metadata for display, never a status (R1). */
  phaseToday: "on" | "off" | null;
}

/** Convention-1 columns store UTC midnight of a calendar day (see lib/bud.ts). */
export function conv1ToLocalDay(d: Date | null | undefined): Date | null {
  if (!d) return null;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function buildForecastPlan(args: {
  protocol: ProtocolForForecast;
  deliveredLogs: DeliveredLogInput[];
  now: Date;
}): ForecastPlan {
  const { protocol, deliveredLogs, now } = args;
  const today = startOfDay(now);
  // Rebasing reconstructs a WHOLE week; starting the range mid-week hands it a
  // truncated slot list and it re-anchors already-past grid days forward (R25).
  const rangeStart = addDays(today, -today.getDay());

  const resolved = resolveTitration(
    buildResolveInput({
      protocol,
      deliveredLogs,
      range: { start: rangeStart, end: addDays(today, HORIZON_DAYS) },
      now,
    }),
  );

  // Consume by STATUS, not by date. `date > today` drops today's own unlogged
  // slot (status "pending") and understates every daily protocol by a dose,
  // every day (R24).
  const slots: ForecastSlot[] = resolved.slots
    .filter((s) => s.status === "projected" || s.status === "pending")
    .map((s) => ({ date: s.date, perInjectionValue: s.perInjectionValue, perInjectionUnit: s.perInjectionUnit }))
    .slice(0, HORIZON_SLOTS);

  const repeats = (protocol.cycleOffWeeks ?? 0) > 0;
  const cyc = cycleState({
    anchor: protocol.cycleAnchor ?? protocol.startDate,
    onWeeks: protocol.cycleOnWeeks,
    offWeeks: protocol.cycleOffWeeks,
    today,
  });
  // A course with onWeeks but NO offWeeks is terminal: it stops and does not
  // restart. Gate on that, not on `phase === "ended"` — "ended" only becomes
  // true AFTER the stop has passed, so gating on it would leave a course still
  // running toward its planned stop to be walked for a full phantom year. A
  // repeating course is NOT gated: its restart depends on the user manually
  // starting the next cycle, and its endDate already carries this cycle's stop.
  //
  // Planned off-weeks are deliberately NOT skipped (R23): nothing else in the
  // app honours them, so `today.ts` still shows those doses as due and the user
  // takes them. Discounting them would overstate coverage.
  const terminalStop = cyc && !repeats ? cyc.onCycleEndsOn : null;
  const walked = terminalStop
    ? slots.filter((s) => startOfDay(s.date) <= startOfDay(terminalStop))
    : slots;

  const protoEnd = conv1ToLocalDay(protocol.endDate);
  const planEnd = cyclePlanEnd(protocol.cycleAnchor ?? protocol.startDate, protocol.cycleOnWeeks);
  const endsOnPlan =
    protoEnd != null && planEnd != null && protoEnd.getTime() === startOfDay(planEnd).getTime();

  // The basis must describe why the walk ACTUALLY stopped, not merely what the
  // protocol says. A course ending in 2029 is only walked for a year, so
  // claiming coverage to 2029 would assert something never simulated.
  const horizonEnd = addDays(today, HORIZON_DAYS);
  const truncated = slots.length >= HORIZON_SLOTS || (protoEnd != null && protoEnd > horizonEnd);
  const stopReason: CoverageBasis =
    truncated ? "horizon"
    : terminalStop || (protoEnd != null && !endsOnPlan) ? "course_end"
    : endsOnPlan && repeats ? "cycle_end"
    : protoEnd != null ? "course_end"
    : "horizon";

  return {
    slots: walked,
    stopReason,
    courseEndDate: truncated ? null : (terminalStop ?? protoEnd ?? null),
    scheduleEvaluable: parseSchedule(protocol.scheduleRule).length > 0,
    phaseToday: cyc?.phase === "on" || cyc?.phase === "off" ? cyc.phase : null,
  };
}
