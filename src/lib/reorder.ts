import "server-only";
import { cache } from "react";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { startOfDay } from "@/lib/schedule/schedule";
import { buildForecastPlan, conv1ToLocalDay } from "@/lib/forecast-slots";
import { resolveBudDays, beyondUseDateFrom } from "@/lib/bud";
import {
  dayKey,
  forecastCoverage,
  type CoverageBasis,
  type ForecastContainer,
  type ReorderStatus,
} from "@/lib/reorder-forecast";
import type { Syringe } from "@/lib/dosing/types";


const DEFAULT_LEAD_DAYS = 14;
const DEFAULT_BUFFER_DAYS = 3;

/** Fallback syringe when a protocol names none. U-100 is the app-wide default. */
const DEFAULT_SYRINGE: Syringe = {
  name: "U-100 1mL",
  graduationType: "units",
  unitsPerMl: 100,
  capacityMl: 1,
  capacityUnits: 100,
  increment: 1,
};

export type { ReorderStatus, CoverageBasis };

export interface PeptideReorder {
  peptideId: string;
  peptideName: string;
  status: ReorderStatus;
  coverageDays: number | null;
  coverageBasis: CoverageBasis | null;
  depletionDate: string | null;
  reorderByDate: string | null;
  /** Last scheduled dose the stock covers, when the course has a finite end. */
  courseEndDate: string | null;
  /** Cycle phase TODAY. Metadata for the tile — never a status (R1). */
  phaseToday: "on" | "off" | null;
  /** True when the protocol's first dose is still in the future. */
  notStarted: boolean;
  /** Day of the first scheduled dose ahead, for the "starts 28 Sep" qualifier. */
  firstDoseDate: string | null;
  leadTimeDays: number;
}

async function loadReorderStatus(userId: string, now = new Date()): Promise<PeptideReorder[]> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const userLead = user?.reorderLeadTimeDays ?? DEFAULT_LEAD_DAYS;
  const bufferDays = user?.reorderBufferDays ?? DEFAULT_BUFFER_DAYS;

  const protocols = await prisma.protocol.findMany({
    where: { userId, status: "active" },
    include: { peptide: true, steps: true, prescription: true },
  });
  const protoByPeptide = new Map<string, (typeof protocols)[number]>();
  for (const p of protocols) if (!protoByPeptide.has(p.peptideId)) protoByPeptide.set(p.peptideId, p);

  const protocolIds = [...protoByPeptide.values()].map((p) => p.id);
  const logsByProtocol = new Map<string, { id: string; takenAt: Date; localDay: string | null }[]>();
  if (protocolIds.length > 0) {
    const logs = await prisma.doseLog.findMany({
      where: { userId, protocolId: { in: protocolIds } },
      select: { id: true, takenAt: true, localDay: true, protocolId: true },
    });
    for (const l of logs) {
      if (!l.protocolId) continue;
      const arr = logsByProtocol.get(l.protocolId) ?? [];
      arr.push({ id: l.id, takenAt: l.takenAt, localDay: l.localDay });
      logsByProtocol.set(l.protocolId, arr);
    }
  }

  // Standing prescriptions, for the lead-time fallback.
  const standingRx = await prisma.prescription.findMany({
    where: { userId, status: "active", leadTimeDays: { not: null } },
    orderBy: { dateWritten: "desc" },
    select: { peptideId: true, leadTimeDays: true },
  });
  const leadByPeptide = new Map<string, number>();
  for (const rx of standingRx) if (rx.peptideId && !leadByPeptide.has(rx.peptideId)) leadByPeptide.set(rx.peptideId, rx.leadTimeDays!);

  // All vials for all relevant peptides in ONE query — the per-protocol query
  // inside the loop was an N+1 (R7).
  const peptideIds = [...protoByPeptide.keys()];
  const allVials = peptideIds.length
    ? await prisma.vial.findMany({
        where: { userId, peptideId: { in: peptideIds }, status: { in: ["sealed", "in_use"] } },
        include: { preparations: { where: { active: true }, orderBy: { reconstitutedAt: "desc" }, take: 1 } },
      })
    : [];
  const vialsByPeptide = new Map<string, typeof allVials>();
  for (const v of allVials) {
    const arr = vialsByPeptide.get(v.peptideId) ?? [];
    arr.push(v);
    vialsByPeptide.set(v.peptideId, arr);
  }

  // Syringes: `Protocol.defaultSyringeId` is a bare column with no Prisma
  // relation, so it is resolved by lookup — same pattern as inventory.ts:141.
  const syringes = await prisma.syringe.findMany({ where: { OR: [{ userId }, { userId: null }] } });
  const syringeById = new Map(syringes.map((s) => [s.id, s]));

  const results: PeptideReorder[] = [];
  const today = startOfDay(now);

  for (const proto of protoByPeptide.values()) {
    // Slot derivation, cycle gating and stop-reason live in forecast-slots.ts so
    // the inventory page's per-vial figure walks exactly the same schedule.
    const plan = buildForecastPlan({
      protocol: proto,
      deliveredLogs: logsByProtocol.get(proto.id) ?? [],
      now,
    });

    const budDays = resolveBudDays({ peptideDefaultBudDays: proto.peptide.defaultBudDays });
    const vials = vialsByPeptide.get(proto.peptideId) ?? [];
    const containers: (ForecastContainer & { openedAt: number })[] = vials.map((v) => {
      const p = v.preparations[0] ?? null;
      if (p) {
        return {
          openedAt: p.reconstitutedAt.getTime(),
          kind: "prep" as const,
          poolMl: new Decimal(p.remainingMl.toString()),
          concentrationMcgPerMl: new Decimal(p.concentrationMcgPerMl.toString()),
          poolMcg: null,
          // `beyondUseDate` is null whenever the user left the field blank at
          // reconstitution (actions/reconstitution.ts:79) — and a null here
          // means "no limit" to the walk, which reintroduces exactly the
          // year-long drain of a single prep that R11 exists to stop. Fall back
          // to the same resolved BUD window the rest of the app uses.
          usableUntil:
            conv1ToLocalDay(p.beyondUseDate) ??
            conv1ToLocalDay(beyondUseDateFrom(p.reconstitutedAt, budDays)),
        };
      }
      return {
        openedAt: 0,
        kind: "sealed" as const,
        poolMl: null,
        concentrationMcgPerMl: null,
        poolMcg: new Decimal(v.labelStrengthMg.toString()).times(1000),
        usableUntil: conv1ToLocalDay(v.expiry),
      };
    });
    // Open preps first (newest reconstitution first), then sealed — the order
    // the logger actually picks (today.ts takes the newest active prep across
    // the peptide). The DB returns vials unordered, so without this explicit
    // sort a peptide with two open preps would be walked in arbitrary order —
    // and drawing the SOONER-EXPIRING prep first harvests doses that would in
    // reality be stranded past its BUD, overstating coverage (R15).
    containers.sort((a, b) =>
      a.kind === b.kind ? b.openedAt - a.openedAt : a.kind === "prep" ? -1 : 1,
    );

    const leadTimeDays = proto.prescriptionId
      ? (proto.prescription?.leadTimeDays ?? userLead)
      : (leadByPeptide.get(proto.peptideId) ?? userLead);

    const syr = proto.defaultSyringeId ? syringeById.get(proto.defaultSyringeId) : null;
    const syringe: Syringe = syr
      ? {
          name: syr.name,
          graduationType: syr.graduationType as "units" | "ml",
          unitsPerMl: syr.unitsPerMl,
          capacityMl: Number(syr.capacityMl.toString()),
          capacityUnits: syr.capacityUnits,
          increment: Number(syr.increment.toString()),
        }
      : DEFAULT_SYRINGE;

    const r = forecastCoverage({
      slots: plan.slots,
      containers,
      syringe,
      scheduleEvaluable: plan.scheduleEvaluable,
      stopReason: plan.stopReason,
      courseEndDate: plan.courseEndDate,
      leadTimeDays,
      bufferDays,
      today,
      budDaysForSealed: budDays,
    });

    results.push({
      peptideId: proto.peptideId,
      peptideName: proto.peptide.name,
      status: r.status,
      coverageDays: r.coverageDays,
      coverageBasis: r.coverageBasis,
      depletionDate: r.depletionDate,
      reorderByDate: r.reorderByDate,
      courseEndDate: r.courseEndDate,
      phaseToday: plan.phaseToday,
      // The PROTOCOL has not started — not merely "the next slot is tomorrow".
      // Keying this off the first future slot marked every weekday-only or
      // already-dosed-today protocol as not started.
      notStarted: proto.startDate != null && startOfDay(proto.startDate) > today,
      firstDoseDate: plan.slots.length > 0 ? dayKey(plan.slots[0].date) : null,
      leadTimeDays: r.leadTimeDays,
    });
  }

  // reorder_now first, then soonest reorderByDate, then name. Adding a status
  // to ReorderStatus is a COMPILE error here until this map is updated — the
  // good failure mode. Never soften it to Partial<Record<…>>: a missing key
  // makes `rank[a] - rank[b]` NaN, which is falsy, so `||` silently falls
  // through to the date comparator — the order stays deterministic but
  // reorder_now quietly loses its priority, which is far harder to notice
  // than a crash (R6).
  const rank: Record<ReorderStatus, number> = { reorder_now: 0, ok: 1, covered: 2, unknown: 3 };
  return results.sort((a, b) =>
    rank[a.status] - rank[b.status] ||
    (a.reorderByDate ?? "9999").localeCompare(b.reorderByDate ?? "9999") ||
    a.peptideName.localeCompare(b.peptideName),
  );
}

/**
 * Request-scoped memo (R7). Each of the three call sites currently invokes this
 * once per request, so today this is insurance rather than a saving — `cache()`
 * dedupes WITHIN one render pass, never across requests. It earns its place the
 * moment a second component on the same page needs the data.
 *
 * The `typeof` guard is not defensive noise: `react`'s `cache` only exists
 * under the `react-server` condition, so a bare `cache(...)` at module scope
 * throws "cache is not a function" the moment anything imports this file
 * outside an RSC render — including every unit test and offline replay. The
 * guard keeps request-level dedupe in the app and keeps the module importable.
 */
export const getReorderStatus: typeof loadReorderStatus =
  typeof cache === "function" ? cache(loadReorderStatus) : loadReorderStatus;

/** Uncached seam for tests and offline replays. */
export const getReorderStatusUncached = loadReorderStatus;
