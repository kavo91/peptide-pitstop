import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { getPeptideOptions, getPrescriptionOptions, getSyringeOptions } from "@/lib/options";
import { ProtocolForm } from "@/components/ProtocolForm";
import { cycleSuggestionsFor } from "@/lib/cycle/server";
import { StepsEditor } from "@/components/StepsEditor";
import { dosesPerWeek } from "@/lib/schedule/frequency";
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

  const protocol = await prisma.protocol.findFirst({ where: { id, userId: user.id }, include: { steps: { orderBy: { stepIndex: "asc" } } } });
  if (!protocol) notFound();
  const viewerNow = (await viewerToday()).date;

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
      <ProtocolForm peptides={peptides} prescriptions={prescriptions} syringes={syringes} initial={initial} cycleSuggestions={cycleSuggestions} />

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
