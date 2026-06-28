/**
 * Compact schedule tokens for the pit timing-board Cycle tile.
 *
 * A "token" is the short SCHED label shown per protocol row, e.g. "DAILY",
 * "MO·WE·FR", "EVERY 3D", "5/2". `isDaily` drives the cyan cadence colour for
 * every-session rows.
 *
 * Defensive by contract: malformed / empty / unparseable rules collapse to "—"
 * rather than rendering a misleading partial token. Multi-entry schedules append
 * a "+N" marker (N = entries beyond the first) so they are never silently
 * truncated to just the first entry.
 *
 * Pure — no I/O. The first-entry token output is byte-identical to the prior
 * inline page.tsx implementation for well-formed single-entry rules.
 */
import { parseSchedule, DAY_ORDER } from "./entries";
import type { DayPattern } from "./entries";

/** Rich token info for the timing-board row: the SCHED label + daily-cadence flag. */
export interface ScheduleTokenInfo {
  token: string;
  isDaily: boolean;
}

const NONE: ScheduleTokenInfo = { token: "—", isDaily: false };

/**
 * Token for a single day-pattern. Returns null when the pattern is malformed
 * (empty weekly byDays, non-positive interval/cycle counts, unknown kind) so the
 * caller can collapse to "—".
 */
function patternToken(p: DayPattern | undefined): ScheduleTokenInfo | null {
  if (!p) return null;
  switch (p.kind) {
    case "daily":
      return { token: "DAILY", isDaily: true };
    case "weekly": {
      if (!Array.isArray(p.byDays) || p.byDays.length === 0) return null;
      // Drop unknown day codes before sorting/joining — a malformed code would
      // otherwise sort by indexOf(-1) and render a misleading token. If nothing
      // valid survives, collapse to "—" per the defensive contract.
      const valid = p.byDays.filter((d) => DAY_ORDER.indexOf(d) !== -1);
      if (valid.length === 0) return null;
      const token = valid
        .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b))
        .join("·");
      return { token, isDaily: false };
    }
    case "interval": {
      if (!(p.everyDays >= 1)) return null;
      return p.everyDays === 1
        ? { token: "DAILY", isDaily: true }
        : { token: `EVERY ${p.everyDays}D`, isDaily: false };
    }
    case "cycle": {
      if (!(p.onDays >= 1) || !(p.offDays >= 1)) return null;
      return { token: `${p.onDays}/${p.offDays}`, isDaily: false };
    }
    default:
      return null;
  }
}

/**
 * Rich token info for a Protocol.scheduleRule: SCHED label + daily flag.
 * - Empty / unparseable / first-entry-malformed → { token: "—", isDaily: false }.
 * - >1 entry → first-entry token with a "+N" suffix (N = extra entries).
 */
export function scheduleTokenInfo(scheduleRule: string | null | undefined): ScheduleTokenInfo {
  // A schedule rule is either a JSON array of entries ("[…]") or a legacy RRULE
  // string ("FREQ=…"). A bare JSON object or other "{"-leading string is malformed
  // — parseSchedule would route it to the legacy parser's greedy daily fallback, so
  // guard here and collapse to "—" per the defensive contract.
  if ((scheduleRule ?? "").trim().startsWith("{")) return NONE;

  const schedule = parseSchedule(scheduleRule);
  if (schedule.length === 0) return NONE;

  const first = patternToken(schedule[0]?.dayPattern);
  if (!first) return NONE;

  const extra = schedule.length - 1;
  return extra > 0 ? { token: `${first.token} +${extra}`, isDaily: first.isDaily } : first;
}

/**
 * Compact SCHED token string for a Protocol.scheduleRule. Defensive: "—" on
 * empty / unparseable / malformed input; "+N" suffix for multi-entry schedules.
 */
export function scheduleToken(scheduleRule: string | null | undefined): string {
  return scheduleTokenInfo(scheduleRule).token;
}
