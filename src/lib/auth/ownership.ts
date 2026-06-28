import { prisma } from "@/lib/db";

/**
 * Relationship / ownership guards for server actions.
 *
 * Server actions accept client-supplied related ids (peptideId, prescriptionId,
 * defaultSyringeId, …). Without a check, a caller can POST another user's id and
 * have it persisted on their own row — an IDOR (audit item #2). These guards
 * validate that every related id the action is about to write is either owned by
 * the caller or, where the model allows it, a shared (userId === null) record.
 *
 * Contract: each guard THROWS a plain Error(message) on failure. Server actions
 * wrap their write path in try/catch and map the thrown message to their
 * existing `{ ok: false, error }` shape. If the id arg is null/undefined the
 * guard is a no-op — these cover OPTIONAL foreign keys, so "not provided" is
 * always valid.
 */

/**
 * A peptide is usable by the caller if they own it (`userId === userId`) or it
 * is a shared/global peptide (`userId === null`). Throws otherwise.
 */
export async function assertPeptideUsable(
  userId: string,
  peptideId: string | null | undefined,
): Promise<void> {
  if (peptideId == null) return;
  const peptide = await prisma.peptide.findUnique({
    where: { id: peptideId },
    select: { userId: true },
  });
  if (!peptide || (peptide.userId !== null && peptide.userId !== userId)) {
    throw new Error("Peptide not found.");
  }
}

/**
 * A prescription must be owned by the caller. Prescriptions are never shared
 * (`Prescription.userId` is non-null in the schema). Throws otherwise.
 */
export async function assertPrescriptionOwned(
  userId: string,
  prescriptionId: string | null | undefined,
): Promise<void> {
  if (prescriptionId == null) return;
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    select: { userId: true },
  });
  if (!prescription || prescription.userId !== userId) {
    throw new Error("Prescription not found.");
  }
}

/**
 * A prescription attached to a protocol must be compatible with the peptide that
 * protocol is for. Like the other guards, a null/undefined prescriptionId is a
 * no-op (the FK is optional). The prescription must be owned by the caller, then:
 *   - per-peptide script (`peptideId` set) → must target the SAME `peptideId`;
 *   - grouped stack script (`peptideId` null AND `stackId` set) → only allowed
 *     when `opts.allowStack` (a stack-level save), never on a single peptide.
 * A bare prescription (both null) is left to `assertPrescriptionOwned` semantics
 * and passes here. Throws otherwise.
 */
export async function assertPrescriptionCompatible(
  userId: string,
  prescriptionId: string | null | undefined,
  peptideId: string | null | undefined,
  opts?: { allowStack?: boolean },
): Promise<void> {
  if (prescriptionId == null) return;
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    select: { userId: true, peptideId: true, stackId: true },
  });
  if (!prescription || prescription.userId !== userId) {
    throw new Error("Prescription not found.");
  }
  if (prescription.peptideId !== null) {
    if (prescription.peptideId !== peptideId) {
      throw new Error("Prescription is for a different peptide.");
    }
    return;
  }
  // peptideId null + stackId set → grouped stack script; only valid on a stack save.
  if (prescription.stackId !== null && !opts?.allowStack) {
    throw new Error("That is a stack prescription.");
  }
}

/**
 * A syringe is usable by the caller if they own it (`userId === userId`) or it
 * is a shared/global syringe (`userId === null`). Throws otherwise.
 */
export async function assertSyringeUsable(
  userId: string,
  syringeId: string | null | undefined,
): Promise<void> {
  if (syringeId == null) return;
  const syringe = await prisma.syringe.findUnique({
    where: { id: syringeId },
    select: { userId: true },
  });
  if (!syringe || (syringe.userId !== null && syringe.userId !== userId)) {
    throw new Error("Syringe not found.");
  }
}
