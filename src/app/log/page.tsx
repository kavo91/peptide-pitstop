import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { suggestNextSite } from "@/lib/sites";
import { AdHocLogForm } from "@/components/AdHocLogForm";
import { OralLogForm } from "@/components/OralLogForm";
import { BackButton } from "@/components/BackButton";
import { buildProtocolDoseOptions, type ProtocolForOptions } from "@/lib/log/protocol-options";
import { activeDesign } from "@/lib/design";
import { plannedDayWindow } from "@/lib/planned/match";
import { PitstopHeading } from "@/components/PitstopHeading";
import { PAGE_MAIN } from "@/lib/layout";

export const dynamic = "force-dynamic";

export default async function LogPage() {
  const user = await getCurrentUser();
  const design = activeDesign();
  if (!user) return <main className="mx-auto max-w-md px-4 py-10 lg:max-w-2xl lg:px-8"><p className="text-muted">No data yet — run the seed.</p></main>;

  const preps = await prisma.preparation.findMany({
    where: { active: true, vial: { userId: user.id, status: "in_use" } },
    include: { vial: { include: { peptide: true } } },
    orderBy: { reconstitutedAt: "desc" },
  });

  // Collect unique peptideIds from preps.
  const peptideIds = [...new Set(preps.map((p) => p.vial.peptideId))];

  // Most recent DoseLog for each peptide (any protocol) — for half-life warnings.
  const lastLogs = await prisma.doseLog.findMany({
    where: { userId: user.id, preparation: { vial: { peptideId: { in: peptideIds } } } },
    orderBy: { takenAt: "desc" },
    include: { preparation: { include: { vial: { select: { peptideId: true } } } } },
  });
  // Build a map peptideId → most recent takenAt (findMany already ordered desc, first wins).
  const lastLogByPeptide = new Map<string, Date>();
  for (const log of lastLogs) {
    // Injection logs only (the query filters on preparation); an oral dose has
    // no preparation, so skip it here — this map only feeds injection half-life.
    const pid = log.preparation?.vial.peptideId;
    if (pid && !lastLogByPeptide.has(pid)) lastLogByPeptide.set(pid, log.takenAt);
  }
  const now = new Date();

  const options = preps.map((p) => {
    const lastAt = lastLogByPeptide.get(p.vial.peptideId);
    const hoursSinceLast = lastAt ? (now.getTime() - lastAt.getTime()) / 3_600_000 : null;
    return {
      peptideId: p.vial.peptideId,
      peptideName: p.vial.peptide.name,
      preparation: { id: p.id, concentrationMcgPerMl: p.concentrationMcgPerMl.toString(), remainingMl: p.remainingMl.toString() },
      hoursSinceLast,
      halfLifeHours: p.vial.peptide.halfLifeHours != null ? Number(p.vial.peptide.halfLifeHours.toString()) : null,
      minIntervalHours: p.vial.peptide.minIntervalHours != null ? Number(p.vial.peptide.minIntervalHours.toString()) : null,
    };
  });

  // LRU site suggestion per peptide for the ad-hoc log form.
  const suggestedSiteByPeptide: Record<string, string> = {};
  const recentSitesByPeptide: Record<string, string[]> = {};
  await Promise.all(
    options.map(async (o) => {
      const logs = await prisma.doseLog.findMany({
        where: {
          userId: user.id,
          preparation: { vial: { peptideId: o.peptideId } },
          injectionSite: { not: null },
        },
        orderBy: { takenAt: "desc" },
        take: 10,
        select: { injectionSite: true },
      });
      const raw = logs.map((l) => l.injectionSite!);
      suggestedSiteByPeptide[o.peptideId] = suggestNextSite(raw);
      recentSitesByPeptide[o.peptideId] = raw;
    })
  );

  // Active protocols → Protocol picker options. Each option's dose is resolved
  // through the SAME safe resolver seam Today uses (perInjectionValue / the
  // perInjectionDose fallback) — a per_week weekly value is divided per injection
  // and an unresolved frequency yields a BLANK dose, never a raw weekly total (§6).
  const protocols = await prisma.protocol.findMany({
    where: { userId: user.id, status: "active" },
    include: { peptide: true, steps: true },
  });
  // Each protocol's FULL delivered history — the resolver's phase cursor needs it.
  const protocolLogs = await prisma.doseLog.findMany({
    where: { userId: user.id, protocolId: { in: protocols.map((p) => p.id) } },
    select: { id: true, protocolId: true, takenAt: true },
  });
  // Most recent active prep per peptide (preps already ordered reconstitutedAt desc).
  const activePrepByPeptide = new Map<string, string>();
  for (const p of preps) if (!activePrepByPeptide.has(p.vial.peptideId)) activePrepByPeptide.set(p.vial.peptideId, p.id);

  const protocolForOptions: ProtocolForOptions[] = protocols.map((p) => ({
    id: p.id,
    peptideId: p.peptideId,
    peptideName: p.peptide.name,
    doseBasis: p.doseBasis,
    targetDose: p.targetDose,
    doseInputUnit: p.doseInputUnit,
    scheduleRule: p.scheduleRule,
    rebaseMode: p.rebaseMode,
    startDate: p.startDate,
    endDate: p.endDate,
    adherenceWindowMin: p.adherenceWindowMin,
    steps: p.steps.map((s) => ({
      stepIndex: s.stepIndex,
      dose: s.dose,
      doseInputUnit: s.doseInputUnit,
      durationDays: s.durationDays,
    })),
    deliveredLogs: protocolLogs.filter((l) => l.protocolId === p.id).map((l) => ({ id: l.id, takenAt: l.takenAt })),
    activePreparationId: activePrepByPeptide.get(p.peptideId),
  }));
  const protocolOptions = buildProtocolDoseOptions(protocolForOptions, now);

  const syringes = (await prisma.syringe.findMany({ where: { OR: [{ userId: user.id }, { userId: null }] } })).map((s) => ({
    id: s.id,
    name: s.name,
    graduationType: s.graduationType as "units" | "ml",
    unitsPerMl: s.unitsPerMl,
    capacityMl: s.capacityMl.toString(),
    capacityUnits: s.capacityUnits,
    increment: s.increment.toString(),
  }));

  // Oral peptides are loggable without any vial/prep — they don't appear in the
  // injection `options` (which come from preparations). Surface them separately
  // with the simplified oral form. Each is pre-linked to its single active
  // protocol (if any) so the oral log attributes + links the planned dose.
  const oralPeptides = await prisma.peptide.findMany({
    where: { route: "oral", OR: [{ userId: user.id }, { userId: null }] },
    orderBy: { name: "asc" },
    include: {
      protocols: {
        where: { userId: user.id, status: "active" },
        select: { id: true, doseInputUnit: true, targetDose: true },
      },
    },
  });
  const oralOptions = oralPeptides.map((p) => {
    const proto = p.protocols.length === 1 ? p.protocols[0] : null;
    const unit = (proto?.doseInputUnit === "mg" ? "mg" : "mcg") as "mcg" | "mg";
    return {
      peptideId: p.id,
      peptideName: p.name,
      protocolId: proto?.id,
      initialDoseValue: proto?.targetDose != null ? proto.targetDose.toString() : "",
      initialDoseUnit: unit,
    };
  });

  // Read-only: which oral peptides already have a dose logged TODAY (pitstop
  // "Taken" chip). An oral DoseLog has no preparation and no direct peptideId —
  // its only peptide link is via protocolId. So match today's oral logs to each
  // oralOption by its (single active) protocolId. Oral peptides without an
  // active protocol can't be matched this way and stay on the "Log" chip.
  const loggedTodayPeptideIds = new Set<string>();
  const oralProtocolIds = oralOptions.map((o) => o.protocolId).filter((id): id is string => Boolean(id));
  if (oralProtocolIds.length > 0) {
    const { dayStart, dayEnd } = plannedDayWindow(now);
    const todaysOralLogs = await prisma.doseLog.findMany({
      where: {
        userId: user.id,
        route: "oral",
        protocolId: { in: oralProtocolIds },
        takenAt: { gte: dayStart, lt: dayEnd },
      },
      select: { protocolId: true },
    });
    const loggedProtocolIds = new Set(todaysOralLogs.map((l) => l.protocolId).filter(Boolean));
    for (const o of oralOptions) {
      if (o.protocolId && loggedProtocolIds.has(o.protocolId)) loggedTodayPeptideIds.add(o.peptideId);
    }
  }

  return (
    <main className={PAGE_MAIN}>
      <BackButton fallback="/" />
      <PitstopHeading title="Log a dose" index={3} design={design} className="mb-1 text-3xl font-semibold tracking-tight" split={["LOG", "DOSE"]} />
      {design === "pitstop" ? (
        <p className="mb-6 font-mono uppercase tracking-[0.16em] text-xs text-muted">Record an injection</p>
      ) : (
        <p className="mb-6 text-muted">Record any dose, any time — independent of the schedule.</p>
      )}
      {/* Desktop (≥1440px): ad-hoc form LEFT, oral medications RIGHT in a two-up
          grid. The grid only activates when oral options exist, so the second
          column is never empty. Mobile / smaller laptops stay single column
          (oral section keeps its mt-8 stack spacing). The grid sits above the
          `sm` breakpoint, where the form's sticky mobile CTA is already static,
          so two-up never affects the sticky CTA. */}
      <div className={oralOptions.length > 0 ? "min-[1440px]:grid min-[1440px]:grid-cols-2 min-[1440px]:items-start min-[1440px]:gap-8" : undefined}>
        <AdHocLogForm options={options} syringes={syringes} suggestedSiteByPeptide={suggestedSiteByPeptide} recentSitesByPeptide={recentSitesByPeptide} protocolOptions={protocolOptions} design={design} />

      {oralOptions.length > 0 && (
        <section className="mt-8 min-[1440px]:mt-0">
          <h2 className="mb-3 text-sm font-medium text-muted">Oral medications</h2>
          <ul className="space-y-3">
            {oralOptions.map((o) => (
              <li key={o.peptideId} className="rounded-card bg-surface shadow-sm ring-1 ring-line/10">
                <details>
                  {design === "pitstop" ? (
                    <summary className="flex cursor-pointer items-center justify-between p-4">
                      <span className="uppercase tracking-[0.06em] font-medium">{o.peptideName}</span>
                      {loggedTodayPeptideIds.has(o.peptideId) ? (
                        <span className="rounded-control bg-ok/10 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.08em] text-ok ring-1 ring-ok/40">Taken</span>
                      ) : (
                        <span className="rounded-control bg-accent/10 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.08em] text-accent ring-1 ring-accent/40">Log</span>
                      )}
                    </summary>
                  ) : (
                    <summary className="cursor-pointer p-4 font-medium">{o.peptideName}</summary>
                  )}
                  <div className="border-t border-line/10 p-4">
                    <OralLogForm
                      protocolId={o.protocolId}
                      peptideId={o.peptideId}
                      peptideName={o.peptideName}
                      initialDoseValue={o.initialDoseValue}
                      initialDoseUnit={o.initialDoseUnit}
                    />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>
    </main>
  );
}
