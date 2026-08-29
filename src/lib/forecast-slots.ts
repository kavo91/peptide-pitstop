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
  /**
   * First slot day past the committed cycle's end, when the walk projects a
   * repeating course's next on-cycles (R30). Null when nothing is projected.
   * Demand from this day on is PROVISIONAL — the restart is a manual action —
   * but the reorder decision has to see it before the restart, not after.
   */
  projectionStartsOn: Date | null;
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

  const repeats = (protocol.cycleOffWeeks ?? 0) > 0;
  const anchor = protocol.cycleAnchor ?? protocol.startDate;
  const protoEnd = conv1ToLocalDay(protocol.endDate);
  const planEnd = cyclePlanEnd(anchor, protocol.cycleOnWeeks);
  const endsOnPlan =
    protoEnd != null && planEnd != null && protoEnd.getTime() === startOfDay(planEnd).getTime();
  // R30: a repeating course whose endDate is the plan's OWN stop is walked past
  // it, into its projected next on-cycles. Without this the forecast went blind
  // at the break: covered-to-cycle-end all through the off-weeks, then straight
  // to reorder_now the day the user restarts — after the shipping window had
  // closed. The projection resolves with the end lifted, then drops every slot
  // that falls in an off-window; an endDate that is NOT the plan's stop means
  // the user chose to finish early, and stays a plain course end.
  const projecting = repeats && endsOnPlan;

  const resolved = resolveTitration(
    buildResolveInput({
      protocol: projecting ? { ...protocol, endDate: null } : protocol,
      deliveredLogs,
      range: { start: rangeStart, end: addDays(today, HORIZON_DAYS) },
      now,
    }),
  );

  // Consume by STATUS, not by date. `date > today` drops today's own unlogged
  // slot (status "pending") and understates every daily protocol by a dose,
  // every day (R24).
  let futureSlots: ForecastSlot[] = resolved.slots
    .filter((s) => s.status === "projected" || s.status === "pending")
    .map((s) => ({ date: s.date, perInjectionValue: s.perInjectionValue, perInjectionUnit: s.perInjectionUnit }));

  let projectionStartsOn: Date | null = null;
  if (projecting) {
    // Committed slots (≤ endDate) pass untouched; past it, only on-window days
    // survive. NOTE the resolver's phase cursor walked the break days too, so a
    // mid-ladder titration can sit up to a step ahead in the projection — the
    // conservative direction (orders earlier, never later); recorded in R30.
    futureSlots = futureSlots.filter((s) => {
      const dayOf = startOfDay(s.date);
      if (protoEnd != null && dayOf <= protoEnd) return true;
      const at = cycleState({
        anchor,
        onWeeks: protocol.cycleOnWeeks,
        offWeeks: protocol.cycleOffWeeks,
        today: dayOf,
      });
      return at?.phase === "on";
    });
    const first = futureSlots.find((s) => protoEnd != null && startOfDay(s.date) > protoEnd);
    projectionStartsOn = first ? startOfDay(first.date) : null;
  }
  const slots = futureSlots.slice(0, HORIZON_SLOTS);

  const cyc = cycleState({
    anchor,
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

  // The basis must describe why the walk ACTUALLY stopped, not merely what the
  // protocol says. A course ending in 2029 is only walked for a year, so
  // claiming coverage to 2029 would assert something never simulated. A
  // projected walk (R30) runs to the horizon, so `cycle_end` is no longer
  // emitted — the type and its copy remain for older readers of the field.
  const horizonEnd = addDays(today, HORIZON_DAYS);
  const truncated =
    slots.length >= HORIZON_SLOTS || (!projecting && protoEnd != null && protoEnd > horizonEnd);
  const stopReason: CoverageBasis =
    truncated ? "horizon"
    : terminalStop || (protoEnd != null && !endsOnPlan) ? "course_end"
    : projecting ? "horizon"
    : protoEnd != null ? "course_end"
    : "horizon";

  return {
    slots: walked,
    stopReason,
    // A projected course has no finite end within the walk — clamping coverage
    // to the committed cycle's end would understate what was actually served.
    courseEndDate: truncated || projecting ? null : (terminalStop ?? protoEnd ?? null),
    scheduleEvaluable: parseSchedule(protocol.scheduleRule).length > 0,
    phaseToday: cyc?.phase === "on" || cyc?.phase === "off" ? cyc.phase : null,
    projectionStartsOn,
  };
}
