/**
 * Compact cycle chip for list rows — "Day 41/56 · ends 29 Aug".
 *
 * Deliberately separate from ./alerts: an alert is a PROMPT (something to act
 * on, sometimes silent), a chip is always-on STATUS. Both read the same
 * cycleState, so they can never disagree about which day it is.
 *
 * PURE. Dates go through ./format for server/client hydration parity.
 */
import { cycleState, type CyclePlanInput } from "./state";
import { CYCLE_WARN_DAYS } from "./alerts";
import { fmtCycleDay } from "./format";

export interface CycleChip {
  text: string;
  /** `warn` = ending soon or already over; `neutral` = nothing to do yet. */
  tone: "neutral" | "warn";
}

/** The status chip for a protocol's cycle plan, or null when it has none. */
export function cycleChip(input: CyclePlanInput): CycleChip | null {
  const s = cycleState(input);
  if (!s) return null;

  // Cycle 1 is implicit — naming it adds noise to the common case.
  const prefix = s.cycleNumber > 1 ? `Cycle ${s.cycleNumber} · ` : "";

  if (s.phase === "on") {
    return {
      text: `${prefix}Day ${s.dayOfPhase}/${s.phaseDays} · ends ${fmtCycleDay(s.onCycleEndsOn)}`,
      tone: s.daysRemaining <= CYCLE_WARN_DAYS ? "warn" : "neutral",
    };
  }

  if (s.phase === "ended") {
    return { text: `Cycle complete ${fmtCycleDay(s.onCycleEndsOn)}`, tone: "warn" };
  }

  const restart = s.nextPhaseStartsOn;
  return {
    text: `${prefix}Off cycle · restart ${restart ? fmtCycleDay(restart) : "—"}`,
    tone: s.daysRemaining <= CYCLE_WARN_DAYS ? "warn" : "neutral",
  };
}
