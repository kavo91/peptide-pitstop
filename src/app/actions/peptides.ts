"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";

/** Parse an optional finite decimal; empty → null, invalid → null. */
function optDecimal(v?: string | null): string | null {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? s : null;
}

/** Build the prisma Peptide data payload from a PeptideInput (shared by save + add-from-library). */
function buildPeptideData(input: PeptideInput) {
  return {
    name: input.name.trim(),
    aliases: input.aliases?.trim() || null,
    category: input.category?.trim() || null,
    substanceClass: input.substanceClass === "IU" ? "IU" : "mass",
    defaultStrengthMg: optDecimal(input.defaultStrengthMg),
    halfLifeHours: optDecimal(input.halfLifeHours),
    minIntervalHours: optDecimal(input.minIntervalHours),
    missedDosePolicy: ["skip", "take_now", "prompt"].includes(input.missedDosePolicy ?? "")
      ? input.missedDosePolicy!
      : "prompt",
    storageNotes: input.storageNotes?.trim() || null,
    // Administration route. Oral skips reconstitution/syringe/site. Default injection.
    route: input.route === "oral" ? "oral" : "injection",
  };
}

export interface PeptideInput {
  id?: string;
  name: string;
  aliases?: string;
  category?: string;
  substanceClass?: string; // mass | IU
  defaultStrengthMg?: string;
  halfLifeHours?: string;
  minIntervalHours?: string;
  missedDosePolicy?: string; // skip | take_now | prompt
  storageNotes?: string;
  route?: string; // injection | oral
}

export async function savePeptide(input: PeptideInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Name is required." };

  const data = buildPeptideData(input);

  try {
    if (input.id) {
      // Only the user's own peptides are editable (shared/library rows are read-only here).
      const { count } = await prisma.peptide.updateMany({ where: { id: input.id, userId: user.id }, data });
      if (count === 0) return { ok: false as const, error: "Peptide not found." };
    } else {
      await prisma.peptide.create({ data: { ...data, userId: user.id } });
    }
  } catch (e) {
    console.error("savePeptide failed", e);
    return { ok: false as const, error: "Could not save peptide." };
  }
  revalidatePath("/settings");
  revalidatePath("/inventory");
  revalidatePath("/protocols");
  return { ok: true as const };
}

/**
 * Delete a user-owned peptide. BLOCK-IF-REFERENCED: refuses while any vial,
 * protocol, or prescription still references it (those carry the inventory and
 * dosing/medical history — deleting the peptide must not orphan or destroy them).
 * The user deletes those first. Library/shared peptides (userId null) are not
 * deletable here — only the caller's own rows (id + userId scoped).
 */
export async function deletePeptide(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const peptide = await prisma.peptide.findFirst({ where: { id, userId: user.id } });
  if (!peptide) return { ok: false as const, error: "Peptide not found." };

  // Block-if-referenced. DoseLogs reach a peptide only via a vial/preparation or
  // a protocol, so counting vials + protocols + prescriptions covers all history.
  const [vials, protocols, prescriptions] = await Promise.all([
    prisma.vial.count({ where: { peptideId: id, userId: user.id } }),
    prisma.protocol.count({ where: { peptideId: id, userId: user.id } }),
    prisma.prescription.count({ where: { peptideId: id, userId: user.id } }),
  ]);
  if (vials + protocols + prescriptions > 0) {
    const parts: string[] = [];
    if (vials) parts.push(`${vials} vial${vials === 1 ? "" : "s"}`);
    if (protocols) parts.push(`${protocols} protocol${protocols === 1 ? "" : "s"}`);
    if (prescriptions) parts.push(`${prescriptions} prescription${prescriptions === 1 ? "" : "s"}`);
    return { ok: false as const, error: `In use by ${parts.join(", ")} — delete those first.` };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.peptide.deleteMany({ where: { id, userId: user.id } });
      await tx.auditLog.create({
        data: { userId: user.id, entityType: "Peptide", entityId: id, field: "delete", oldValue: peptide.name, newValue: "deleted" },
      });
    });
  } catch (e) {
    console.error("deletePeptide failed", e);
    return { ok: false as const, error: "Could not delete peptide." };
  }
  revalidatePath("/settings");
  revalidatePath("/inventory");
  revalidatePath("/protocols");
  return { ok: true as const };
}

export interface AddPeptideFromLibraryInput {
  name: string;
  aliases?: string;
  category?: string;
  substanceClass?: string;
  halfLifeHours?: string;
  storageNotes?: string;
}

/**
 * One-tap add-from-library. This creates reference data only. Protocols remain
 * an explicit manual/prescriber-recorded workflow; enrichment never seeds dose.
 */
export async function addPeptideFromLibrary(input: AddPeptideFromLibraryInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Name is required." };

  // Reuse the shared peptide data builder (same validation path as savePeptide).
  const data = buildPeptideData({
    name,
    aliases: input.aliases ?? "",
    category: input.category ?? "",
    substanceClass: input.substanceClass,
    halfLifeHours: input.halfLifeHours ?? "",
    storageNotes: input.storageNotes ?? "",
    missedDosePolicy: "prompt",
  });

  let peptideId: string;
  try {
    const created = await prisma.peptide.create({ data: { ...data, userId: user.id } });
    peptideId = created.id;
  } catch (e) {
    console.error("addPeptideFromLibrary: create peptide failed", e);
    return { ok: false as const, error: "Could not save peptide." };
  }

  revalidatePath("/settings");
  revalidatePath("/inventory");
  revalidatePath("/protocols");

  return { ok: true as const, peptideId };
}
