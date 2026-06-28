"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { encryptField } from "@/lib/crypto/fieldEncryption";
import { assertPeptideUsable } from "@/lib/auth/ownership";
import { parseNonNegativeDecimal, parseEnum, parseDateOrder } from "@/lib/validation/domain";

function optInt(v?: string | null): number | null {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function encOrNull(v?: string): string | null {
  const s = (v ?? "").trim();
  return s ? encryptField(s) : null;
}

// The only enumerable prescription field — mirrors the form's status <select>
// and the schema comment (active | expired | cancelled). source + currency are
// genuinely free-text (vendor name / typed ISO code), so they stay un-whitelisted.
const PRESCRIPTION_STATUSES = ["active", "expired", "cancelled"] as const;

export interface PrescriptionInput {
  id?: string;
  peptideId: string;
  source?: string;
  pharmacy?: string; // encrypted
  prescriber?: string; // encrypted
  cost?: string;
  currency?: string;
  quantity?: string;
  refillsAuthorized?: string;
  refillsRemaining?: string;
  dateWritten?: string;
  nextRefill?: string;
  expiration?: string;
  leadTimeDays?: string;
  doseInstructions?: string; // encrypted
  status?: string;
}

export async function savePrescription(input: PrescriptionInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  if (!input.peptideId) return { ok: false as const, error: "Choose a peptide." };

  // Relationship guard: the peptide must be owned (or shared) by the caller.
  try {
    await assertPeptideUsable(user.id, input.peptideId);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Invalid reference." };
  }

  // #8 value/domain hardening. Reject negative money/quantity/refill values
  // (zero is meaningful for every one of these — a free script, no refills left,
  // same-day lead time — so non-negative, not strictly-positive). Blank stays
  // null and any already-valid value persists identically; only out-of-range
  // input is now turned away instead of silently coerced.
  const nonNegativeFields: Array<[string, string | undefined]> = [
    ["Cost", input.cost],
    ["Quantity", input.quantity],
    ["Refills authorized", input.refillsAuthorized],
    ["Refills remaining", input.refillsRemaining],
    ["Reorder lead time", input.leadTimeDays],
  ];
  for (const [label, raw] of nonNegativeFields) {
    if ((raw ?? "").trim() && parseNonNegativeDecimal(raw) === null) {
      return { ok: false as const, error: `${label} must be zero or a positive number.` };
    }
  }

  // Date ordering — only checked when both ends are supplied; a single date or a
  // blank field is valid and left untouched.
  if ((input.dateWritten ?? "").trim() && (input.expiration ?? "").trim()) {
    const order = parseDateOrder(input.dateWritten, input.expiration);
    if (!order.ok) return { ok: false as const, error: order.error };
  }
  if ((input.dateWritten ?? "").trim() && (input.nextRefill ?? "").trim()) {
    const order = parseDateOrder(input.dateWritten, input.nextRefill);
    if (!order.ok) return { ok: false as const, error: order.error };
  }

  // Whitelist status against the form's real options. Blank → the existing
  // "active" default; an unknown value is rejected rather than persisted.
  let status: (typeof PRESCRIPTION_STATUSES)[number] = "active";
  if ((input.status ?? "").trim()) {
    const parsed = parseEnum(input.status, PRESCRIPTION_STATUSES);
    if (parsed === null) return { ok: false as const, error: "Invalid status." };
    status = parsed;
  }

  const data = {
    peptideId: input.peptideId,
    source: input.source?.trim() || null,
    pharmacy: encOrNull(input.pharmacy),
    prescriber: encOrNull(input.prescriber),
    cost: parseNonNegativeDecimal(input.cost),
    currency: input.currency?.trim() || "AUD",
    quantity: optInt(input.quantity),
    refillsAuthorized: optInt(input.refillsAuthorized),
    refillsRemaining: optInt(input.refillsRemaining),
    dateWritten: input.dateWritten ? new Date(input.dateWritten) : null,
    nextRefill: input.nextRefill ? new Date(input.nextRefill) : null,
    expiration: input.expiration ? new Date(input.expiration) : null,
    leadTimeDays: optInt(input.leadTimeDays),
    doseInstructions: encOrNull(input.doseInstructions),
    status,
  };

  try {
    if (input.id) {
      const { count } = await prisma.prescription.updateMany({ where: { id: input.id, userId: user.id }, data });
      if (count === 0) return { ok: false as const, error: "Prescription not found." };
      await prisma.auditLog.create({ data: { userId: user.id, entityType: "Prescription", entityId: input.id, field: "update", newValue: data.status } });
    } else {
      await prisma.prescription.create({ data: { ...data, userId: user.id } });
    }
  } catch (e) {
    console.error("savePrescription failed", e);
    return { ok: false as const, error: "Could not save prescription." };
  }
  revalidatePath("/prescriptions");
  return { ok: true as const };
}

/**
 * Permanently delete a prescription. Its linked inventory and dosing are NOT
 * cascade-deleted — deleting a *script* must never destroy the vials you bought
 * under it or the protocol you dose on. Instead the children are UNLINKED
 * (prescriptionId → null) and survive; only the prescription row is removed.
 *
 * The schema has no onDelete clauses, so the implicit-RESTRICT FKs would throw
 * if a Vial or Protocol still pointed here — hence the null-out happens first,
 * inside the same transaction. Ownership-scoped; audited; no redirect.
 *
 * Cascade order:
 *   (a) Vial.prescriptionId → null      (keep the vials, just unlink)
 *   (b) Protocol.prescriptionId → null  (keep the protocols, just unlink)
 *   (c) delete Prescription (by id + userId)
 *   (d) auditLog (field: "delete")
 */
export async function deletePrescription(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  // Ownership check — only the caller's prescription. Missing → safe no-op.
  const prescription = await prisma.prescription.findFirst({ where: { id, userId: user.id } });
  if (!prescription) return { ok: true as const };

  try {
    await prisma.$transaction(async (tx) => {
      // (a) + (b) Unlink children (do NOT delete them) so the RESTRICT FKs clear.
      await tx.vial.updateMany({ where: { prescriptionId: id, userId: user.id }, data: { prescriptionId: null } });
      await tx.protocol.updateMany({ where: { prescriptionId: id, userId: user.id }, data: { prescriptionId: null } });

      // (c) Delete the prescription itself (ownership-scoped).
      await tx.prescription.deleteMany({ where: { id, userId: user.id } });

      // (d) Audit.
      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "Prescription",
          entityId: id,
          field: "delete",
          oldValue: prescription.status,
          newValue: "deleted: linked vials + protocols unlinked",
        },
      });
    });
  } catch (e) {
    console.error("deletePrescription failed", e);
    return { ok: false as const, error: "Could not delete prescription." };
  }

  revalidatePath("/prescriptions");
  revalidatePath("/inventory");
  revalidatePath("/protocols");
  return { ok: true as const };
}
