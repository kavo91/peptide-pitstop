import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { getPeptideOptions, getPrescriptionOptions, getSyringeOptions } from "@/lib/options";
import { ProtocolForm } from "@/components/ProtocolForm";
import { cycleSuggestionsFor } from "@/lib/cycle/server";
import { StepsEditor } from "@/components/StepsEditor";
import { BlendStepBreakdown } from "@/components/BlendStepBreakdown";
import { buildBlendStepBreakdown } from "@/lib/blend-step-breakdown";
import { componentsForPeptide } from "@/lib/blends";
import { dosesPerWeek } from "@/lib/schedule/frequency";
import { planCarryForward, daysSpentInPhase } from "@/lib/protocol-revision";
import { viewerToday } from "@/lib/viewer-tz";
import { type DoseUnit } from "@/lib/dosing/types";

export const dynamic = "force-dynamic";

function toDateInput(d: Date | null): string | undefined {
  return d ? new Date(d).toISOString().slice(0, 10) : undefined;
}

export default async function EditProtocolPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;

  const protocol = await prisma.protocol.findFirst({ where: { id, userId: user.id }, include: { steps: { orderBy: { stepIndex: "asc" } }, peptide: { select: { name: true } } } });
  if (!protocol) notFound();
  const viewer = await viewerToday();
  const viewerNow = viewer.date;

  const peptides = await getPeptideOptions(user.id);
  const prescriptions = await getPrescriptionOptions(user.id);
  const syringes = await getSyringeOptions(user.id);
  const cycleSuggestions = await cycleSuggestionsFor(peptides);

  const initial = {
    id: protocol.id,
    peptideId: protocol.peptideId,
    prescriptionId: protocol.prescriptionId ?? undefined,
    name: protocol.name,
    source: protocol.source,
    scheduleType: protocol.scheduleType,
    scheduleRule: protocol.scheduleRule ?? undefined,
    rebaseMode: protocol.rebaseMode,
    adherenceWindowMin: String(protocol.adherenceWindowMin),
    defaultSyringeId: protocol.defaultSyringeId ?? undefined,
    targetDose: protocol.targetDose?.toString() ?? undefined,
    doseInputUnit: protocol.doseInputUnit,
    doseBasis: protocol.doseBasis,
    startDate: toDateInput(protocol.startDate),
    endDate: toDateInput(protocol.endDate),
    status: protocol.status,
    cycleOnWeeks: protocol.cycleOnWeeks?.toString() ?? undefined,
    cycleOffWeeks: protocol.cycleOffWeeks?.toString() ?? undefined,
    cycleAnchor: toDateInput(protocol.cycleAnchor),
  };

  // ── Protocol revision ──────────────────────────────────────────────────────
  // What the form needs to detect a re-timing edit and offer a replacement
  // protocol instead of mutating this one.
  const deliveredRows = await prisma.doseLog.findMany({
    where: { userId: user.id, protocolId: protocol.id },
    orderBy: { takenAt: "asc" },
    select: { takenAt: true, localDay: true },
  });
  // Tracking-day keys, ascending — a dose's frozen localDay wins; legacy rows
  // fall back to the UTC date of takenAt.
  const deliveredDayKeys = deliveredRows.map(
    (d) => d.localDay ?? new Date(d.takenAt).toISOString().slice(0, 10),
  );
  const carrySteps0 = protocol.steps.map((s) => ({
    stepIndex: s.stepIndex,
    dose: s.dose.toString(),
    doseInputUnit: s.doseInputUnit,
    durationDays: s.durationDays,
  }));
  // HAZARD: this must be the STORED schedule rule — the OLD frequency. Handing
  // it the edited one walks the user backwards (or skips a ramp step), which is
  // the exact corruption this whole feature exists to prevent. Pinned by
  // "makes the call-site hazard EXECUTABLE" in lib/protocol-revision.test.ts.
  const ipw = dosesPerWeek(protocol.scheduleRule);
  const spent = daysSpentInPhase({
    steps: carrySteps0,
    injectionsPerWeek: ipw,
    deliveredDayKeys,
    // The VIEWER's tracking day, matching the basis of localDay above — a UTC
    // slice would under-count the days served by one for most of a Brisbane day.
    todayKey: viewer.key,
  });
  const carrySteps = planCarryForward({
    steps: carrySteps0,
    injectionsPerWeek: ipw,
    deliveredCount: deliveredDayKeys.length,
    daysSpentInCurrentPhase: spent,
  });
  const savedSnapshot = {
    scheduleRule: protocol.scheduleRule,
    doseBasis: protocol.doseBasis,
    startDate: protocol.startDate ? new Date(protocol.startDate).toISOString().slice(0, 10) : null,
    steps: protocol.steps.map((s) => ({ stepIndex: s.stepIndex, durationDays: s.durationDays })),
  };
  // Offer the revision on EXACTLY the protocols the server would refuse an
  // in-place edit on (assertNoScheduleRewrite: active + has delivered doses),
  // and no others. Wider would be a dead end — the form has no "edit anyway"
  // door, and reviseProtocol itself rejects a non-active protocol — while a
  // protocol with no logged doses has no ladder position to corrupt, so its
  // schedule edit is an ordinary save.
  const revisable = protocol.status === "active" && deliveredDayKeys.length > 0;

  const steps = protocol.steps.map((s) => ({
    id: s.id,
    stepIndex: s.stepIndex,
    dose: s.dose.toString(),
    doseInputUnit: s.doseInputUnit,
    durationDays: s.durationDays?.toString() ?? "",
    notes: s.notes ?? "",
  }));

  return (
    <main className="mx-auto max-w-md px-4 py-8 lg:max-w-2xl lg:px-8">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Edit protocol</h1>
      <ProtocolForm
        peptides={peptides}
        prescriptions={prescriptions}
        syringes={syringes}
        initial={initial}
        cycleSuggestions={cycleSuggestions}
        savedSnapshot={revisable ? savedSnapshot : undefined}
        carryForward={
          revisable
            ? {
                steps: carrySteps,
                resumedDose: carrySteps[0] ? `${carrySteps[0].dose} ${carrySteps[0].doseInputUnit}` : null,
              }
            : undefined
        }
      />

      {/* Clinician view for blend peptides: how each component's mass moves
          across the ladder (derived from the stored vendor ratio). */}
      {await (async () => {
        const comps = await componentsForPeptide(protocol.peptideId);
        // Active prep concentration lets an ml-stepped ladder split too;
        // absent prep → those cells stay an honest em-dash.
        const activePrep = comps.length
          ? await prisma.preparation.findFirst({
              where: { active: true, vial: { peptideId: protocol.peptideId, userId: user.id } },
              orderBy: { reconstitutedAt: "desc" },
              select: { concentrationMcgPerMl: true },
            })
          : null;
        const data = buildBlendStepBreakdown({
          steps: protocol.steps.map((st) => ({ stepIndex: st.stepIndex, dose: st.dose.toString(), doseInputUnit: st.doseInputUnit, durationDays: st.durationDays })),
          components: comps,
          doseBasis: protocol.doseBasis,
          injectionsPerWeek: dosesPerWeek(protocol.scheduleRule),
          concentrationMcgPerMl: activePrep?.concentrationMcgPerMl?.toString() ?? null,
        });
        return data ? (
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-medium text-muted">Blend components across the ladder</h2>
            <BlendStepBreakdown data={data} peptideName={protocol.peptide.name} />
          </section>
        ) : null;
      })()}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-muted">Titration steps</h2>
        <StepsEditor
          protocolId={protocol.id}
          steps={steps}
          doseBasis={protocol.doseBasis}
          doseInputUnit={protocol.doseInputUnit as DoseUnit}
          injectionsPerWeek={dosesPerWeek(protocol.scheduleRule)}
          startDate={protocol.startDate ? new Date(protocol.startDate).toISOString() : null}
          nowWeek={
            // Viewer-day anchored (v1.4.2) so the highlighted current step
            // matches /today across the server-midnight boundary.
            protocol.startDate
              ? (viewerNow.getTime() - new Date(protocol.startDate).getTime()) / (7 * 86_400_000)
              : null
          }
        />
      </section>
    </main>
  );
}
