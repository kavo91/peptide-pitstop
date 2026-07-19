"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { assertPeptideUsable, assertPrescriptionCompatible, assertPrescriptionOwned, assertSyringeUsable } from "@/lib/auth/ownership";
import { normaliseScheduleRule } from "@/lib/schedule/normalise";
import { parsePositiveDecimal, parseDateOrder } from "@/lib/validation/domain";
import { runPlannedDoseGeneration } from "@/lib/planned/run";
import { computeAdvance } from "@/lib/titration/advance-suggest";
import { dosesPerWeek } from "@/lib/schedule/frequency";

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
  steps?: { dose: string; doseInputUnit: string; durationDays?: string; notes?: string }[];
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

  const initialSteps = !input.id && data.scheduleType === "titration" ? (input.steps ?? []) : [];
  const stepRows = initialSteps.map((s) => {
    const dose = optDecimal(s.dose);
    if (!dose) return null;
    return {
      dose,
      doseInputUnit: ["mcg", "mg", "ml", "units"].includes(s.doseInputUnit) ? s.doseInputUnit : "mcg",
      durationDays: optInt(s.durationDays),
      notes: s.notes?.trim() || null,
    };
  });
  if (stepRows.some((r) => r === null)) return { ok: false as const, error: "Every step needs a valid dose." };

  let savedId = input.id;
  try {
    if (input.id) {
      // Snapshot the stored dates BEFORE the update so the stack cascade below
      // only fires for dates the user actually CHANGED — a form save that
      // touched an unrelated field must not impose this component's (echoed)
      // dates onto siblings whose own dates legitimately differ.
      const before = await prisma.protocol.findFirst({
        where: { id: input.id, userId: user.id },
        select: { stackId: true, startDate: true, endDate: true, status: true },
      });
      if (!before) return { ok: false as const, error: "Protocol not found." };

      const { count } = await prisma.protocol.updateMany({ where: { id: input.id, userId: user.id }, data });
      if (count === 0) return { ok: false as const, error: "Protocol not found." };

      // Stack alignment: a changed start/end date or status re-aligns siblings
      // (same contract as updateProtocol and updateStackSchedule).
      if (before.stackId) {
        const dateEq = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
        const changed: { startDate?: Date | null; endDate?: Date | null; status?: string } = {};
        if (!dateEq(before.startDate, data.startDate)) changed.startDate = data.startDate;
        if (!dateEq(before.endDate, data.endDate)) changed.endDate = data.endDate;
        if (before.status !== data.status) changed.status = data.status;
        if (Object.keys(changed).length > 0) {
          await prisma.protocol.updateMany({
            where: { stackId: before.stackId, userId: user.id, id: { not: input.id } },
            data: changed,
          });
        }
      }
    } else {
      await prisma.$transaction(async (tx) => {
        const created = await tx.protocol.create({ data: { ...data, userId: user.id } });
        savedId = created.id;
        if (stepRows.length > 0) {
          await tx.protocolStep.createMany({
            data: stepRows.map((s, i) => ({
              protocolId: created.id,
              stepIndex: i,
              dose: s!.dose,
              doseInputUnit: s!.doseInputUnit,
              durationDays: s!.durationDays,
              notes: s!.notes,
            })),
          });
        }
      });
    }
  } catch (e) {
    console.error("saveProtocol failed", e);
    return { ok: false as const, error: "Could not save protocol." };
  }

  // Re-materialise planned doses NOW so date/schedule changes take effect
  // immediately (stale out-of-window rows deleted, new grid generated) instead
  // of waiting for the daily tick. Non-fatal — the save itself succeeded.
  try {
    await runPlannedDoseGeneration(user.id);
  } catch (e) {
    console.error("saveProtocol: planned-dose regeneration failed", e);
  }

  revalidatePath("/protocols");
  revalidatePath("/");
  return { ok: true as const, id: savedId };
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

/**
 * Confirm a titration phase-advance offered at log time: the user logged a
 * dose matching the NEXT step, and accepted bringing that phase forward. The
 * suggestion is RECOMPUTED here from the dose log — client-carried numbers are
 * never trusted — then the current step's durationDays is truncated so its
 * dose-count target ends exactly before the matching dose. Audited.
 */
export async function advanceTitrationPhase(input: { protocolId: string; doseLogId: string }) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const log = await prisma.doseLog.findFirst({ where: { id: input.doseLogId, userId: user.id, protocolId: input.protocolId } });
  if (!log) return { ok: false as const, error: "Dose log not found." };
  const protocol = await prisma.protocol.findFirst({
    where: { id: input.protocolId, userId: user.id, status: "active" },
    include: { steps: true },
  });
  if (!protocol) return { ok: false as const, error: "Protocol not found." };

  const deliveredBeforeCount = await prisma.doseLog.count({
    where: { userId: user.id, protocolId: protocol.id, takenAt: { lt: log.takenAt } },
  });
  const computed = computeAdvance({
    steps: protocol.steps,
    doseBasis: protocol.doseBasis === "per_week" ? "per_week" : "per_injection",
    injectionsPerWeek: dosesPerWeek(protocol.scheduleRule),
    deliveredBeforeCount,
    loggedDoseMcg: log.doseMcg.toString(),
  });
  if (!computed) return { ok: false as const, error: "No phase advance applies to that dose." };

  const step = protocol.steps.find((s) => s.stepIndex === computed.stepIndex);
  if (!step) return { ok: false as const, error: "Step not found." };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.protocolStep.update({ where: { id: step.id }, data: { durationDays: computed.newDurationDays } });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "ProtocolStep",
          entityId: step.id,
          field: "advance-titration",
          oldValue: `phase ${computed.fromPhase}/${computed.phaseCount} durationDays ${step.durationDays ?? "∞"}`,
          newValue: `durationDays ${computed.newDurationDays} — phase ${computed.toPhase} brought forward at dose ${log.id}`,
        },
      });
    });
  } catch (e) {
    console.error("advanceTitrationPhase failed", e);
    return { ok: false as const, error: "Could not advance the phase." };
  }

  revalidatePath("/");
  revalidatePath("/today");
  revalidatePath("/doses");
  revalidatePath(`/protocols/${protocol.id}/edit`);
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

  // One ownership-scoped read serves the schedule-anchor resolution, the
  // start-vs-end validation, and the stack lookup for the date alignment below.
  const target = await prisma.protocol.findFirst({
    where: { id: input.id, userId: user.id },
    select: { startDate: true, endDate: true, stackId: true },
  });
  if (!target) return { ok: false as const, error: "Protocol not found." };

  // The quick editor shows only the start date, so validate against the STORED
  // end date — an inverted window (start after end) would silently generate
  // nothing and must be rejected, not persisted.
  if (input.startDateISO && target.endDate && new Date(input.startDateISO) > target.endDate) {
    return {
      ok: false as const,
      error: `Start date is after this protocol's end date (${target.endDate.toISOString().slice(0, 10)}) — move or clear the end date first.`,
    };
  }

  // Normalise the schedule rule only when one is supplied. `undefined` leaves the
  // column untouched (Prisma skips undefined); an empty string clears it as before.
  let scheduleRule: string | null | undefined = input.scheduleRule;
  if (input.scheduleRule?.trim()) {
    // Resolve the EFFECTIVE anchor: the passed startDateISO when supplied, else
    // the protocol's STORED startDate — otherwise a schedule-only update of an
    // interval/cycle rule would be wrongly rejected as never-due.
    const anchor: string | Date | null =
      input.startDateISO === undefined ? target.startDate ?? null : input.startDateISO;
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

    // Stack date alignment: a stack's components run as one combined protocol,
    // so a start-date CHANGE on one component re-aligns every sibling (the same
    // contract updateStackSchedule keeps for the stack editor). Without this the
    // stack silently drifts apart when edited card-by-card on /protocols. An
    // unchanged (form-echoed) value never cascades — a save that didn't touch
    // the date must not overwrite siblings with the sender's stale copy.
    if (input.startDateISO !== undefined && target.stackId) {
      const newStart = input.startDateISO ? new Date(input.startDateISO) : null;
      const changed = (newStart?.getTime() ?? null) !== (target.startDate?.getTime() ?? null);
      if (changed) {
        await prisma.protocol.updateMany({
          where: { stackId: target.stackId, userId: user.id, id: { not: input.id } },
          data: { startDate: newStart },
        });
      }
    }
    if (input.status !== undefined && target.stackId) {
      await prisma.protocol.updateMany({
        where: { stackId: target.stackId, userId: user.id, id: { not: input.id } },
        data: { status: input.status },
      });
    }
  } catch (e) {
    console.error("updateProtocol failed", e);
    return { ok: false as const, error: "Could not update protocol." };
  }

  // Re-materialise planned doses NOW so a date change takes effect immediately:
  // deletes rows stranded outside the new window (which would otherwise sit as
  // phantom due/missed doses until the daily tick) and generates the new grid.
  // Failure is non-fatal — the save itself succeeded and the startup/cron
  // runner self-heals on its next tick.
  try {
    await runPlannedDoseGeneration(user.id);
  } catch (e) {
    console.error("updateProtocol: planned-dose regeneration failed", e);
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
    const target = await prisma.protocol.findFirst({
      where: { id: protocolId, userId: user.id, status: "active" },
      select: { stackId: true },
    });
    if (!target) return { ok: false as const, error: "Protocol not found or not active." };
    await prisma.protocol.updateMany({
      where: target.stackId ? { stackId: target.stackId, userId: user.id, status: "active" } : { id: protocolId, userId: user.id, status: "active" },
      data: { status: "paused" },
    });
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
    const target = await prisma.protocol.findFirst({
      where: { id: protocolId, userId: user.id, status: "paused" },
      select: { stackId: true },
    });
    if (!target) return { ok: false as const, error: "Protocol not found or not paused." };
    await prisma.protocol.updateMany({
      where: target.stackId ? { stackId: target.stackId, userId: user.id, status: "paused" } : { id: protocolId, userId: user.id, status: "paused" },
      data: { status: "active" },
    });
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
