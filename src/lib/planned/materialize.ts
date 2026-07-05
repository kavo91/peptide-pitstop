/**
 * Pure planned-dose materializer. No I/O — takes protocol data and existing
 * PlannedDose rows; returns the desired upsert set and any status transitions.
 *
 * Call site for schedule expansion:
 *   slotsInRange / slotsOn / parseSchedule (src/lib/schedule/entries.ts) — the
 *   custom-schedules engine. Parses both JSON scheduleRule (starts with "[") and
 *   legacy RRULE strings, so JSON custom schedules expand correctly rather than
 *   falling back to DAILY.
 */

import { startOfDay, addDays } from "../schedule/schedule";
import { parseSchedule, slotsOn, slotsInRange } from "../schedule/entries";
import { resolveTitration } from "../titration/resolve";
import { buildResolveInput, type DeliveredLogInput } from "../titration/from-protocol";

// ─── input types ──────────────────────────────────────────────────────────

export interface ProtocolInput {
  id: string;
  userId: string;
  status: string;           // "active" | "paused" | "completed"
  scheduleRule: string | null;
  targetDose: string | null;
  doseInputUnit: string;
  /** per_injection | per_week — drives the basis-aware per-injection conversion. */
  doseBasis: string | null;
  /** fixed_anchor | rolling — needed for the resolver's within-week rebase. */
  rebaseMode: string | null;
  adherenceWindowMin: number | null;
  startDate: Date | null;
  endDate: Date | null;
  steps: ProtocolStepInput[];
  scheduleType: string;
  /** This protocol's FULL delivered DoseLog history — drives the titration phase cursor. */
  deliveredLogs: DeliveredLogInput[];
}

export interface ProtocolStepInput {
  stepIndex: number;
  dose: string;
  doseInputUnit: string;
  durationDays: number | null;
}

export interface PlannedDoseInput {
  id: string;
  protocolId: string;
  scheduledAt: Date;
  status: string;           // "planned" | "taken" | "missed" | "skipped"
  hasDoseLog: boolean;
}

// ─── output types ─────────────────────────────────────────────────────────

export interface PlannedDoseUpsert {
  protocolId: string;
  userId: string;
  scheduledAt: Date;
  targetDose: string | null;
  doseInputUnit: string;
  status: "planned";
}

export interface StatusUpdate {
  id: string;
  status: "missed";
}

export interface MaterializeResult {
  /** Rows to upsert (keyed on protocolId + scheduledAt by the runner). */
  upserts: PlannedDoseUpsert[];
  /** Existing rows whose status should be updated to "missed". */
  statusUpdates: StatusUpdate[];
  /**
   * Ids of stale rows to DELETE: planned/missed rows with no linked DoseLog
   * whose scheduledAt falls outside the protocol's [startDate, endDate] window
   * (stranded when a start date moves later / an end date moves earlier).
   * PlannedDose is a projection of the schedule — actual history lives in
   * DoseLog, which is never touched; rows WITH a DoseLog are always kept.
   */
  deletions: string[];
}

// ─── local helpers ────────────────────────────────────────────────────────

const KEY = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Monday (local) of the week containing `date` — mirrors weekStartOf in doses-timeline.ts */
function weekStartOf(date: Date): Date {
  const s = startOfDay(date);
  return addDays(s, -((s.getDay() + 6) % 7));
}

// ─── main export ──────────────────────────────────────────────────────────

/**
 * Compute the desired PlannedDose state for all active protocols across the
 * given horizon. Pure — no database access.
 *
 * @param protocols   Active (and paused/completed — filtered here) protocols.
 * @param horizonStart  Start of the generation window (inclusive, local midnight).
 * @param horizonEnd    End of the generation window (inclusive, local midnight).
 * @param existing    All PlannedDose rows for these protocols (any status) within
 *                    or before the horizon, used for override detection +
 *                    missed-dose reconciliation.
 * @param today       Local midnight of "today" — the reconciliation boundary.
 */
export function materializePlannedDoses(args: {
  protocols: ProtocolInput[];
  horizonStart: Date;
  horizonEnd: Date;
  existing: PlannedDoseInput[];
  today: Date;
}): MaterializeResult {
  const { protocols, horizonStart, horizonEnd, existing, today } = args;
  const todayKey = KEY(today);

  // Build a lookup: protocolId → protocol (window + rule lookups below).
  const protocolMap = new Map(protocols.map((p) => [p.id, p]));

  /**
   * Is this row a STRANDED projection artefact (vs live grid or a genuine
   * rebase override)? Two — and only two — shapes qualify:
   *   - BEFORE startDate: categorically stale. A genuine confirmRebase row
   *     derives from a real logged dose inside the started window, so nothing
   *     legitimate lives before the start (BPC+TB4 prod bug, 2026-07-02).
   *   - AFTER endDate: categorically stale. End dates are an inclusive cutoff;
   *     no scheduled projection (routine or rebase-shifted) may survive past it.
   * A degenerate window (startDate after endDate — the card editor can't see
   * the end date, so this is reachable) marks NOTHING stale: both half-window
   * tests would otherwise cover the entire timeline and mass-delete history.
   */
  const isStale = (p: ProtocolInput, scheduledAt: Date): boolean => {
    const rowDay = startOfDay(scheduledAt);
    if (p.startDate && p.endDate && startOfDay(p.startDate) > startOfDay(p.endDate)) return false;
    if (p.startDate && rowDay < startOfDay(p.startDate)) return true;
    if (p.endDate && rowDay > startOfDay(p.endDate)) return true;
    return false;
  };

  // ── 0. Stale-row cleanup ─────────────────────────────────────────────────
  // A stranded planned/missed row with no linked DoseLog is deleted: left
  // alone it masquerades as a rebase override (dose shows due before the
  // protocol starts), gets marked "missed" (adherence pollution), and fires
  // reminders. Rows with a DoseLog, or taken/skipped rows, are never touched.
  const deletions: string[] = [];
  const staleIds = new Set<string>();
  for (const row of existing) {
    if (row.hasDoseLog) continue;
    if (row.status !== "planned" && row.status !== "missed") continue;
    const p = protocolMap.get(row.protocolId);
    if (!p) continue;
    if (isStale(p, row.scheduledAt)) {
      deletions.push(row.id);
      staleIds.add(row.id);
    }
  }

  // ── 1. Compute override-suppressed week set per protocol ─────────────────
  // A "rebase override" is an existing "planned" row whose scheduledAt falls
  // OFF the protocol's schedule grid (written by confirmRebase with a shifted
  // date). We detect these by checking whether the existing row's scheduledAt
  // is NOT a due-date for the protocol's rule. If an off-grid "planned" row
  // exists in a week, the generator skips grid expansion for that whole week.
  //
  // Existing "planned" rows that ARE on the grid (e.g. from a previous run of
  // this same generator) do NOT trigger suppression — this preserves idempotency.
  // Existing rows with status != "planned" (taken/missed/skipped) are history
  // and do not trigger suppression.

  type ProtocolWeekKey = string; // `${protocolId}:${weekKey}`
  const suppressedWeeks = new Set<ProtocolWeekKey>();

  // A genuine confirmRebase deletes the week's on-grid rows and writes ONLY
  // shifted off-grid ones. So suppress a (protocol, week) only when it has
  // off-grid "planned" rows AND NO on-grid one. A MIX (on-grid + off-grid) means
  // the off-grid rows are stale artefacts (edited schedule / old rebase) — those
  // must not suppress and lose the live grid for that week (which would drop a
  // genuinely-scheduled day from Today).
  const onGridWeeks = new Set<ProtocolWeekKey>();
  const offGridWeeks = new Set<ProtocolWeekKey>();
  for (const row of existing) {
    if (row.status !== "planned") continue;
    const p = protocolMap.get(row.protocolId);
    if (!p || !p.scheduleRule) continue;
    // Stranded rows are stale artefacts (deleted above), never genuine
    // rebase overrides — they must not suppress the live grid for their week.
    if (isStale(p, row.scheduledAt)) continue;
    const onGrid =
      slotsOn(parseSchedule(p.scheduleRule), row.scheduledAt, p.startDate, p.endDate).length > 0;
    const key = `${row.protocolId}:${KEY(weekStartOf(row.scheduledAt))}`;
    (onGrid ? onGridWeeks : offGridWeeks).add(key);
  }
  for (const key of offGridWeeks) {
    if (!onGridWeeks.has(key)) suppressedWeeks.add(key);
  }

  // ── 2. Expand schedule grid → desired upsert set ─────────────────────────
  const upserts: PlannedDoseUpsert[] = [];

  for (const p of protocols) {
    // Only materialize active protocols.
    if (p.status !== "active") continue;
    if (!p.scheduleRule) continue;

    const occurrences = [
      ...new Map(
        slotsInRange(parseSchedule(p.scheduleRule), horizonStart, horizonEnd, p.startDate, p.endDate)
          .map((s) => [KEY(s.date), startOfDay(s.date)] as const),
      ).values(),
    ];

    // Resolve the per-injection dose for every slot in the horizon ONCE per
    // protocol (single source of truth). A raw per_week weekly value must never
    // be persisted into PlannedDose.targetDose where it would later be read as a
    // per-injection dose (spec §6) — the resolver divides it exactly once.
    const resolved = resolveTitration(
      buildResolveInput({
        protocol: {
          doseBasis: p.doseBasis,
          targetDose: p.targetDose,
          doseInputUnit: p.doseInputUnit,
          scheduleRule: p.scheduleRule,
          rebaseMode: p.rebaseMode,
          startDate: p.startDate,
          endDate: p.endDate,
          adherenceWindowMin: p.adherenceWindowMin,
          steps: p.steps,
        },
        deliveredLogs: p.deliveredLogs,
        range: { start: horizonStart, end: horizonEnd },
        now: today,
      }),
    );
    // Index resolved slots by date (occurrences are untimed/per-day); first slot
    // for a date wins, matching the day-level dose used for planned rows.
    const resolvedByDate = new Map<string, (typeof resolved.slots)[number]>();
    for (const rs of resolved.slots) {
      const k = KEY(rs.date);
      if (!resolvedByDate.has(k)) resolvedByDate.set(k, rs);
    }

    for (const occ of occurrences) {
      // Suppress grid slots for weeks that already have override "planned" rows.
      const weekKey = KEY(weekStartOf(occ));
      if (suppressedWeeks.has(`${p.id}:${weekKey}`)) continue;

      // Per-injection dose for this occurrence's date. The resolver emits "" only
      // when a per_week dose can't be divided (frequency unresolved) — in that
      // case write null so the upsert PRESERVES any prior value rather than
      // overwriting it with an (undivided) weekly figure. per_injection always
      // resolves; non-titration falls through to the resolved fallback dose.
      const slot = resolvedByDate.get(KEY(occ));
      const resolvedValue = slot && slot.perInjectionValue !== "" ? slot.perInjectionValue : null;
      const targetDose =
        resolvedValue ?? (p.doseBasis === "per_week" ? null : p.targetDose);
      const doseInputUnit = slot ? slot.perInjectionUnit : p.doseInputUnit;

      upserts.push({
        protocolId: p.id,
        userId: p.userId,
        scheduledAt: occ,
        targetDose,
        doseInputUnit,
        status: "planned",
      });
    }
  }

  // ── 3. Missed-dose reconciliation ────────────────────────────────────────
  // An existing "planned" row whose scheduledAt is strictly before today and
  // has no linked DoseLog → mark it "missed".
  const statusUpdates: StatusUpdate[] = [];

  for (const row of existing) {
    if (row.status !== "planned") continue;
    if (row.hasDoseLog) continue;
    if (staleIds.has(row.id)) continue; // being deleted — never mark missed
    const rowKey = KEY(row.scheduledAt);
    if (rowKey >= todayKey) continue; // today or future → not yet missed
    statusUpdates.push({ id: row.id, status: "missed" });
  }

  return { upserts, statusUpdates, deletions };
}
