"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { computeConcentrationMcgPerMl } from "@/lib/dosing/engine";
import { encryptField } from "@/lib/crypto/fieldEncryption";
import { recomputeReconEdit } from "@/lib/dosing/recompute";

export interface CreatePreparationInput {
  vialId: string;
  prepType: "reconstituted" | "premixed";
  /** Required for reconstituted: dry powder mass in the vial (mg). */
  totalMg?: string;
  /** Required for reconstituted: BAC water added (mL). */
  bacWaterMl?: string;
  /** Required for premixed: concentration in mcg/mL (the form collects mg/mL and converts ×1000). */
  concentrationMcgPerMl?: string;
  /** Required for premixed: ready-to-use volume in the vial (mL). */
  vialVolumeMl?: string;
  beyondUseDateISO?: string;
}

/** Parse a strictly-positive decimal, or return null. */
function posDecimal(v: string | undefined | null): Decimal | null {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  try {
    const d = new Decimal(s);
    return d.isFinite() && d.gt(0) ? d : null;
  } catch {
    return null;
  }
}

export async function createPreparation(input: CreatePreparationInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };
  // The vial must belong to the caller.
  const owns = await prisma.vial.count({ where: { id: input.vialId, userId: user.id } });
  if (!owns) return { ok: false, error: "Vial not found." };

  let concentration: Decimal;
  let remainingMl: Decimal;
  let totalMg: Decimal;

  if (input.prepType === "reconstituted") {
    // Dry vial: user enters the powder mass (mg) and the BAC water (mL).
    const mg = posDecimal(input.totalMg);
    if (!mg) return { ok: false, error: "Enter the vial strength in mg." };
    const bac = posDecimal(input.bacWaterMl);
    if (!bac) return { ok: false, error: "Enter the BAC water volume in mL." };
    concentration = computeConcentrationMcgPerMl({ totalMassMg: mg.toString(), bacWaterMl: bac.toString() });
    remainingMl = bac;
    totalMg = mg;
  } else {
    // Premixed liquid: user enters what's on the label — volume (mL) and
    // concentration (mcg/mL). Total mass is derived for the snapshot.
    concentration = posDecimal(input.concentrationMcgPerMl) ?? new Decimal(0);
    if (concentration.lte(0)) return { ok: false, error: "Enter the concentration in mg/mL." };
    const volume = posDecimal(input.vialVolumeMl);
    if (!volume) return { ok: false, error: "Enter the volume in the vial in mL." };
    remainingMl = volume;
    totalMg = volume.times(concentration).div(1000); // mcg → mg
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.preparation.updateMany({ where: { vialId: input.vialId, active: true }, data: { active: false } });
      await tx.preparation.create({
        data: {
          vialId: input.vialId,
          prepType: input.prepType,
          bacWaterMl: input.prepType === "reconstituted" ? input.bacWaterMl : null,
          totalMg: totalMg.toString(),
          concentrationMcgPerMl: concentration.toString(),
          remainingMl: remainingMl.toString(),
          beyondUseDate: input.beyondUseDateISO ? new Date(input.beyondUseDateISO) : null,
          active: true,
        },
      });
      await tx.vial.update({ where: { id: input.vialId }, data: { status: "in_use", openedAt: new Date() } });
    });
  } catch (e) {
    console.error("createPreparation failed", e);
    return { ok: false, error: "Could not save the preparation. Please try again." };
  }

  revalidatePath("/");
  revalidatePath("/log");
  revalidatePath("/inventory");
  return { ok: true, concentrationMcgPerMl: concentration.toString() };
}

export interface EditPreparationInput {
  prepId: string;
  prepType: "reconstituted" | "premixed";
  totalMg?: string;          // reconstituted
  bacWaterMl?: string;       // reconstituted
  concentrationMcgPerMl?: string; // premixed
  vialVolumeMl?: string;     // premixed
  beyondUseDateISO?: string | null;
  notes?: string | null;     // plaintext; encrypted on write
}

export async function editPreparation(input: EditPreparationInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  // Ownership via vial → user.
  const prep = await prisma.preparation.findFirst({
    where: { id: input.prepId, vial: { userId: user.id } },
    include: { doseLogs: { select: { id: true, volumeMl: true } } },
  });
  if (!prep) return { ok: false as const, error: "Preparation not found." };

  let concentration: Decimal;
  let newTotalMl: Decimal;
  let totalMg: Decimal;
  let bacWaterMl: string | null;

  if (input.prepType === "reconstituted") {
    const mg = posDecimal(input.totalMg);
    if (!mg) return { ok: false as const, error: "Enter the vial strength in mg." };
    const bac = posDecimal(input.bacWaterMl);
    if (!bac) return { ok: false as const, error: "Enter the BAC water volume in mL." };
    concentration = computeConcentrationMcgPerMl({ totalMassMg: mg.toString(), bacWaterMl: bac.toString() });
    newTotalMl = bac; totalMg = mg; bacWaterMl = bac.toString();
  } else {
    const conc = posDecimal(input.concentrationMcgPerMl);
    if (!conc) return { ok: false as const, error: "Enter the concentration in mg/mL." };
    const vol = posDecimal(input.vialVolumeMl);
    if (!vol) return { ok: false as const, error: "Enter the volume in the vial in mL." };
    concentration = conc; newTotalMl = vol; totalMg = vol.times(conc).div(1000); bacWaterMl = null;
  }

  const recompute = recomputeReconEdit({
    newConcentrationMcgPerMl: concentration.toString(),
    newTotalMl: newTotalMl.toString(),
    doses: prep.doseLogs.map((d) => ({ id: d.id, volumeMl: d.volumeMl.toString() })),
  });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.preparation.update({
        where: { id: prep.id },
        data: {
          prepType: input.prepType,
          bacWaterMl,
          totalMg: totalMg.toString(),
          concentrationMcgPerMl: concentration.toString(),
          remainingMl: recompute.remainingMl,
          beyondUseDate: input.beyondUseDateISO ? new Date(input.beyondUseDateISO) : null,
          notes: input.notes ? encryptField(input.notes) : null,
        },
      });
      for (const d of recompute.doses) {
        await tx.doseLog.update({ where: { id: d.id }, data: { doseMcg: d.doseMcg } });
      }
      await tx.auditLog.create({
        data: {
          userId: user.id, entityType: "Preparation", entityId: prep.id, field: "edit",
          oldValue: `conc ${prep.concentrationMcgPerMl.toString()} mcg/mL; remaining ${prep.remainingMl.toString()} mL`,
          newValue: `conc ${concentration.toString()} mcg/mL; remaining ${recompute.remainingMl} mL; ${recompute.doses.length} doses recomputed`,
        },
      });
    });
  } catch (e) {
    console.error("editPreparation failed", e);
    return { ok: false as const, error: "Could not save the edit." };
  }

  revalidatePath("/"); revalidatePath("/inventory"); revalidatePath("/analytics"); revalidatePath("/doses");
  return { ok: true as const, concentrationMcgPerMl: concentration.toString(), remainingMl: recompute.remainingMl, recomputedDoses: recompute.doses.length, clamped: recompute.remainingClamped };
}
