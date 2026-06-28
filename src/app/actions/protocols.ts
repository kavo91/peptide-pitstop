"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { assertPeptideUsable, assertPrescriptionCompatible, assertPrescriptionOwned, assertSyringeUsable } from "@/lib/auth/ownership";
import { normaliseScheduleRule } from "@/lib/schedule/normalise";
import { parsePositiveDecimal, parseDateOrder } from "@/lib/validation/domain";

function optDecimal(v?: string | null): string | null {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? s : null;
}
function optInt(v?: string | null): number | null {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export interface ProtocolInput {
  id?: string;
  peptideId: string;
  prescriptionId?: string;
  name: string;
  source?: string;
  scheduleType?: string;
  scheduleRule?: string;
  rebaseMode?: string;
  adherenceWindowMin?: string;
  defaultSyringeId?: string;
  targetDose?: string;
  doseInputUnit?: string;
  doseBasis?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}

export async function saveProtocol(input: ProtocolInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  if (!input.peptideId) return { ok: false as const, error: "Choose a peptide." };
  if (!input.name.trim()) return { ok: false as const, error: "Name is required." };

  // Relationship guards: every client-supplied related id must be owned (or
  // shared, where allowed) by the caller before we persist it.
  try {
    await assertPeptideUsable(user.id, input.peptideId);
    await assertPrescriptionOwned(user.id, input.prescriptionId || null);
    await assertSyringeUsable(user.id, input.defaultSyringeId || null);
    // The attached prescription (if any) must be for THIS peptide — never a
    // different peptide's or a stack-level script — on a single protocol save.
    await assertPrescriptionCompatible(user.id, input.prescriptionId || null, input.peptideId, { allowStack: false });
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Invalid reference." };
  }

  // One protocol per peptide. (On edit, exclude this protocol from the check.)
  const dup = await prisma.protocol.count({
    where: { userId: user.id, peptideId: input.peptideId, ...(input.id ? { id: { not: input.id } } : {}) },
  });
  if (dup > 0) return { ok: false as const, error: "That peptide already has a protocol — edit it instead." };

  // Schedule rule is optional; when provided, normalise (validate + canonicalise)
  // it and reject never-due / malformed rules before persisting. Empty → null.
  let scheduleRule: string | null = null;
  if (input.scheduleRule?.trim()) {
    const norm = normaliseScheduleRule(input.scheduleRule, input.startDate);
    if (!norm.ok) return { ok: false as const, error: norm.error };
    scheduleRule = norm.rule;
  }

  // Target dose is optional; when provided it must be strictly positive.
  let targetDose: string | null = null;
  if (input.targetDose?.trim()) {
    targetDose = parsePositiveDecimal(input.targetDose);
    if (targetDose === null) return { ok: false as const, error: "Target dose must be greater than zero." };
  }

  // When both bounds are supplied, the start must be on or before the end.
  if (input.startDate && input.endDate) {
    const order = parseDateOrder(input.startDate, input.endDate);
    if (!order.ok) return { ok: false as const, error: order.error };
  }

  const data = {
    peptideId: input.peptideId,
    prescriptionId: input.prescriptionId || null,
    name: input.name.trim(),
    source: input.source === "prescription" ? "prescription" : "manual",
    scheduleType: ["fixed_times", "interval", "titration"].includes(input.scheduleType ?? "") ? input.scheduleType! : "fixed_times",
    scheduleRule,
    rebaseMode: input.rebaseMode === "rolling" ? "rolling" : "fixed_anchor",
    adherenceWindowMin: optInt(input.adherenceWindowMin) ?? 120,
    defaultSyringeId: input.defaultSyringeId || null,
    targetDose,
    doseInputUnit: ["mcg", "mg", "ml", "units"].includes(input.doseInputUnit ?? "") ? input.doseInputUnit! : "mcg",
    doseBasis: input.doseBasis === "per_week" ? "per_week" : "per_injection",
    startDate: input.startDate ? new Date(input.startDate) : null,
    endDate: input.endDate ? new Date(input.endDate) : null,
    status: ["active", "paused", "completed"].includes(input.status ?? "") ? input.status! : "active",
  };

  try {
    if (input.id) {
      const { count } = await prisma.protocol.updateMany({ where: { id: input.id, userId: user.id }, data });
      if (count === 0) return { ok: false as const, error: "Protocol not found." };
    } else {
      const created = await prisma.protocol.create({ data: { ...data, userId: user.id } });
      revalidatePath("/protocols");
      revalidatePath("/");
      return { ok: true as const, id: created.id };
    }
  } catch (e) {
    console.error("saveProtocol failed", e);
    return { ok: false as const, error: "Could not save protocol." };
  }
  revalidatePath("/protocols");
  revalidatePath("/");
  return { ok: true as const, id: input.id };
}

export async function addProtocolStep(input: { protocolId: string; dose: string; doseInputUnit: string; durationDays?: string; notes?: string }) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const dose = optDecimal(input.dose);
  if (!dose) return { ok: false as const, error: "Enter a dose for the step." };
  // Verify the protocol belongs to the caller before adding a child step.
  const owns = await prisma.protocol.count({ where: { id: input.protocolId, userId: user.id } });
  if (!owns) return { ok: false as const, error: "Protocol not found." };
  const count = await prisma.protocolStep.count({ where: { protocolId: input.protocolId } });
  try {
    await prisma.protocolStep.create({
      data: {
        protocolId: input.protocolId,
        stepIndex: count,
        dose,
        doseInputUnit: ["mcg", "mg", "ml", "units"].includes(input.doseInputUnit) ? input.doseInputUnit : "mcg",
        durationDays: optInt(input.durationDays),
        notes: input.notes?.trim() || null,
      },
    });
  } catch (e) {
    console.error("addProtocolStep failed", e);
    return { ok: false as const, error: "Could not add step." };
  }
  revalidatePath(`/protocols/${input.protocolId}/edit`);
  return { ok: true as const };
}

/**
 * Add several steps atomically (used by the ramp generator). All-or-nothing:
 * a failure persists none, so a generated ramp can never leave a partial,
 * orphaned set of steps. stepIndex continues from the protocol's current count.
 */
export async function addProtocolSteps(input: {
  protocolId: string;
  steps: { dose: string; doseInputUnit: string; durationDays?: string; notes?: string }[];
}) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  if (!input.steps.length) return { ok: false as const, error: "No steps to add." };
  const owns = await prisma.protocol.count({ where: { id: input.protocolId, userId: user.id } });
  if (!owns) return { ok: false as const, error: "Protocol not found." };

  const rows = input.steps.map((s, i) => {
    const dose = optDecimal(s.dose);
    if (!dose) return null;
    return {
      dose,
      doseInputUnit: ["mcg", "mg", "ml", "units"].includes(s.doseInputUnit) ? s.doseInputUnit : "mcg",
      durationDays: optInt(s.durationDays),
      notes: s.notes?.trim() || null,
      _i: i,
    };
  });
  if (rows.some((r) => r === null)) return { ok: false as const, error: "Every step needs a valid dose." };

  try {
    await prisma.$transaction(async (tx) => {
      const count = await tx.protocolStep.count({ where: { protocolId: input.protocolId } });
      await tx.protocolStep.createMany({
        data: rows.map((r, i) => ({
          protocolId: input.protocolId,
          stepIndex: count + i,
          dose: r!.dose,
          doseInputUnit: r!.doseInputUnit,
          durationDays: r!.durationDays,
          notes: r!.notes,
        })),
      });
    });
  } catch (e) {
    console.error("addProtocolSteps failed", e);
    return { ok: false as const, error: "Could not add the generated steps." };
  }
  revalidatePath(`/protocols/${input.protocolId}/edit`);
  return { ok: true as const };
}

export async function removeProtocolStep(stepId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  try {
    const step = await prisma.protocolStep.findFirst({ where: { id: stepId, protocol: { userId: user.id } } });
    if (!step) return { ok: false as const, error: "Step not found." };
    await prisma.$transaction(async (tx) => {
      await tx.protocolStep.delete({ where: { id: stepId } });
      // Re-index remaining steps to keep stepIndex contiguous.
      const rest = await tx.protocolStep.findMany({ where: { protocolId: step.protocolId }, orderBy: { stepIndex: "asc" } });
      for (let i = 0; i < rest.length; i++) {
        if (rest[i].stepIndex !== i) await tx.protocolStep.update({ where: { id: rest[i].id }, data: { stepIndex: i } });
      }
    });
    revalidatePath(`/protocols/${step.protocolId}/edit`);
  } catch (e) {
    console.error("removeProtocolStep failed", e);
    return { ok: false as const, error: "Could not remove step." };
  }
  return { ok: true as const };
}

export interface UpdateProtocolInput {
  id: string;
  startDateISO?: string | null;
  status?: "active" | "paused" | "completed";
  scheduleRule?: string;
}

export async function updateProtocol(input: UpdateProtocolInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  // Normalise the schedule rule only when one is supplied. `undefined` leaves the
  // column untouched (Prisma skips undefined); an empty string clears it as before.
  let scheduleRule: string | null | undefined = input.scheduleRule;
  if (input.scheduleRule?.trim()) {
    // Resolve the EFFECTIVE anchor: the passed startDateISO when supplied, else
    // the protocol's STORED startDate — otherwise a schedule-only update of an
    // interval/cycle rule would be wrongly rejected as never-due.
    let anchor: string | Date | null | undefined = input.startDateISO;
    if (anchor === undefined) {
      const existing = await prisma.protocol.findFirst({ where: { id: input.id, userId: user.id }, select: { startDate: true } });
      anchor = existing?.startDate ?? null;
    }
    const norm = normaliseScheduleRule(input.scheduleRule, anchor);
    if (!norm.ok) return { ok: false as const, error: norm.error };
    scheduleRule = norm.rule;
  }

  try {
    const { count } = await prisma.protocol.updateMany({
      where: { id: input.id, userId: user.id },
      data: {
        startDate: input.startDateISO === undefined ? undefined : input.startDateISO ? new Date(input.startDateISO) : null,
        status: input.status,
        scheduleRule,
      },
    });
    if (count === 0) return { ok: false as const, error: "Protocol not found." };
  } catch (e) {
    console.error("updateProtocol failed", e);
    return { ok: false as const, error: "Could not update protocol." };
  }
  revalidatePath("/");
  revalidatePath("/protocols");
  return { ok: true as const };
}

/**
 * Pause an active protocol. Ownership-scoped: only the owning user can pause.
 * Paused protocols are excluded from Today, timeline, rolling generation, and
 * reorder coverage. Resume does not back-fill missed days.
 */
export async function pauseProtocol(protocolId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  try {
    const { count } = await prisma.protocol.updateMany({
      where: { id: protocolId, userId: user.id, status: "active" },
      data: { status: "paused" },
    });
    if (count === 0) return { ok: false as const, error: "Protocol not found or not active." };
  } catch (e) {
    console.error("pauseProtocol failed", e);
    return { ok: false as const, error: "Could not pause protocol." };
  }
  revalidatePath("/protocols");
  revalidatePath("/");
  return { ok: true as const };
}

/**
 * Resume a paused protocol. Ownership-scoped.
 * Sets status back to "active". Does not back-fill missed PlannedDose rows.
 */
export async function resumeProtocol(protocolId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  try {
    const { count } = await prisma.protocol.updateMany({
      where: { id: protocolId, userId: user.id, status: "paused" },
      data: { status: "active" },
    });
    if (count === 0) return { ok: false as const, error: "Protocol not found or not paused." };
  } catch (e) {
    console.error("resumeProtocol failed", e);
    return { ok: false as const, error: "Could not resume protocol." };
  }
  revalidatePath("/protocols");
  revalidatePath("/");
  return { ok: true as const };
}

/**
 * Update the dose, unit, or duration of an existing ProtocolStep.
 * Ownership is verified via the parent Protocol's userId.
 * activeStep re-resolves from startDate automatically — no log migration needed.
 */
export async function updateProtocolStep(input: {
  stepId: string;
  dose: string;
  doseInputUnit: string;
  durationDays?: string;
  notes?: string;
}) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const dose = optDecimal(input.dose);
  if (!dose) return { ok: false as const, error: "Enter a dose for the step." };
  try {
    const step = await prisma.protocolStep.findFirst({
      where: { id: input.stepId, protocol: { userId: user.id } },
    });
    if (!step) return { ok: false as const, error: "Step not found." };
    await prisma.protocolStep.update({
      where: { id: input.stepId },
      data: {
        dose,
        doseInputUnit: ["mcg", "mg", "ml", "units"].includes(input.doseInputUnit)
          ? input.doseInputUnit
          : "mcg",
        durationDays: optInt(input.durationDays),
        // Only touch notes when the caller actually provided the field —
        // omitting it preserves existing notes instead of silently clearing.
        ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
      },
    });
    revalidatePath(`/protocols/${step.protocolId}/edit`);
  } catch (e) {
    console.error("updateProtocolStep failed", e);
    return { ok: false as const, error: "Could not update step." };
  }
  return { ok: true as const };
}

/**
 * Permanently delete a protocol. Dose HISTORY is preserved — logged doses are
 * detached (protocolId → null) rather than deleted, so adherence/analytics keep
 * the record of what was actually taken. The protocol's planned doses and
 * titration steps ARE removed (they only describe the now-deleted schedule).
 *
 * The schema has no onDelete clauses, so every FK is implicit RESTRICT — each
 * child is hand-cleared inside the transaction before the parent, or the delete
 * throws. Ownership-scoped at every level; audited; no redirect.
 *
 * Cascade order:
 *   (a) DoseLog.protocolId → null          (PRESERVE history; do NOT delete logs)
 *   (b) DoseLog.plannedDoseId → null       (break the 1-1 link before its PlannedDose dies)
 *   (c) delete PlannedDose (by protocolId)
 *   (d) delete ProtocolStep (by protocolId)
 *   (e) delete Protocol (by id + userId)
 *   (f) auditLog (field: "delete")
 */
export async function deleteProtocol(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  // Ownership check — only the caller's protocol. Missing → safe no-op.
  const protocol = await prisma.protocol.findFirst({ where: { id, userId: user.id } });
  if (!protocol) return { ok: true as const };

  try {
    await prisma.$transaction(async (tx) => {
      // (a) Preserve dose history: detach logs from this protocol (keep the logs).
      await tx.doseLog.updateMany({ where: { protocolId: id, userId: user.id }, data: { protocolId: null } });

      // (b) Any DoseLog still linked to one of this protocol's planned doses must
      //     drop that 1-1 link first, or deleting the PlannedDose violates the FK.
      const plannedIds = (await tx.plannedDose.findMany({ where: { protocolId: id }, select: { id: true } })).map((p) => p.id);
      if (plannedIds.length) {
        await tx.doseLog.updateMany({ where: { plannedDoseId: { in: plannedIds }, userId: user.id }, data: { plannedDoseId: null } });
      }

      // (c) + (d) Remove the schedule's planned doses and titration steps.
      await tx.plannedDose.deleteMany({ where: { protocolId: id } });
      await tx.protocolStep.deleteMany({ where: { protocolId: id } });

      // (e) Delete the protocol itself (ownership-scoped).
      await tx.protocol.deleteMany({ where: { id, userId: user.id } });

      // (f) Audit.
      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "Protocol",
          entityId: id,
          field: "delete",
          oldValue: protocol.name,
          newValue: `deleted: ${plannedIds.length} planned doses removed; logs detached`,
        },
      });
    });
  } catch (e) {
    console.error("deleteProtocol failed", e);
    return { ok: false as const, error: "Could not delete protocol." };
  }

  revalidatePath("/protocols");
  revalidatePath("/");
  return { ok: true as const };
}

/**
 * Move a step up or down by one position (swap stepIndex with neighbour).
 * Ownership verified via parent Protocol userId.
 */
export async function moveProtocolStep(stepId: string, direction: "up" | "down") {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  try {
    const step = await prisma.protocolStep.findFirst({
      where: { id: stepId, protocol: { userId: user.id } },
    });
    if (!step) return { ok: false as const, error: "Step not found." };
    const all = await prisma.protocolStep.findMany({
      where: { protocolId: step.protocolId },
      orderBy: { stepIndex: "asc" },
    });
    const idx = all.findIndex((s) => s.id === stepId);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= all.length) return { ok: false as const, error: "Already at boundary." };
    const neighbour = all[swapIdx];
    await prisma.$transaction([
      prisma.protocolStep.update({ where: { id: step.id }, data: { stepIndex: neighbour.stepIndex } }),
      prisma.protocolStep.update({ where: { id: neighbour.id }, data: { stepIndex: step.stepIndex } }),
    ]);
    revalidatePath(`/protocols/${step.protocolId}/edit`);
  } catch (e) {
    console.error("moveProtocolStep failed", e);
    return { ok: false as const, error: "Could not reorder step." };
  }
  return { ok: true as const };
}
