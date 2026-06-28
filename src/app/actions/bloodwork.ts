"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { encryptField } from "@/lib/crypto/fieldEncryption";
import { ensureBiomarkers } from "@/lib/biomarker-library";
import { classifyFlag } from "@/lib/bloodwork";

export interface LabResultInput {
  biomarkerName: string;
  /** Raw value string — may be "<3", ">90", "5.2", "Positive". Encrypted at rest. */
  value: string;
  unit?: string;
  referenceLow?: string;
  referenceHigh?: string;
}

export interface CreateLabPanelInput {
  /** ISO date (or yyyy-mm-dd) of the blood draw. */
  collectedDate: string;
  labSource?: string;
  /** Free-text notes — encrypted at rest. */
  notes?: string;
  results: LabResultInput[];
}

export interface CreateLabPanelResult {
  ok: boolean;
  labPanelId?: string;
  error?: string;
}

/** Parse a finite decimal to a Prisma-safe string, or null. (Reference bounds may be 0.) */
function refDecimal(v: string | undefined | null): string | null {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  try {
    const d = new Decimal(s);
    return d.isFinite() ? d.toString() : null;
  } catch {
    return null;
  }
}

/** Prisma Decimal | null → number | null, for the pure classifier. */
function decToNum(d: { toString(): string } | null | undefined): number | null {
  if (d == null) return null;
  const n = Number(d.toString());
  return Number.isFinite(n) ? n : null;
}

/**
 * Create a lab panel (one blood draw) and its results. Identity comes from the
 * session. Seeds the shared biomarker catalog, resolves each result's biomarker
 * by name (creating bare rows for any custom names), computes a flag from the
 * biomarker's optimal range + the entered reference interval, encrypts the value
 * and notes, and writes panel + results + audit in one transaction.
 */
export async function createLabPanel(input: CreateLabPanelInput): Promise<CreateLabPanelResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const rawResults = (input.results ?? []).filter(
    (r) => r.biomarkerName?.trim() && r.value?.trim(),
  );
  if (rawResults.length === 0) return { ok: false, error: "Add at least one result." };

  const collectedDate = new Date(input.collectedDate);
  if (Number.isNaN(collectedDate.getTime())) return { ok: false, error: "Invalid collection date." };

  // Seed/refresh the shared biomarker catalog (idempotent), then resolve names.
  await ensureBiomarkers(prisma);

  const names = [...new Set(rawResults.map((r) => r.biomarkerName.trim()))];
  const found = await prisma.biomarker.findMany({ where: { name: { in: names } } });
  const byName = new Map(found.map((b) => [b.name, b]));

  // Any name not in the catalog is a user-entered custom biomarker — create it.
  for (const name of names) {
    if (!byName.has(name)) {
      const created = await prisma.biomarker.upsert({ where: { name }, create: { name }, update: {} });
      byName.set(name, created);
    }
  }

  const resultRows = rawResults.map((r) => {
    const bm = byName.get(r.biomarkerName.trim())!;
    const referenceLow = refDecimal(r.referenceLow);
    const referenceHigh = refDecimal(r.referenceHigh);
    const flag = classifyFlag(
      r.value.trim(),
      referenceLow == null ? null : Number(referenceLow),
      referenceHigh == null ? null : Number(referenceHigh),
      decToNum(bm.optimalLow),
      decToNum(bm.optimalHigh),
    );
    return {
      biomarkerId: bm.id,
      value: encryptField(r.value.trim())!,
      unit: r.unit?.trim() || bm.defaultUnit || null,
      referenceLow,
      referenceHigh,
      flag,
    };
  });

  try {
    const panel = await prisma.$transaction(async (tx) => {
      const created = await tx.labPanel.create({
        data: {
          userId: user.id,
          collectedDate,
          labSource: input.labSource?.trim() || null,
          notes: input.notes?.trim() ? encryptField(input.notes.trim()) : null,
          results: { create: resultRows },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "LabPanel",
          entityId: created.id,
          field: "create",
          newValue: `${resultRows.length} result(s) @ ${collectedDate.toISOString()}`,
        },
      });

      return created;
    });

    revalidatePath("/bloodwork");
    return { ok: true, labPanelId: panel.id };
  } catch (e) {
    console.error("createLabPanel failed", e);
    return { ok: false, error: "Could not save the lab panel. Please try again." };
  }
}

/** Delete a lab panel and its results. Identity from the session; transactional; audited. */
export async function deleteLabPanel(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const panel = await prisma.labPanel.findUnique({ where: { id } });
  if (!panel) return { ok: true };
  if (panel.userId !== user.id) return { ok: false, error: "Not your lab panel." };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.labResult.deleteMany({ where: { labPanelId: id } });
      await tx.labPanel.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "LabPanel",
          entityId: id,
          field: "delete",
          oldValue: `collected ${panel.collectedDate.toISOString()}`,
        },
      });
    });
  } catch (e) {
    console.error("deleteLabPanel failed", e);
    return { ok: false, error: "Could not delete the lab panel." };
  }

  revalidatePath("/bloodwork");
  return { ok: true };
}
