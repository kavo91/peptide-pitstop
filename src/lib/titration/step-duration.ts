/**
 * Step-duration validation, shared by the server actions and the steps editor.
 *
 * Lives in `lib/` rather than in `app/actions/protocols.ts` because that module
 * is `"use server"` and may only export async functions — a plain constant or
 * sync helper exported from there is a build error. Both sides importing this
 * module is also what keeps the client-side message identical to the one the
 * server would return, instead of two strings drifting apart.
 *
 * `durationDays` is CALENDAR DAYS (14 = two weeks). The live resolver converts
 * it to a dose-count target — `round(durationDays / 7 × injectionsPerWeek)` in
 * `phase.ts` — and that function THROWS on a negative. So a negative that saved
 * cleanly would break every surface rendering the protocol: the write path must
 * not accept what the read path rejects. A naive `parseInt` check misses it,
 * because `parseInt("-7")` is a perfectly finite -7.
 *
 * Refuse, don't clamp. A negative is always a typo, and quietly turning it into
 * 0 or null would change the ramp the user believes they authored — a wrong
 * dose schedule is a worse outcome than a refused save.
 */

/** The one message every surface shows for a negative step duration. */
export const NEGATIVE_DURATION_ERROR =
  "Step length can't be negative. Enter the number of days as a positive number, " +
  "or leave it blank to make this the final open-ended step.";

/** True when the raw field holds a parseable negative. Blank/garbage is not negative. */
export function isNegativeDuration(v?: string | null): boolean {
  const s = (v ?? "").toString().trim();
  if (!s) return false;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n < 0;
}

export type DurationParse =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/** Parse one step's duration in calendar days; null = indefinite final step. */
export function parseStepDuration(v?: string | null): DurationParse {
  const s = (v ?? "").toString().trim();
  if (!s) return { ok: true, value: null };
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return { ok: true, value: null };
  if (n < 0) return { ok: false, error: NEGATIVE_DURATION_ERROR };
  return { ok: true, value: n };
}

/**
 * Validate a whole authored ladder, naming the offending step 1-based so the
 * message points at a row the user can actually see.
 */
export function validateStepDurations(
  steps: { durationDays?: string }[],
): { ok: true; values: (number | null)[] } | { ok: false; error: string } {
  const parsed = steps.map((s) => parseStepDuration(s.durationDays));
  const bad = parsed.findIndex((p) => !p.ok);
  if (bad >= 0) {
    return { ok: false, error: `Step ${bad + 1}: ${(parsed[bad] as { ok: false; error: string }).error}` };
  }
  return { ok: true, values: parsed.map((p) => (p as { ok: true; value: number | null }).value) };
}
