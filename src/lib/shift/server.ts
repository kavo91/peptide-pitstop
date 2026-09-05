/**
 * Server-side loader for the dose-shift "Smooth your week" panel — the impure
 * edge around the pure `shift-suggest` engine.
 */
import "server-only";
import { prisma } from "@/lib/db";
import { addDays } from "@/lib/schedule/schedule";
import {
  computeShiftPlan,
  dayKey,
  stripWeekStart,
  type ShiftPlan,
  type ShiftProtocolInput,
  type SkipReason,
} from "@/lib/schedule/shift-suggest";

/**
 * How far back a logged dose still counts toward `loggedDayKeys`. The engine
 * only ever reads a logged day to decide (a) whether TODAY is already logged,
 * (b) the most recent logged day (falling back to the last surviving planned
 * day when nothing is logged), and (c) which days inside the transition
 * window are retired rather than moved. (a) and (c) only ever look at today
 * and the next three weeks. (b) is the one that can reach back: a protocol
 * with no dose logged in the last 90 days falls through to its last planned
 * day before today, so its gap sentence is then measured from a scheduled
 * dose rather than a taken one — an accepted, narrow trade for not loading
 * a year of rows on the two hottest pages (shortened from 400).
 */
const LOOKBACK_DAYS = 90;

/** Factory, not a shared constant — a mutated `current`/`suggestions` array
 * on one request's plan must never be visible to another request's. `weekStart`
 * comes from the engine's own rule so even the empty plan labels its strip
 * with the week the panel would otherwise have shown. */
const emptyPlan = (today: Date): ShiftPlan => ({
  current: [0, 0, 0, 0, 0, 0, 0],
  weekStart: stripWeekStart(today),
  suggestions: [],
  // No plan at all when the engine could not run — the panel's "unavailable"
  // state has nothing to draw a combined grid from.
  combined: null,
  skipped: [],
  pinned: [],
});

export interface ShiftPanelData {
  /** Viewer day key "YYYY-MM-DD". */
  today: string;
  plan: ShiftPlan;
  /** Candidates skipped for "pinned" — the panel's "Kept as is" list. */
  pinned: { protocolId: string; name: string; peptideName: string }[];
  /** Candidates skipped for any OTHER reason (never "inactive" — not loaded). */
  ineligible: {
    protocolId: string;
    name: string;
    peptideName: string;
    reason: Exclude<SkipReason, "inactive" | "pinned">;
  }[];
  /** True when the engine threw — the panel renders its "unavailable" state. */
  unavailable: boolean;
}

/**
 * Everything `/protocols` and Today need to render the dose-shift panel, for
 * one user on one day. The engine must never break either page: a thrown
 * exception is caught here, logged, and swapped for an empty, "unavailable"
 * plan rather than propagating.
 */
export async function getShiftPanelData(userId: string, today: Date): Promise<ShiftPanelData> {
  const [protocols, doseLogs] = await Promise.all([
    // orderBy is load-bearing, not tidiness: candidate order IS the engine's
    // final tie-break (the combined plan keeps the lexicographically smallest k-vector over
    // candidate positions, which are this query's row order), and joint states
    // tie the winning score often. An
    // unordered findMany lets SQLite's chosen plan decide which protocols move
    // and by how much, so the same data could render a different plan after an
    // unrelated insert. `id` because Protocol carries no createdAt — Prisma 5's
    // `cuid()` is timestamp-prefixed base36, so ascending id IS creation order
    // here, which is the order the tie-break derivation assumes.
    prisma.protocol.findMany({
      where: { userId, status: "active" },
      include: { peptide: { select: { name: true } } },
      orderBy: { id: "asc" },
    }),
    // ONE query for every candidate's logged days — never one query per
    // protocol. A null localDay (legacy row/client) falls back to the UTC date
    // of takenAt, exactly as the protocol edit page does (HAZARD comment
    // there: this must match, or a stale/legacy dose silently drops out of the
    // titration-phase carry-forward math the two share).
    prisma.doseLog.findMany({
      where: { userId, protocolId: { not: null }, takenAt: { gte: addDays(today, -LOOKBACK_DAYS) } },
      select: { protocolId: true, localDay: true, takenAt: true },
    }),
  ]);

  const loggedByProtocol = new Map<string, Set<string>>();
  for (const row of doseLogs) {
    if (!row.protocolId) continue;
    const key = row.localDay ?? row.takenAt.toISOString().slice(0, 10);
    const set = loggedByProtocol.get(row.protocolId) ?? new Set<string>();
    set.add(key);
    loggedByProtocol.set(row.protocolId, set);
  }

  const inputs: ShiftProtocolInput[] = protocols.map((p) => ({
    id: p.id,
    name: p.name,
    peptideName: p.peptide.name,
    status: p.status,
    scheduleRule: p.scheduleRule,
    startDate: p.startDate,
    endDate: p.endDate,
    cycleOnWeeks: p.cycleOnWeeks,
    cycleOffWeeks: p.cycleOffWeeks,
    cycleAnchor: p.cycleAnchor,
    stackId: p.stackId,
    shiftPinned: p.shiftPinned,
    loggedDayKeys: [...(loggedByProtocol.get(p.id) ?? [])],
  }));

  let plan: ShiftPlan;
  try {
    plan = computeShiftPlan({ protocols: inputs, today });
  } catch (e) {
    // The engine is pure and should never throw, but a bad/legacy scheduleRule
    // reaching parseSchedule is not impossible — never let that break the page
    // that lists every protocol.
    console.error("shift plan failed", e);
    return { today: dayKey(today), plan: emptyPlan(today), pinned: [], ineligible: [], unavailable: true };
  }

  const byId = new Map(protocols.map((p) => [p.id, p]));
  const pinned: ShiftPanelData["pinned"] = [];
  const ineligible: ShiftPanelData["ineligible"] = [];
  for (const skip of plan.skipped) {
    // "inactive" is never reachable here (the query already filters status
    // ourselves), but the engine reports it defensively — skip it too.
    if (skip.reason === "inactive") continue;
    const row = byId.get(skip.protocolId);
    if (!row) continue;
    if (skip.reason === "pinned") {
      pinned.push({ protocolId: row.id, name: row.name, peptideName: row.peptide.name });
    } else {
      ineligible.push({ protocolId: row.id, name: row.name, peptideName: row.peptide.name, reason: skip.reason });
    }
  }

  return { today: dayKey(today), plan, pinned, ineligible, unavailable: false };
}
