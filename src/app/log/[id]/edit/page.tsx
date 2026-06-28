/**
 * Edit a logged dose in place. Loads the DoseLog (ownership via userId), its
 * preparation + syringe, decrypts notes, derives the originally-entered amount
 * (reverse of canonicaliseDose, from the recorded drawn volume), and renders
 * the prefilled two-stage edit form. Serves both Today and DayDetail entry points.
 */
import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { getCurrentUser } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import type { DoseUnit } from "@/lib/dosing/types";
import { EditDoseForm } from "@/components/EditDoseForm";
import { OralEditDoseForm } from "@/components/OralEditDoseForm";

export const dynamic = "force-dynamic";

/** datetime-local string in the server's local timezone. Mirrors LogDoseForm.toLocalInput. */
function toLocalInput(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Original fill of the prep — clamp cap for vial reconciliation (mirrors doses.ts prepFillMl). */
function prepFillMl(prep: { prepType: string; bacWaterMl: Decimal | null; totalMg: Decimal; concentrationMcgPerMl: Decimal }): Decimal {
  if (prep.prepType === "reconstituted" && prep.bacWaterMl) return new Decimal(prep.bacWaterMl.toString());
  const conc = new Decimal(prep.concentrationMcgPerMl.toString());
  return conc.gt(0) ? new Decimal(prep.totalMg.toString()).times(1000).div(conc) : new Decimal(0);
}

/**
 * Recover the amount the user originally entered, in its input unit, from the
 * recorded drawn volume + concentration (+ syringe units/mL for unit input).
 * This is the inverse of engine.canonicaliseDose, so the field prefills the
 * amount that was logged (not a re-rounded recompute).
 */
function deriveEnteredAmount(args: {
  volumeMl: Decimal;
  concentrationMcgPerMl: Decimal;
  unit: DoseUnit;
  unitsPerMl: number | null;
}): string {
  const { volumeMl, concentrationMcgPerMl: conc, unit, unitsPerMl } = args;
  switch (unit) {
    case "mcg":
      return volumeMl.times(conc).toString();
    case "mg":
      return volumeMl.times(conc).div(1000).toString();
    case "ml":
      return volumeMl.toString();
    case "units":
      return unitsPerMl ? volumeMl.times(unitsPerMl).toString() : volumeMl.toString();
    default:
      return volumeMl.toString();
  }
}

export default async function EditDosePage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const log = await prisma.doseLog.findUnique({
    where: { id: params.id },
    include: { preparation: { include: { vial: { include: { peptide: true } } } }, syringe: true },
  });
  if (!log || log.userId !== user.id) notFound();

  const prep = log.preparation;
  const unit = log.doseInputUnit as DoseUnit;

  // ── ORAL dose (no preparation) ──────────────────────────────────────────────
  // An oral dose stores its mass directly in doseMcg with no volume/syringe. The
  // prefilled amount is the recorded mass in its input unit (mg = mcg/1000).
  if (!prep) {
    const oralAmount = unit === "mg"
      ? new Decimal(log.doseMcg.toString()).div(1000).toString()
      : new Decimal(log.doseMcg.toString()).toString();
    const oralDoseDTO = {
      id: log.id,
      amount: oralAmount,
      doseInputUnit: unit,
      takenAtLocal: toLocalInput(log.takenAt),
      notes: decryptField(log.notes) ?? "",
    };
    return (
      <main className="mx-auto max-w-md px-4 py-8 lg:max-w-2xl lg:px-8">
        <h1 className="mb-6 text-3xl font-semibold tracking-tight">Edit dose</h1>
        <OralEditDoseForm dose={oralDoseDTO} peptideName="oral dose" />
      </main>
    );
  }

  const volumeMl = new Decimal(log.volumeMl.toString());
  const conc = new Decimal(prep.concentrationMcgPerMl.toString());

  const amount = deriveEnteredAmount({
    volumeMl,
    concentrationMcgPerMl: conc,
    unit,
    unitsPerMl: log.syringe ? log.syringe.unitsPerMl : null,
  });

  const doseDTO = {
    id: log.id,
    amount,
    doseInputUnit: unit,
    volumeMl: volumeMl.toString(),
    takenAtLocal: toLocalInput(log.takenAt),
    injectionSite: log.injectionSite ?? "",
    notes: decryptField(log.notes) ?? "",
  };

  const prepDTO = {
    id: prep.id,
    prepType: prep.prepType as "reconstituted" | "premixed",
    concentrationMcgPerMl: conc.toString(),
    remainingMl: prep.remainingMl.toString(),
    fillCapMl: prepFillMl(prep).toString(),
  };

  const syringeDTO = log.syringe
    ? {
        id: log.syringe.id,
        name: log.syringe.name,
        graduationType: log.syringe.graduationType as "units" | "ml",
        unitsPerMl: log.syringe.unitsPerMl,
        capacityMl: log.syringe.capacityMl.toString(),
        capacityUnits: log.syringe.capacityUnits,
        increment: log.syringe.increment.toString(),
      }
    : null;

  return (
    <main className="mx-auto max-w-md px-4 py-8 lg:max-w-2xl lg:px-8">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Edit dose</h1>
      <EditDoseForm dose={doseDTO} prep={prepDTO} syringe={syringeDTO} peptideName={prep.vial.peptide.name} />
    </main>
  );
}
