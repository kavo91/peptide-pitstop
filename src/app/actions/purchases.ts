"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { encryptField } from "@/lib/crypto/fieldEncryption";
import { assertPeptideUsable } from "@/lib/auth/ownership";
import { parseNonNegativeDecimal, parseEnum } from "@/lib/validation/domain";
import { ALLOCATION_METHODS, CONSUMABLE_CATEGORIES } from "@/lib/costs-core";

export interface PurchaseItemInput {
  /** Existing PurchaseItem id when editing; blank/absent creates a new line. */
  id?: string;
  kind: "peptide" | "consumable";
  peptideId?: string;
  category?: string;
  description?: string;
  quantity: string;
  unitCost: string;
  unitsPerPack?: string;
  unitsPerDose?: string;
  /** Vial rows this line bought. May be fewer than `quantity`. */
  vialIds?: string[];
}

export interface PurchaseInput {
  id?: string;
  vendor?: string;
  reference?: string;
  orderedAt: string; // yyyy-mm-dd
  receivedAt?: string;
  currency?: string;
  shippingCost?: string;
  taxCost?: string;
  otherFees?: string;
  discount?: string;
  allocationMethod?: string;
  notes?: string;
  items: PurchaseItemInput[];
}

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

/** yyyy-mm-dd → UTC midnight (date-only convention, MIGRATIONS.md rule 3). */
function dateOnly(v: string | undefined | null): Date | null {
  const s = (v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

function positiveInt(v: string | undefined, fallback: number | null = null): number | null {
  const s = (v ?? "").trim();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Create or update one invoice and its lines in a single transaction, then
 * re-point the vials each line bought.
 *
 * Vial matching is the reason this is transactional: linking a vial to a line
 * is a WRITE TO THE VIAL, and a partial failure would leave vials pointing at
 * lines that were rolled back. Vials named by the payload are claimed for the
 * line; vials previously linked to this invoice but no longer named are
 * released back to "uncosted" rather than left silently attached.
 */
export async function savePurchase(input: PurchaseInput) {
  const user = await getCurrentUser();
  if (!user) return fail("Not signed in.");

  const orderedAt = dateOnly(input.orderedAt);
  if (!orderedAt) return fail("Enter the order date.");
  const receivedAt = input.receivedAt?.trim() ? dateOnly(input.receivedAt) : null;
  if (input.receivedAt?.trim() && !receivedAt) return fail("Received date is not a valid date.");
  if (receivedAt && receivedAt < orderedAt) return fail("Received date must be on or after the order date.");

  const items = (input.items ?? []).filter(
    (i) => (i.description ?? "").trim() !== "" || (i.kind === "peptide" && (i.peptideId ?? "").trim() !== ""),
  );
  if (items.length === 0) return fail("Add at least one line to the invoice.");

  const method = parseEnum(input.allocationMethod, ALLOCATION_METHODS) ?? "value";

  // Money fields: blank → 0. A non-blank value that will not parse is an error,
  // never a silent zero — a typo'd shipping cost must not vanish from the total.
  const moneyOr0 = (label: string, v: string | undefined): string | Fail => {
    const s = (v ?? "").trim();
    if (!s) return "0";
    const parsed = parseNonNegativeDecimal(s);
    return parsed ?? fail(`${label} must be a number of 0 or more.`);
  };
  const shippingCost = moneyOr0("Shipping", input.shippingCost);
  if (typeof shippingCost !== "string") return shippingCost;
  const taxCost = moneyOr0("Tax", input.taxCost);
  if (typeof taxCost !== "string") return taxCost;
  const otherFees = moneyOr0("Other fees", input.otherFees);
  if (typeof otherFees !== "string") return otherFees;
  const discount = moneyOr0("Discount", input.discount);
  if (typeof discount !== "string") return discount;

  // Validate every line before writing anything.
  const prepared: {
    id?: string;
    kind: string;
    peptideId: string | null;
    category: string | null;
    description: string;
    quantity: number;
    unitCost: string;
    unitsPerPack: number | null;
    unitsPerDose: string | null;
    sortIndex: number;
    vialIds: string[];
  }[] = [];

  for (const [idx, raw] of items.entries()) {
    const kind = parseEnum(raw.kind, ["peptide", "consumable"] as const);
    if (!kind) return fail("Each line must be a peptide or a consumable.");

    const quantity = positiveInt(raw.quantity);
    if (quantity == null) return fail(`Line ${idx + 1}: quantity must be a whole number of 1 or more.`);

    const unitCost = parseNonNegativeDecimal((raw.unitCost ?? "").trim() || "0");
    if (unitCost == null) return fail(`Line ${idx + 1}: unit cost must be a number of 0 or more.`);

    let peptideId: string | null = null;
    let category: string | null = null;
    if (kind === "peptide") {
      peptideId = (raw.peptideId ?? "").trim() || null;
      if (!peptideId) return fail(`Line ${idx + 1}: choose the peptide this line bought.`);
      try {
        await assertPeptideUsable(user.id, peptideId);
      } catch (e) {
        return fail(e instanceof Error ? e.message : "Invalid peptide.");
      }
    } else {
      category = parseEnum(raw.category, CONSUMABLE_CATEGORIES) ?? "other";
    }

    const unitsPerPack = kind === "consumable" ? positiveInt(raw.unitsPerPack, null) : null;
    if (kind === "consumable" && (raw.unitsPerPack ?? "").trim() && unitsPerPack == null) {
      return fail(`Line ${idx + 1}: units per pack must be a whole number of 1 or more.`);
    }
    let unitsPerDose: string | null = null;
    if (kind === "consumable" && (raw.unitsPerDose ?? "").trim()) {
      unitsPerDose = parseNonNegativeDecimal(raw.unitsPerDose);
      if (unitsPerDose == null) return fail(`Line ${idx + 1}: units per dose must be a number of 0 or more.`);
    }

    const description =
      (raw.description ?? "").trim() ||
      (kind === "peptide" ? "Peptide" : (category ?? "other").replace(/_/g, " "));

    prepared.push({
      id: raw.id?.trim() || undefined,
      kind,
      peptideId,
      category,
      description,
      quantity,
      unitCost,
      unitsPerPack,
      unitsPerDose,
      sortIndex: idx,
      vialIds: [...new Set((raw.vialIds ?? []).map((v) => v.trim()).filter(Boolean))],
    });
  }

  // A vial can only be bought once — reject a payload that names the same vial
  // on two lines rather than letting the last write win.
  const allVialIds = prepared.flatMap((p) => p.vialIds);
  if (new Set(allVialIds).size !== allVialIds.length) {
    return fail("The same vial is matched to more than one line.");
  }

  // Every named vial must be the caller's, must match its line's peptide, and
  // must not already belong to a DIFFERENT invoice.
  if (allVialIds.length > 0) {
    const vials = await prisma.vial.findMany({
      where: { id: { in: allVialIds }, userId: user.id },
      select: { id: true, peptideId: true, purchaseItemId: true, purchaseItem: { select: { purchaseId: true } } },
    });
    const byId = new Map(vials.map((v) => [v.id, v]));
    for (const p of prepared) {
      for (const vid of p.vialIds) {
        const v = byId.get(vid);
        if (!v) return fail("A matched vial was not found.");
        if (p.peptideId && v.peptideId !== p.peptideId) {
          return fail("A matched vial is a different peptide from its invoice line.");
        }
        if (v.purchaseItem && v.purchaseItem.purchaseId !== input.id) {
          return fail("A matched vial is already on another invoice.");
        }
      }
    }
  }

  try {
    const purchaseId = await prisma.$transaction(async (tx) => {
      const header = {
        vendor: input.vendor?.trim() || null,
        reference: encryptField(input.reference?.trim() || null),
        orderedAt,
        receivedAt,
        currency: input.currency?.trim() || "AUD",
        shippingCost,
        taxCost,
        otherFees,
        discount,
        allocationMethod: method,
        notes: encryptField(input.notes?.trim() || null),
      };

      let id: string;
      if (input.id) {
        // Ownership-scoped: updateMany filters by userId, so another user's id is a no-op.
        const { count } = await tx.purchase.updateMany({ where: { id: input.id, userId: user.id }, data: header });
        if (count === 0) throw new Error("NOT_FOUND");
        id = input.id;
      } else {
        const created = await tx.purchase.create({ data: { ...header, userId: user.id } });
        id = created.id;
      }

      const existing = await tx.purchaseItem.findMany({ where: { purchaseId: id }, select: { id: true } });
      const existingIds = new Set(existing.map((e) => e.id));
      const keptIds = new Set<string>();
      const itemIdByIndex: string[] = [];

      for (const p of prepared) {
        const data = {
          kind: p.kind,
          peptideId: p.peptideId,
          category: p.category,
          description: p.description,
          quantity: p.quantity,
          unitCost: p.unitCost,
          unitsPerPack: p.unitsPerPack,
          unitsPerDose: p.unitsPerDose,
          sortIndex: p.sortIndex,
        };
        if (p.id && existingIds.has(p.id)) {
          await tx.purchaseItem.update({ where: { id: p.id }, data });
          keptIds.add(p.id);
          itemIdByIndex.push(p.id);
        } else {
          const created = await tx.purchaseItem.create({ data: { ...data, purchaseId: id } });
          keptIds.add(created.id);
          itemIdByIndex.push(created.id);
        }
      }

      // Lines removed in the editor: release their vials to uncosted, then drop
      // the line. Vials outlive invoices — deleting a line must never delete a vial.
      const removed = [...existingIds].filter((e) => !keptIds.has(e));
      if (removed.length > 0) {
        await tx.vial.updateMany({ where: { purchaseItemId: { in: removed }, userId: user.id }, data: { purchaseItemId: null } });
        await tx.purchaseItem.deleteMany({ where: { id: { in: removed }, purchaseId: id } });
      }

      // Re-point vials. Release everything currently attached to this invoice
      // first, then claim what the payload names — so an unticked vial is
      // genuinely released rather than left behind.
      const liveIds = [...keptIds];
      await tx.vial.updateMany({
        where: { userId: user.id, purchaseItemId: { in: liveIds } },
        data: { purchaseItemId: null },
      });
      for (const [i, p] of prepared.entries()) {
        if (p.vialIds.length === 0) continue;
        await tx.vial.updateMany({
          where: { id: { in: p.vialIds }, userId: user.id },
          data: { purchaseItemId: itemIdByIndex[i] },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "Purchase",
          entityId: id,
          field: input.id ? "update" : "create",
          newValue: `${prepared.length} lines, ${allVialIds.length} vials matched`,
        },
      });

      return id;
    });

    revalidatePath("/costs");
    revalidatePath("/inventory");
    return { ok: true as const, id: purchaseId };
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND") return fail("Invoice not found.");
    console.error("savePurchase failed", e);
    return fail("Could not save the invoice.");
  }
}

/**
 * Delete an invoice. Its lines cascade; the vials those lines bought are
 * released to uncosted and KEPT — a purchase record is bookkeeping, not the
 * vial's existence.
 */
export async function deletePurchase(id: string) {
  const user = await getCurrentUser();
  if (!user) return fail("Not signed in.");

  const purchase = await prisma.purchase.findFirst({
    where: { id, userId: user.id },
    select: { id: true, items: { select: { id: true } } },
  });
  if (!purchase) return fail("Invoice not found.");

  try {
    await prisma.$transaction(async (tx) => {
      const itemIds = purchase.items.map((i) => i.id);
      if (itemIds.length > 0) {
        await tx.vial.updateMany({ where: { purchaseItemId: { in: itemIds }, userId: user.id }, data: { purchaseItemId: null } });
      }
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      await tx.purchase.deleteMany({ where: { id, userId: user.id } });
      await tx.auditLog.create({
        data: { userId: user.id, entityType: "Purchase", entityId: id, field: "delete", newValue: `${itemIds.length} lines released` },
      });
    });
  } catch (e) {
    console.error("deletePurchase failed", e);
    return fail("Could not delete the invoice.");
  }

  revalidatePath("/costs");
  revalidatePath("/inventory");
  return { ok: true as const };
}
