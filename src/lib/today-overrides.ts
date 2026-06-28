/**
 * Pure (no-I/O) override-classification logic extracted from today.ts so it can
 * be unit-tested without the DB. Behaviour is identical to the inline version it
 * replaced — see today.ts for how the results are consumed.
 *
 * ── TZ assumption (WS6 hardening) ─────────────────────────────────────────────
 * A confirmed fixed_anchor snap-back deletes the week's on-grid PlannedDose rows
 * and writes shifted OFF-grid ones. Only those off-grid rows are real overrides;
 * routine rows materialised by the rolling cron sit ON the live grid and must
 * NOT hijack Today.
 *
 * Classification compares each PlannedDose's *local calendar day* against the
 * protocol's grid. `PlannedDose.scheduledAt` is stored as an absolute instant
 * representing a LOCAL midnight, so `startOfDay(new Date(scheduledAt))` only
 * recovers the intended day when the runtime TZ matches the TZ the row was
 * written in (Australia/Brisbane).
 *
 * PROD BUG (fixed 2026-06-21 by container `TZ=Australia/Brisbane`): under a UTC
 * runtime a Monday-local-midnight row (`…T00:00+10:00` = `…T14:00Z`) reads back
 * as the *Sunday* 14:00Z → `startOfDay` → Sunday → off the M/W/F grid → wrongly
 * classified as a rebase override → the dose shows "due" a day early.
 * Defence-in-depth: a startup TZ guard in `src/instrumentation.ts` plus the
 * regression tests in `today.test.ts`. The deeper fix (out of scope here) is to
 * persist an explicit local-date string on PlannedDose so classification never
 * depends on the runtime TZ at all.
 */
// Relative (not "@/") imports: today-overrides.ts is imported by today.test.ts
// under vitest, which does not resolve the "@/" path alias for value imports.
import { startOfDay } from "./schedule/schedule";
import { parseSchedule, slotsOn } from "./schedule/entries";

/** Local-calendar-day key "YYYY-MM-DD" (derived in the runtime TZ — see file header). */
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Minimal protocol shape the override classifier needs (structurally satisfied by Prisma's Protocol). */
export interface OverrideClassifierProtocol {
  id: string;
  scheduleRule: string | null;
  rebaseMode: string | null;
  startDate: Date | null;
  endDate: Date | null;
}

/** Minimal planned-dose row shape (structurally satisfied by Prisma's PlannedDose). */
export interface OverridePlannedRow {
  protocolId: string;
  scheduledAt: Date | string;
}

/**
 * Map of protocolId → set of shifted day-keys that are genuine rebase overrides
 * for the queried week. Only fixed_anchor protocols rebase by writing shifted
 * off-grid rows; rolling (or any non-fixed_anchor) protocols' off-grid planned
 * rows are stale routine artefacts and are skipped so the protocol falls through
 * to the live slotsOn() grid in today.ts.
 */
export function classifyOverrideDays(
  protocols: OverrideClassifierProtocol[],
  plannedRows: OverridePlannedRow[],
): Map<string, Set<string>> {
  const protoById = new Map(protocols.map((p) => [p.id, p] as const));
  // A genuine fixed_anchor rebase (confirmRebase) DELETES the week's on-grid rows
  // and writes ONLY shifted off-grid ones — so a real rebase week has off-grid
  // rows and NO on-grid rows. If an on-grid planned row is also present, any
  // off-grid rows are stale artefacts (an edited schedule, a partial/old rebase,
  // or a re-materialised grid) and must NOT suppress the live grid — otherwise a
  // genuinely-scheduled day (e.g. today) wrongly drops off Today while the
  // dashboard + week view (which read the live schedule) still show it.
  const hasOnGrid = new Set<string>();
  const offGridDays = new Map<string, Set<string>>();
  for (const o of plannedRows) {
    const proto = protoById.get(o.protocolId);
    if (!proto?.scheduleRule) continue;
    if (proto.rebaseMode !== "fixed_anchor") continue;
    const rowDay = startOfDay(new Date(o.scheduledAt));
    const onGrid = slotsOn(parseSchedule(proto.scheduleRule), rowDay, proto.startDate, proto.endDate).length > 0;
    if (onGrid) {
      hasOnGrid.add(o.protocolId); // routine materialised row — the live grid is active
      continue;
    }
    let set = offGridDays.get(o.protocolId);
    if (!set) {
      set = new Set<string>();
      offGridDays.set(o.protocolId, set);
    }
    set.add(dayKey(rowDay));
  }
  // Only protocols whose week is PURELY off-grid are genuine rebases.
  const overrideDays = new Map<string, Set<string>>();
  for (const [protocolId, days] of offGridDays) {
    if (hasOnGrid.has(protocolId)) continue; // stale off-grid rows coexist with the live grid → ignore
    overrideDays.set(protocolId, days);
  }
  return overrideDays;
}

/**
 * Which slots are due on `day` for a protocol, given its override set (if any).
 * Override days are always a single untimed dose; otherwise the live grid wins.
 * This is the exact decision today.ts makes per protocol per day, collapsed to a
 * pure function so the "not due on Sunday" regression can assert it directly.
 */
export function dueSlotsForDay(
  scheduleRule: string | null,
  overrideSet: Set<string> | undefined,
  day: Date,
  startDate: Date | null,
  endDate: Date | null,
): { time: string | null }[] {
  if (overrideSet) return overrideSet.has(dayKey(day)) ? [{ time: null }] : [];
  return slotsOn(parseSchedule(scheduleRule), day, startDate, endDate);
}
