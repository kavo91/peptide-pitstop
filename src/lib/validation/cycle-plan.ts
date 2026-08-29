/**
 * Cycle-plan validation, shared by every action that writes the cycle columns
 * (saveProtocol's full form and updateProtocol's quick edits). One rule set so
 * the Gantt editor can never persist a plan the protocol form would refuse.
 */

/** Weeks outside this band are a typo, not a cycle — reject rather than persist. */
export const MAX_CYCLE_WEEKS = 104;

export type CyclePlanResult =
  | { ok: true; onWeeks: number | null; offWeeks: number | null }
  | { ok: false; error: string };

/**
 * Validate and normalise a cycle plan. Both lengths are optional; when present
 * they must be whole positive weeks inside a plausible band. A break with no
 * on-cycle is meaningless (nothing to break FROM), so it is rejected rather
 * than silently stored — otherwise the state machine would read the plan as
 * "continuous". Clearing the on-cycle clears the break with it rather than
 * leaving an orphan.
 */
export function validateCyclePlan(onWeeks: number | null, offWeeks: number | null): CyclePlanResult {
  for (const [label, weeks] of [["on-cycle", onWeeks], ["break", offWeeks]] as const) {
    if (weeks !== null && (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_CYCLE_WEEKS)) {
      return { ok: false, error: `Cycle ${label} must be between 1 and ${MAX_CYCLE_WEEKS} weeks.` };
    }
  }
  if (offWeeks !== null && onWeeks === null) {
    return { ok: false, error: "Set an on-cycle length before a break length." };
  }
  return { ok: true, onWeeks, offWeeks: onWeeks === null ? null : offWeeks };
}
