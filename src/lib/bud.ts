/**
 * Beyond-use date (BUD) — the calendar date a prepared vial stops being usable.
 * Distinct from `Vial.expiry`, which is the manufacturer's expiry on the sealed
 * lyophilised product and is typically years out.
 *
 * ## Storage convention — this file exists to enforce it
 *
 * The app uses three deliberate DateTime conventions, each internally
 * consistent across every stored row:
 *
 *   1. DATE-ONLY  → UTC midnight. `Vial.expiry`, `Protocol.startDate/endDate`,
 *      `LabPanel.collectedDate`, `JournalEntry.date`, `Prescription.*`.
 *      Written as `new Date("YYYY-MM-DD")`, rendered as
 *      `.toISOString().slice(0, 10)`. Both halves are UTC, so they agree.
 *   2. LOCAL MIDNIGHT → `WearableDaily.date` only, documented in the schema.
 *   3. INSTANT → `DoseLog.takenAt`, `Preparation.reconstitutedAt`, `createdAt`,
 *      `PlannedDose.scheduledAt`. Rendered in local time.
 *
 * `beyondUseDate` is a CALENDAR DATE and belongs to convention 1. It was the
 * one column in the schema that had drifted into holding all three at once,
 * because it had three writers: the edit form wrote UTC midnight from a
 * `<input type="date">`, the recon wizard wrote `now + N days` (an arbitrary
 * time-of-day), and an older path wrote local midnight. The result rendered a
 * day early for anyone east of Greenwich. Migration
 * `20260814093000_normalise_beyond_use_date` snaps every row onto convention 1
 * by its local calendar day. Everything here keeps it there.
 *
 * Consequently BUD comparisons are DAY-KEY comparisons, never instant
 * subtraction: "use by 11 Sep" means 11 Sep is still fine and 12 Sep is late,
 * regardless of the hour or the viewer's zone.
 *
 * Severity is capped at "warn" by construction. A dose already injected must
 * stay loggable; blocking the log would drop it from the record and corrupt
 * every adherence figure downstream. Prevention belongs before the injection.
 */
import { localDayOf } from "./local-day";
import type { DosingWarning } from "./dosing/types";

const MS_PER_DAY = 86_400_000;

/** Fallback when neither the preparation nor the peptide specifies one. */
export const BUD_DEFAULT_DAYS = 28;

/** How far ahead of the BUD to start warning. */
export const BUD_APPROACHING_DAYS = 3;

export type BudState = "ok" | "approaching" | "passed" | "unknown";

export interface BudStatus {
  state: BudState;
  /** Whole days until the BUD; 0 on the BUD day, negative once past. */
  daysRemaining: number | null;
}

/** A day count is usable only if it is finite and at least one whole day. */
function validDays(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const floored = Math.floor(v);
  return floored > 0 ? floored : null;
}

/**
 * Resolve the BUD window, most specific source first:
 * per-preparation override → per-peptide default → global 28 days.
 */
export function resolveBudDays(args: {
  overrideDays?: number | null;
  peptideDefaultBudDays?: number | null;
}): number {
  return validDays(args.overrideDays) ?? validDays(args.peptideDefaultBudDays) ?? BUD_DEFAULT_DAYS;
}

/**
 * The calendar day a convention-1 date names. UTC by definition — the stored
 * instant IS UTC midnight of that day, so this is a read, not a conversion.
 */
export function budDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayKeyToUtcMs(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * UTC midnight of (the LOCAL calendar day of `reconstitutedAt`) + `days`.
 *
 * Local day in, UTC midnight out: preparing a vial at 08:15 on 14 Aug in
 * Brisbane must yield 11 Sep, not 10 Sep. Taking `.getTime() + days * 86400000`
 * would carry the 08:15 through and land on an instant whose UTC day is the
 * 10th — the exact bug this replaces.
 */
export function beyondUseDateFrom(reconstitutedAt: Date, days: number): Date {
  const [y, m, d] = localDayOf(reconstitutedAt).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)); // Date.UTC normalises overflow
}

export function budStatus(args: {
  beyondUseDate: Date | null | undefined;
  now: Date;
  approachingWithinDays?: number;
}): BudStatus {
  if (!args.beyondUseDate) return { state: "unknown", daysRemaining: null };

  // The BUD's day is absolute; "today" is the viewer's local day.
  const budMs = dayKeyToUtcMs(budDayKey(args.beyondUseDate));
  const todayMs = dayKeyToUtcMs(localDayOf(args.now));
  const daysRemaining = Math.round((budMs - todayMs) / MS_PER_DAY);

  // The BUD day itself is still usable — "use by the 11th" includes the 11th.
  if (daysRemaining < 0) return { state: "passed", daysRemaining };

  const window = args.approachingWithinDays ?? BUD_APPROACHING_DAYS;
  return { state: daysRemaining <= window ? "approaching" : "ok", daysRemaining };
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * A `DosingWarning` for the preparation's BUD, or null when there is nothing
 * to say. Shaped to merge straight into `DrawResult.warnings` so the UI
 * renders it through the existing warning path.
 */
export function budWarning(args: {
  beyondUseDate: Date | null | undefined;
  now: Date;
  approachingWithinDays?: number;
}): DosingWarning | null {
  const { state, daysRemaining } = budStatus(args);

  if (state === "passed") {
    return {
      code: "PREPARATION_PAST_BUD",
      severity: "warn",
      message: `This preparation passed its beyond-use date ${plural(
        Math.abs(daysRemaining ?? 0),
        "day",
      )} ago. Potency and sterility are no longer assured — reconstitute a fresh vial.`,
    };
  }

  if (state === "approaching") {
    return {
      code: "PREPARATION_BUD_APPROACHING",
      severity: "warn",
      message:
        daysRemaining === 0
          ? "This preparation reaches its beyond-use date today. Plan a fresh reconstitution."
          : `This preparation reaches its beyond-use date in ${plural(
              daysRemaining ?? 0,
              "day",
            )}. Plan a fresh reconstitution.`,
    };
  }

  return null;
}
