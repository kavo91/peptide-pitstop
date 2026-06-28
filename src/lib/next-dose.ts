/**
 * Next-dose countdown — find the earliest upcoming scheduled slot across all of
 * a user's ACTIVE protocols. Powers the dashboard's "Next: BPC-157 in 2d 4h"
 * line (folded into the Today tile's empty state).
 *
 * Split mirrors today.ts / today-overrides.ts: a PURE core (`computeNextDose`)
 * does the date logic over already-loaded protocol data and is unit-tested with
 * fixtures (vitest can't resolve the "@/" alias for value imports, so the pure
 * core + its test use RELATIVE imports). A thin DB wrapper (`getNextDose`) loads
 * active protocols via prisma and delegates — matching how today.ts loads them.
 */
// Relative (not "@/") imports: this module's pure core is imported by
// next-dose.test.ts under vitest, which does not resolve the "@/" path alias.
import { startOfDay, addDays } from "./schedule/schedule";
import { parseSchedule, slotsInRange } from "./schedule/entries";

/** Minimal protocol shape the next-dose core needs (structurally satisfied by Prisma's Protocol + peptide). */
export interface NextDoseProtocol {
  id: string;
  scheduleRule: string | null;
  startDate: Date | null;
  endDate: Date | null;
  peptide: { name: string };
}

export interface NextDose {
  peptideName: string;
  /** Absolute instant of the slot (local-midnight + HH:MM, or local-midnight for an untimed slot). */
  at: Date;
  protocolId: string;
}

/** How far ahead to look for the next scheduled slot. */
export const LOOKAHEAD_DAYS = 30;

/**
 * Resolve a DatedSlot (local-midnight `date` + optional "HH:MM" `time`) to an
 * absolute Date. Untimed slots resolve to the START of that day (local midnight),
 * matching how today.ts treats untimed slots (it measures them at `day`).
 */
function slotAt(date: Date, time: string | null): Date {
  const at = startOfDay(date);
  if (time) {
    const [h, m] = time.split(":").map(Number);
    at.setHours(h, m, 0, 0);
  }
  return at;
}

/**
 * PURE: earliest upcoming slot strictly after `now` across the given active
 * protocols, looking ahead `lookaheadDays`. Respects each protocol's
 * startDate/endDate via the schedule engine's window handling. Returns null when
 * nothing is upcoming.
 *
 * Status filtering (active-only) is the caller's responsibility — `getNextDose`
 * only loads active protocols, mirroring getTodayDoses.
 */
export function computeNextDose(
  protocols: NextDoseProtocol[],
  now: Date,
  lookaheadDays = LOOKAHEAD_DAYS,
): NextDose | null {
  // Scan from the start of TODAY so a slot due later today is included; the
  // strict `> now` check below excludes anything already past.
  const rangeStart = startOfDay(now);
  const rangeEnd = addDays(rangeStart, lookaheadDays);

  let best: NextDose | null = null;
  for (const p of protocols) {
    if (!p.scheduleRule) continue;
    const schedule = parseSchedule(p.scheduleRule);
    if (schedule.length === 0) continue;

    for (const slot of slotsInRange(schedule, rangeStart, rangeEnd, p.startDate, p.endDate)) {
      const at = slotAt(slot.date, slot.time);
      if (at.getTime() <= now.getTime()) continue; // strictly after now
      if (!best || at.getTime() < best.at.getTime()) {
        best = { peptideName: p.peptide.name, at, protocolId: p.id };
      }
    }
  }
  return best;
}

/**
 * DB wrapper: load the user's active protocols and return the earliest upcoming
 * dose, or null. Mirrors getTodayDoses' protocol query (status "active" +
 * peptide include).
 */
export async function getNextDose(userId: string, now = new Date()): Promise<NextDose | null> {
  // Lazy import keeps the pure core (and its test) free of the prisma client.
  const { prisma } = await import("@/lib/db");
  const protocols = await prisma.protocol.findMany({
    where: { userId, status: "active" },
    include: { peptide: { select: { name: true } } },
  });
  return computeNextDose(protocols, now);
}
