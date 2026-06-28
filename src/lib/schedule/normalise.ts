/**
 * Single entry point for turning a client-supplied schedule rule into the
 * canonical form we persist. saveProtocol / updateProtocol / updateStackSchedule
 * all call THIS so validation + canonicalisation stay in lock-step: first the
 * strict `validateScheduleRule` check (rejects never-due / malformed rules), then
 * — on success — re-emit the rule as `JSON.stringify(parseSchedule(rule))` so the
 * stored string is always JSON entries (legacy RRULE strings get upgraded too).
 */
import { parseSchedule } from "./entries";
import { validateScheduleRule } from "./validate";

export type NormaliseResult = { ok: true; rule: string } | { ok: false; error: string };

/**
 * Validate `rule` against `startDate`, and on success return the canonical stored
 * form. `startDate` is the protocol anchor ("yyyy-mm-dd", Date, or null) — required
 * for interval/cycle rules to be considered due. On failure the validator's
 * `{ ok: false, error }` is returned verbatim for the caller to map to its shape.
 */
export function normaliseScheduleRule(
  rule: string,
  startDate?: string | Date | null,
): NormaliseResult {
  const res = validateScheduleRule(rule, startDate);
  if (!res.ok) return res;
  return { ok: true, rule: JSON.stringify(parseSchedule(rule)) };
}
