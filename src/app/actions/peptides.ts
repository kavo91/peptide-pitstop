"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { getEnrichmentSeed } from "@/lib/peptide-enrichment";
import { effectiveTemplates } from "@/lib/enrichment/suggested-protocol";
import { protocolTemplateToInput, templateToRampSteps } from "@/lib/protocol-template";
import { generateRamp } from "@/lib/titration/generate-ramp";
import { saveProtocol, addProtocolSteps } from "./protocols";

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
  /** When true, also create the suggested protocol (and its ramp, if any). */
  withProtocol?: boolean;
  /** Which effectiveTemplate to apply (default 0). */
  templateIndex?: number;
}

/**
 * One-tap add-from-library. Always creates the peptide. When `withProtocol` is
 * set and the matching enrichment has an applicable (effective) template, also
 * creates the suggested protocol — and its titration steps if the template has a
 * usable ramp.
 *
 * The protocol step is best-effort: a failure there NEVER loses the created
 * peptide. We return `{ ok, peptideId, protocolId?, protocolError? }` so the
 * caller can surface a partial result. Guard: if the peptide already has a
 * protocol (one-protocol-per-peptide), protocol creation is skipped.
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

  if (!input.withProtocol) {
    return { ok: true as const, peptideId };
  }

  // Best-effort suggested-protocol creation. Any failure leaves the peptide
  // intact and is reported via protocolError (never thrown).
  try {
    const entry = getEnrichmentSeed(name, input.aliases);
    const templates = entry ? effectiveTemplates(entry) : [];
    const ti = input.templateIndex ?? 0;
    const tmpl = ti >= 0 && ti < templates.length ? templates[ti] : undefined;
    if (!tmpl) {
      return { ok: true as const, peptideId, protocolError: "No suggested protocol is available for this peptide." };
    }

    // Defensive: skip if a protocol already exists (one-protocol-per-peptide).
    const existing = await prisma.protocol.count({ where: { userId: user.id, peptideId } });
    if (existing > 0) {
      return { ok: true as const, peptideId, protocolError: "That peptide already has a protocol." };
    }

    const protoRes = await saveProtocol(protocolTemplateToInput(tmpl, peptideId));
    if (!protoRes.ok || !protoRes.id) {
      return { ok: true as const, peptideId, protocolError: protoRes.ok ? "Could not create the suggested protocol." : protoRes.error };
    }
    const protocolId = protoRes.id;

    // If the template carries a usable ramp, generate + add the titration steps
    // via the same path the app uses elsewhere.
    const rampParams = templateToRampSteps(tmpl);
    if (rampParams) {
      const steps = generateRamp(rampParams).map((s) => ({
        dose: s.dose,
        doseInputUnit: s.doseInputUnit,
        durationDays: s.durationDays != null ? String(s.durationDays) : undefined,
      }));
      const stepRes = await addProtocolSteps({ protocolId, steps });
      if (!stepRes.ok) {
        return { ok: true as const, peptideId, protocolId, protocolError: stepRes.error };
      }
    }

    return { ok: true as const, peptideId, protocolId };
  } catch (e) {
    console.error("addPeptideFromLibrary: protocol step failed", e);
    return { ok: true as const, peptideId, protocolError: "Could not create the suggested protocol." };
  }
}
