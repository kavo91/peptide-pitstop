"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { encryptField } from "@/lib/crypto/fieldEncryption";
import {
  assertPeptideUsable,
  assertPrescriptionOwned,
  assertPrescriptionCompatible,
} from "@/lib/auth/ownership";
import { parsePositiveDecimal, parseEnum } from "@/lib/validation/domain";

export interface VialInput {
  id?: string;
  peptideId: string;
  labelStrengthMg: string;
  prescriptionId?: string;
  lot?: string;
  expiry?: string; // yyyy-mm-dd
  storageLocation?: string;
  status?: string;
}

export async function saveVial(input: VialInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  if (!input.peptideId) return { ok: false as const, error: "Choose a peptide." };
  const strength = parsePositiveDecimal(input.labelStrengthMg);
  if (!strength) return { ok: false as const, error: "Enter the vial strength in mg." };

  // Relationship guards: client-supplied related ids must be owned (or shared,
  // where allowed) by the caller before we persist them.
  try {
    await assertPeptideUsable(user.id, input.peptideId);
    await assertPrescriptionOwned(user.id, input.prescriptionId || null);
    await assertPrescriptionCompatible(user.id, input.prescriptionId || null, input.peptideId, { allowStack: false });
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Invalid reference." };
  }

  const data = {
    peptideId: input.peptideId,
    labelStrengthMg: strength,
    prescriptionId: input.prescriptionId || null,
    lot: input.lot?.trim() || null,
    expiry: input.expiry ? new Date(input.expiry) : null,
    storageLocation: input.storageLocation?.trim() || null,
    status: parseEnum(input.status, ["sealed", "in_use", "finished", "discarded"] as const) ?? "sealed",
  };

  try {
    if (input.id) {
      // Ownership-scoped: updateMany filters by userId, so another user's id is a no-op.
      const { count } = await prisma.vial.updateMany({ where: { id: input.id, userId: user.id }, data });
      if (count === 0) return { ok: false as const, error: "Vial not found." };
      await prisma.auditLog.create({ data: { userId: user.id, entityType: "Vial", entityId: input.id, field: "update", newValue: data.status } });
    } else {
      await prisma.vial.create({ data: { ...data, userId: user.id } });
    }
  } catch (e) {
    console.error("saveVial failed", e);
    return { ok: false as const, error: "Could not save vial." };
  }
  revalidatePath("/inventory");
  revalidatePath("/");
  return { ok: true as const };
}

export interface LinkVialPrescriptionInput {
  vialId: string;
  /** Link to an existing prescription. Empty string / undefined unlinks (unless `create` is set). */
  prescriptionId?: string;
  /** Create a new prescription for the vial's peptide, then link it. */
  create?: {
    source?: string;
    prescriber?: string;
    pharmacy?: string;
    doseInstructions?: string;
  };
}

/**
 * Attach a vial to a prescription — either an existing one, or a new one created
 * on the spot for the vial's own peptide (removes the "no prescription exists
 * yet" chicken-and-egg when recording a stack's compounding-pharmacy script).
 * Passing neither prescriptionId nor create unlinks the vial.
 */
export async function linkVialPrescription(input: LinkVialPrescriptionInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const vial = await prisma.vial.findFirst({ where: { id: input.vialId, userId: user.id } });
  if (!vial) return { ok: false as const, error: "Vial not found." };

  let prescriptionId: string | null = input.prescriptionId?.trim() || null;

  if (input.create) {
    const c = input.create;
    const created = await prisma.prescription.create({
      data: {
        userId: user.id,
        peptideId: vial.peptideId,
        source: c.source?.trim() || null,
        prescriber: encryptField(c.prescriber?.trim() || null),
        pharmacy: encryptField(c.pharmacy?.trim() || null),
        doseInstructions: encryptField(c.doseInstructions?.trim() || null),
        currency: "AUD",
        status: "active",
      },
    });
    prescriptionId = created.id;
  } else if (prescriptionId) {
    // Verify the chosen prescription belongs to the user (ownership scope).
    const presc = await prisma.prescription.findFirst({ where: { id: prescriptionId, userId: user.id } });
    if (!presc) return { ok: false as const, error: "Prescription not found." };
  }

  // The linked prescription must be compatible with the vial's peptide — a
  // per-peptide script must match, while a stack-grouped script is allowed here
  // (linking attaches a stack's compounding-pharmacy script to its member vials).
  try {
    await assertPrescriptionCompatible(user.id, prescriptionId, vial.peptideId, { allowStack: true });
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Invalid reference." };
  }

  try {
    const { count } = await prisma.vial.updateMany({ where: { id: input.vialId, userId: user.id }, data: { prescriptionId } });
    if (count === 0) return { ok: false as const, error: "Vial not found." };
  } catch (e) {
    console.error("linkVialPrescription failed", e);
    return { ok: false as const, error: "Could not link the prescription." };
  }
  revalidatePath("/inventory");
  revalidatePath("/prescriptions");
  return { ok: true as const, prescriptionId };
}

export async function retireVial(id: string, status: "finished" | "discarded") {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  try {
    const ok = await prisma.$transaction(async (tx) => {
      const { count } = await tx.vial.updateMany({ where: { id, userId: user.id }, data: { status, finishedAt: new Date() } });
      if (count === 0) return false;
      // Clear any protocol pin to this vial so a retired vial doesn't leave a
      // dangling pin; resolution then falls back to the peptide.
      await tx.protocol.updateMany({ where: { vialId: id, userId: user.id }, data: { vialId: null } });
      await tx.auditLog.create({ data: { userId: user.id, entityType: "Vial", entityId: id, field: "status", newValue: status } });
      return true;
    });
    if (!ok) return { ok: false as const, error: "Vial not found." };
  } catch (e) {
    console.error("retireVial failed", e);
    return { ok: false as const, error: "Could not retire vial." };
  }
  revalidatePath("/inventory");
  revalidatePath("/");
  revalidatePath("/protocols");
  return { ok: true as const };
}

/**
 * Permanently delete a vial and its cascade — preparations and the dose logs
 * recorded against them. Ownership-scoped at every level (never touches another
 * user's rows) and transactional: children are deleted before parents so the
 * FK constraints stay satisfied if any step fails. Audited.
 */
export async function deleteVial(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  // Ownership check — only the caller's vial, with its preparation ids.
  const vial = await prisma.vial.findFirst({
    where: { id, userId: user.id },
    include: { preparations: { select: { id: true } } },
  });
  if (!vial) return { ok: false as const, error: "Vial not found." };

  const prepIds = vial.preparations.map((p) => p.id);
  const doseCount = prepIds.length
    ? await prisma.doseLog.count({ where: { userId: user.id, preparationId: { in: prepIds } } })
    : 0;

  try {
    await prisma.$transaction(async (tx) => {
      // Children first to satisfy FK constraints: dose logs → preparations → vial.
      if (prepIds.length) {
        const logs = await tx.doseLog.findMany({ where: { userId: user.id, preparationId: { in: prepIds } }, select: { id: true } });
        const logIds = logs.map((l) => l.id);
        if (logIds.length) {
          // JournalEntry.doseLogId is a bare String (no FK) — null any back-reference
          // first so a journal entry doesn't dangle to a deleted dose's edit link.
          await tx.journalEntry.updateMany({ where: { userId: user.id, doseLogId: { in: logIds } }, data: { doseLogId: null } });
          await tx.doseLog.deleteMany({ where: { id: { in: logIds } } });
        }
        await tx.preparation.deleteMany({ where: { vialId: id } });
      }
      // Clear any protocol pin to this vial first so a deleted vial doesn't leave
      // a dangling pin; resolution then falls back to the peptide.
      await tx.protocol.updateMany({ where: { vialId: id, userId: user.id }, data: { vialId: null } });
      await tx.vial.deleteMany({ where: { id, userId: user.id } });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "Vial",
          entityId: id,
          field: "delete",
          newValue: `deleted: ${doseCount} doses, ${prepIds.length} preps`,
        },
      });
    });
  } catch (e) {
    console.error("deleteVial failed", e);
    return { ok: false as const, error: "Could not delete vial." };
  }

  revalidatePath("/inventory");
  revalidatePath("/");
  revalidatePath("/protocols");
  return { ok: true as const, deletedDoses: doseCount, deletedPreps: prepIds.length };
}
