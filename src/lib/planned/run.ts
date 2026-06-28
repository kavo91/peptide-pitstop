import "server-only";
import { prisma } from "@/lib/db";
import { startOfDay, addDays } from "@/lib/schedule/schedule";
import { materializePlannedDoses, type ProtocolInput } from "./materialize";

/**
 * Load protocols + existing PlannedDose rows for a user, call the pure
 * planner, and apply the diff in a single transaction:
 *   - upsert desired rows (keyed on protocolId + scheduledAt)
 *   - bulk-update any "planned" → "missed" status transitions
 *
 * Safe to call concurrently: the unique index on (protocolId, scheduledAt)
 * prevents duplicate inserts; the transaction serializes the diff per call.
 */
export async function runPlannedDoseGeneration(userId: string): Promise<{
  upserted: number;
  markedMissed: number;
}> {
  const today = startOfDay(new Date());
  const horizonStart = today;
  const horizonEnd = addDays(today, 13); // 14-day window inclusive

  // ── Load protocols ───────────────────────────────────────────────────────
  // Fetch all statuses; materializePlannedDoses filters to "active" only.
  // Including paused/completed so the runner can skip them correctly.
  const rawProtocols = await prisma.protocol.findMany({
    where: { userId },
    include: { steps: true },
  });

  // Load this user's FULL delivered DoseLog history (id + takenAt only) so the
  // materializer can drive the titration phase cursor per protocol. One query,
  // grouped in memory — the phase cursor counts delivered doses, so it needs the
  // whole history, not just the horizon. Logs with no protocol are skipped.
  const allLogs = await prisma.doseLog.findMany({
    where: { userId, protocolId: { not: null } },
    select: { id: true, takenAt: true, protocolId: true },
  });
  const logsByProtocol = new Map<string, { id: string; takenAt: Date }[]>();
  for (const l of allLogs) {
    const list = logsByProtocol.get(l.protocolId!) ?? [];
    list.push({ id: l.id, takenAt: l.takenAt });
    logsByProtocol.set(l.protocolId!, list);
  }

  const protocols: ProtocolInput[] = rawProtocols.map((p) => ({
    id: p.id,
    userId: p.userId,
    status: p.status,
    scheduleRule: p.scheduleRule,
    targetDose: p.targetDose?.toString() ?? null,
    doseInputUnit: p.doseInputUnit,
    doseBasis: p.doseBasis,
    rebaseMode: p.rebaseMode,
    adherenceWindowMin: p.adherenceWindowMin,
    startDate: p.startDate,
    endDate: p.endDate,
    scheduleType: p.scheduleType,
    steps: p.steps.map((s) => ({
      stepIndex: s.stepIndex,
      dose: s.dose.toString(),
      doseInputUnit: s.doseInputUnit,
      durationDays: s.durationDays,
    })),
    deliveredLogs: logsByProtocol.get(p.id) ?? [],
  }));

  // ── Load existing PlannedDose rows ───────────────────────────────────────
  // Horizon window plus a past lookback for missed-dose detection.
  // The lookback covers any "planned" rows that predate today (may have
  // accumulated if the cron missed several ticks). 90 days is generous.
  const lookbackStart = addDays(today, -90);

  const existingRows = await prisma.plannedDose.findMany({
    where: {
      userId,
      scheduledAt: { gte: lookbackStart, lte: horizonEnd },
    },
    include: { doseLog: { select: { id: true } } },
  });

  const existing = existingRows.map((r) => ({
    id: r.id,
    protocolId: r.protocolId,
    scheduledAt: new Date(r.scheduledAt),
    status: r.status,
    hasDoseLog: r.doseLog !== null,
  }));

  // ── Run the pure planner ─────────────────────────────────────────────────
  const { upserts, statusUpdates } = materializePlannedDoses({
    protocols,
    horizonStart,
    horizonEnd,
    existing,
    today,
  });

  // ── Apply the diff in a transaction ──────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    // Upsert desired rows. The @@unique([protocolId, scheduledAt]) constraint
    // makes this safe to re-run — existing rows are updated in place (status
    // field only if currently "planned"; does not overwrite taken/missed/skipped).
    for (const row of upserts) {
      await tx.plannedDose.upsert({
        where: {
          protocolId_scheduledAt: {
            protocolId: row.protocolId,
            scheduledAt: row.scheduledAt,
          },
        },
        update: {
          // Do not overwrite non-planned statuses — preserve taken/missed/skipped.
          // Only update dose metadata (in case the protocol was edited).
          targetDose: row.targetDose !== null ? row.targetDose : undefined,
          doseInputUnit: row.doseInputUnit,
        },
        create: {
          userId: row.userId,
          protocolId: row.protocolId,
          scheduledAt: row.scheduledAt,
          targetDose: row.targetDose,
          doseInputUnit: row.doseInputUnit,
          status: "planned",
        },
      });
    }

    // Mark past unactioned rows as "missed".
    if (statusUpdates.length > 0) {
      await tx.plannedDose.updateMany({
        where: { id: { in: statusUpdates.map((u) => u.id) } },
        data: { status: "missed" },
      });
    }
  });

  return { upserted: upserts.length, markedMissed: statusUpdates.length };
}
