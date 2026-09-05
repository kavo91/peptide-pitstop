"use server";

import { revalidatePath } from "next/cache";

import { parseStepDuration, validateStepDurations } from "@/lib/titration/step-duration";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { assertPeptideUsable, assertPrescriptionCompatible, assertPrescriptionOwned, assertSyringeUsable } from "@/lib/auth/ownership";
import { normaliseScheduleRule } from "@/lib/schedule/normalise";
import { parsePositiveDecimal, parseDateOrder } from "@/lib/validation/domain";
import { runPlannedDoseGeneration } from "@/lib/planned/run";
import { computeAdvance } from "@/lib/titration/advance-suggest";
import { dosesPerWeek } from "@/lib/schedule/frequency";
import { dayKey } from "@/lib/today-overrides";
import { hasActiveProtocolConflict } from "@/lib/protocol-uniqueness";
import { assertNoScheduleRewrite, endDateOnClose, type ProtocolSnapshot } from "@/lib/protocol-revision";
import { courseTips, supersededIds } from "@/lib/stacks/lineage";
import { validateCyclePlan } from "@/lib/validation/cycle-plan";

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


/** Date-only "YYYY-MM-DD" for snapshot comparison; null stays null. */
function dayOf(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString().slice(0, 10) : null;
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
  /** Planned on-cycle length in WEEKS; blank/absent = continuous (no planned stop). */
  cycleOnWeeks?: string;
  /** Planned break in WEEKS; blank/absent = stop without a planned restart. */
  cycleOffWeeks?: string;
  /** Start of the CURRENT on-cycle; blank falls back to startDate. */
  cycleAnchor?: string;
  steps?: { dose: string; doseInputUnit: string; durationDays?: string; notes?: string }[];
}

/**
 * Superseded (revised-out) protocol ids within a stack — frozen history that no
 * sibling cascade may touch. reviseProtocol keeps the completed predecessor in
 * the stack next to its successor; cascading status/dates onto it would
 * retro-edit a closed course or resurrect it as a duplicate active protocol.
 */
async function stackSupersededIds(userId: string, stackId: string): Promise<string[]> {
  const rows = await prisma.protocol.findMany({
    where: { stackId, userId },
    select: { id: true, courseId: true, status: true, startDate: true },
  });
  return [...supersededIds(rows)];
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

  // One ACTIVE protocol per peptide — see lib/protocol-uniqueness for why the
  // status matters. Completed/paused courses are history and must not block
  // editing the live protocol, nor starting the next cycle of one.
  const siblings = await prisma.protocol.findMany({
    where: { userId: user.id, peptideId: input.peptideId },
    select: { id: true, status: true },
  });
  const savingStatus = ["active", "paused", "completed"].includes(input.status ?? "")
    ? input.status!
    : "active";
  if (hasActiveProtocolConflict(siblings, { id: input.id, status: savingStatus })) {
    return {
      ok: false as const,
      error: "That peptide already has an active protocol — edit it, or complete it first.",
    };
  }

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

  // Cycle plan — validation shared with updateProtocol (lib/validation/cycle-plan).
  const cyclePlan = validateCyclePlan(optInt(input.cycleOnWeeks), optInt(input.cycleOffWeeks));
  if (!cyclePlan.ok) return { ok: false as const, error: cyclePlan.error };
  const { onWeeks: cycleOnWeeks, offWeeks: cycleOffWeeks } = cyclePlan;

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
    cycleOnWeeks,
    // A break is only meaningful alongside an on-cycle; clearing the on-cycle
    // clears the break with it rather than leaving an orphan.
    cycleOffWeeks: cycleOnWeeks === null ? null : cycleOffWeeks,
    // Explicit anchor wins; otherwise the cycle counts from the protocol start,
    // which cycleState() resolves at read time (anchor ?? startDate).
    cycleAnchor: input.cycleAnchor ? new Date(input.cycleAnchor) : null,
  };

  // Backstop: refuse a schedule rewrite on a live protocol that already has
  // logged doses. ProtocolForm prompts and routes to reviseProtocol before ever
  // reaching here; this catches every other door (imports, direct calls).
  //
  // Deliberately placed AFTER `data` is assembled rather than at the uniqueness
  // check: `after` must read the SAME values the update below writes — the
  // NORMALISED scheduleRule and the coerced doseBasis/startDate, not the raw
  // input. Comparing raw input would refuse an ordinary save whenever
  // normaliseScheduleRule merely canonicalised the rule. Still before any write.
  if (input.id) {
    const existing = await prisma.protocol.findFirst({
      where: { id: input.id, userId: user.id },
      select: {
        status: true,
        scheduleRule: true,
        doseBasis: true,
        startDate: true,
        steps: { select: { stepIndex: true, durationDays: true } },
      },
    });
    if (existing) {
      const delivered = await prisma.doseLog.count({ where: { userId: user.id, protocolId: input.id } });
      const before: ProtocolSnapshot = {
        scheduleRule: existing.scheduleRule,
        doseBasis: existing.doseBasis,
        startDate: dayOf(existing.startDate),
        steps: existing.steps,
      };
      const after: ProtocolSnapshot = {
        scheduleRule: data.scheduleRule,
        doseBasis: data.doseBasis,
        startDate: dayOf(data.startDate),
        // An EDIT never writes steps (see `initialSteps` directly below), and the
        // edit page seeds the form without them — so an absent `steps` means
        // "unchanged", not "cleared". A caller that DOES hand over a different
        // ladder is stating exactly the intent this backstop exists to refuse,
        // so that case is still compared.
        steps: input.steps
          ? input.steps.map((s, i) => ({
              stepIndex: i,
              durationDays: s.durationDays == null || s.durationDays === "" ? null : Number(s.durationDays),
            }))
          : existing.steps,
      };
      try {
        assertNoScheduleRewrite(before, after, { status: existing.status, hasDeliveredDoses: delivered > 0 });
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : "Schedule change refused." };
      }
    }
  }

  const initialSteps = !input.id && data.scheduleType === "titration" ? (input.steps ?? []) : [];
  const durations = validateStepDurations(initialSteps);
  if (!durations.ok) return { ok: false as const, error: durations.error };
  const stepRows = initialSteps.map((s, i) => {
    const dose = optDecimal(s.dose);
    if (!dose) return null;
    return {
      dose,
      doseInputUnit: ["mcg", "mg", "ml", "units"].includes(s.doseInputUnit) ? s.doseInputUnit : "mcg",
      durationDays: durations.values[i],
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

      // Closing a protocol by hand must stamp an honest endDate, the way
      // reviseProtocol already does. Without it `status` says the course is over
      // while `endDate` says it runs for weeks yet, and slot generation — bounded
      // by endDate — keeps emitting ghosts that age into misses nobody could log.
      // dayKey is LOCAL: a UTC slice would stamp yesterday for the first ten
      // hours of a Brisbane day, landing endDate before a dose logged today.
      const closeAt = endDateOnClose({
        wasStatus: before.status,
        nowStatus: data.status,
        currentEndDate: data.endDate ? dayKey(data.endDate) : null,
        todayKey: dayKey(new Date()),
      });
      if (closeAt) data.endDate = new Date(`${closeAt}T00:00:00.000Z`);

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
            // Never onto revised-out predecessors — resurrecting a closed course
            // yields two active protocols for one peptide (double /today cards,
            // double logStack doses).
            where: { stackId: before.stackId, userId: user.id, id: { notIn: [input.id, ...(await stackSupersededIds(user.id, before.stackId))] } },
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
  const duration = parseStepDuration(input.durationDays);
  if (!duration.ok) return { ok: false as const, error: duration.error };
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
        durationDays: duration.value,
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
  // Validate the caller's OWN input before the ownership round-trip: it leaks
  // nothing about the resource, saves a query on a malformed payload, and keeps
  // the refusal order identical across all four step-writing actions.
  const rampDurations = validateStepDurations(input.steps);
  if (!rampDurations.ok) return { ok: false as const, error: rampDurations.error };

  const owns = await prisma.protocol.count({ where: { id: input.protocolId, userId: user.id } });
  if (!owns) return { ok: false as const, error: "Protocol not found." };

  const rows = input.steps.map((s, i) => {
    const dose = optDecimal(s.dose);
    if (!dose) return null;
    return {
      dose,
      doseInputUnit: ["mcg", "mg", "ml", "units"].includes(s.doseInputUnit) ? s.doseInputUnit : "mcg",
      durationDays: rampDurations.values[i],
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
  /** Course end. `undefined` untouched, `null` clears (open-ended). */
  endDateISO?: string | null;
  status?: "active" | "paused" | "completed";
  scheduleRule?: string;
  /** Cycle plan in WEEKS — same contract: `undefined` untouched, `null` clears. */
  cycleOnWeeks?: number | null;
  cycleOffWeeks?: number | null;
  /** Start of the CURRENT on-cycle; `null` falls back to startDate at read time. */
  cycleAnchorISO?: string | null;
}

export async function updateProtocol(input: UpdateProtocolInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  // One ownership-scoped read serves the schedule-anchor resolution, the
  // start-vs-end validation, the cycle-plan merge, and the stack lookup for
  // the date alignment below.
  const target = await prisma.protocol.findFirst({
    where: { id: input.id, userId: user.id },
    select: { startDate: true, endDate: true, stackId: true, courseId: true, cycleOnWeeks: true, cycleOffWeeks: true },
  });
  if (!target) return { ok: false as const, error: "Protocol not found." };

  // Frozen history. reviseProtocol keeps the completed predecessor beside its
  // live successor (courseId chains them), and courseTips() deliberately drops
  // the predecessor — so EVERY guard and cascade below would evaluate the live
  // successor instead of the row actually being edited. Two consequences, both
  // silent: the titration guard passed on a closed, already-dosed, titrating
  // predecessor (its steps/doses were never inspected), and the sibling cascade
  // — `notIn: [input.id, ...superseded]`, which collapses to exactly the
  // superseded set when input.id is itself superseded — then matched the TIPS
  // and pushed the predecessor's new date onto the running stack.
  // Lineage is per COURSE, not per stack: reviseProtocol sets
  // `courseId: old.courseId ?? old.id` for standalone protocols too.
  const courseKeyOf = target.courseId ?? input.id;
  const courseGroup = await prisma.protocol.findMany({
    where: { userId: user.id, OR: [{ id: courseKeyOf }, { courseId: courseKeyOf }] },
    select: { id: true, courseId: true, status: true, startDate: true },
  });
  // Only conclude "superseded" from a group we actually found the target in —
  // never block the edit on an unexpectedly empty read.
  if (
    courseGroup.some((p) => p.id === input.id) &&
    !courseTips(courseGroup).some((t) => t.id === input.id)
  ) {
    return {
      ok: false as const,
      error:
        "This protocol was revised and replaced — its dates and status are frozen history. Edit the current course instead.",
    };
  }

  // Titration guard (same principle as assertNoScheduleRewrite and the
  // updateStackSchedule guard): a startDate change re-times every phase
  // boundary (durationDays count from startDate) — refuse it on any titrating
  // protocol with delivered doses, including stack siblings the cascade below
  // would reach. The Gantt quick edit must not be the open door the form and
  // the stack editor both close. End-date edits stay allowed (closing a course
  // does not rewrite past phases).
  if (input.startDateISO !== undefined) {
    const guardStart = input.startDateISO ? new Date(input.startDateISO) : null;
    if ((guardStart?.getTime() ?? null) !== (target.startDate?.getTime() ?? null)) {
      const scope = await prisma.protocol.findMany({
        where: target.stackId ? { stackId: target.stackId, userId: user.id } : { id: input.id, userId: user.id },
        select: { id: true, courseId: true, status: true, startDate: true, _count: { select: { steps: true, doseLogs: true } } },
      });
      const affected = target.stackId ? courseTips(scope) : scope;
      if (affected.some((c) => c._count.steps > 0 && c._count.doseLogs > 0)) {
        return {
          ok: false as const,
          error:
            "This protocol (or its stack) is titrating with logged doses — a start-date change would rewrite its phase targets. Revise instead (close + start new).",
        };
      }
    }
  }

  // Validate the EFFECTIVE window (sent value where supplied, stored value
  // otherwise) — an inverted window (start after end) would silently generate
  // nothing and must be rejected, not persisted.
  const effStart =
    input.startDateISO === undefined ? target.startDate : input.startDateISO ? new Date(input.startDateISO) : null;
  const effEnd =
    input.endDateISO === undefined ? target.endDate : input.endDateISO ? new Date(input.endDateISO) : null;
  if (effStart && effEnd && effStart > effEnd) {
    return input.startDateISO !== undefined
      ? {
          ok: false as const,
          error: `Start date is after this protocol's end date (${effEnd.toISOString().slice(0, 10)}) — move or clear the end date first.`,
        }
      : {
          ok: false as const,
          error: `End date is before this protocol's start date (${effStart.toISOString().slice(0, 10)}) — move the start date first.`,
        };
  }

  // Cycle plan: merge sent fields over stored ones, then apply the SAME rules
  // the protocol form enforces (lib/validation/cycle-plan). Only written when
  // the caller touched a cycle field — an untouched plan stays byte-identical.
  const cycleTouched = input.cycleOnWeeks !== undefined || input.cycleOffWeeks !== undefined;
  const cyclePlan = validateCyclePlan(
    input.cycleOnWeeks === undefined ? target.cycleOnWeeks : input.cycleOnWeeks,
    // Clearing the on-cycle takes the stored break with it — the stored value
    // must not veto the clear the validator would otherwise reject.
    input.cycleOffWeeks !== undefined ? input.cycleOffWeeks
      : input.cycleOnWeeks === null ? null
      : target.cycleOffWeeks,
  );
  if (cycleTouched && !cyclePlan.ok) return { ok: false as const, error: cyclePlan.error };

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
        endDate: input.endDateISO === undefined ? undefined : input.endDateISO ? new Date(input.endDateISO) : null,
        status: input.status,
        scheduleRule,
        ...(cycleTouched && cyclePlan.ok
          ? { cycleOnWeeks: cyclePlan.onWeeks, cycleOffWeeks: cyclePlan.offWeeks }
          : {}),
        cycleAnchor:
          input.cycleAnchorISO === undefined ? undefined : input.cycleAnchorISO ? new Date(input.cycleAnchorISO) : null,
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
          // Tips only — a revised-out predecessor's frozen window must not move.
          where: { stackId: target.stackId, userId: user.id, id: { notIn: [input.id, ...(await stackSupersededIds(user.id, target.stackId))] } },
          data: { startDate: newStart },
        });
      }
    }
    // End dates align across a stack the same way — the components run as one
    // combined protocol, so one course's stop is the stack's stop.
    if (input.endDateISO !== undefined && target.stackId) {
      const newEnd = input.endDateISO ? new Date(input.endDateISO) : null;
      const changed = (newEnd?.getTime() ?? null) !== (target.endDate?.getTime() ?? null);
      if (changed) {
        await prisma.protocol.updateMany({
          // Tips only — a revised-out predecessor's frozen window must not move.
          where: { stackId: target.stackId, userId: user.id, id: { notIn: [input.id, ...(await stackSupersededIds(user.id, target.stackId))] } },
          data: { endDate: newEnd },
        });
      }
    }
    if (input.status !== undefined && target.stackId) {
      await prisma.protocol.updateMany({
        // Tips only — never resurrect a completed revised-out predecessor.
        where: { stackId: target.stackId, userId: user.id, id: { notIn: [input.id, ...(await stackSupersededIds(user.id, target.stackId))] } },
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
  revalidatePath("/protocols/gantt");
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
  const duration = parseStepDuration(input.durationDays);
  if (!duration.ok) return { ok: false as const, error: duration.error };
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
        durationDays: duration.value,
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

export interface ReviseProtocolInput {
  /** The live protocol being replaced. */
  id: string;
  /** The edited fields, exactly as ProtocolForm would have saved them. */
  next: ProtocolInput;
  /** New protocol's first day, "YYYY-MM-DD". Defaults to today. */
  startDate?: string;
}

/**
 * Thrown INSIDE the transaction when the close's compare-and-swap matches zero
 * rows — someone else already revised or closed this protocol (a
 * double click could otherwise race two updateMany calls past an unguarded close, and each
 * would go on to create its own successor). Throwing aborts the transaction so
 * nothing is created and no audit row is written; the outer catch below maps
 * it to a clean refusal.
 */
class RevisionRaceError extends Error {}

/**
 * Complete a live protocol and create its replacement, linked as one course.
 *
 * Never mutates the old protocol's schedule — that is the whole point, and it is
 * why this needs no exemption from assertNoScheduleRewrite. The old row keeps
 * every field it had when its doses were logged, so history stays readable.
 */
export async function reviseProtocol(input: ReviseProtocolInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const old = await prisma.protocol.findFirst({
    where: { id: input.id, userId: user.id },
    select: {
      id: true,
      peptideId: true,
      courseId: true,
      status: true,
      stackId: true,
      vialId: true,
      startDate: true,
      // Read BEFORE the close below, so this is the course's ORIGINAL planned
      // cycle/end — not whatever the close step is about to overwrite them with.
      cycleOnWeeks: true,
      cycleOffWeeks: true,
      cycleAnchor: true,
      endDate: true,
    },
  });
  if (!old) return { ok: false as const, error: "Protocol not found." };
  if (old.status !== "active") return { ok: false as const, error: "Only a live protocol can be revised." };

  const startDate = input.startDate?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const newStart = new Date(`${startDate}T00:00:00.000Z`);

  // A revision must start AFTER the course it replaces. The dialog is a bare date
  // input with no min. Two distinct problems, with different reach:
  //
  //  - courseTips' date fallback would elect the frozen predecessor as the
  //    operable tip once both rows completed, inverting the lineage. Reachable
  //    from the UI.
  //  - The predecessor's endDate is the day BEFORE this start, floored at its
  //    last delivered dose. Via the UI that floor holds (the revise flow is only
  //    offered once a dose is logged), so the window is not inverted there; but
  //    this action has no dose gate of its own, and on a protocol with no logged
  //    doses the floor does not apply and the predecessor ends before it starts.
  //
  // Refuse rather than clamp — the user picked a date that cannot mean what they
  // intended. `<=`, not `<`: same-day is rejected too, because the per-course
  // same-day dedup that would make an overlap safe is implemented on the stack
  // logging path (logStack), not for a standalone protocol. Revisit only with
  // that dedup proven for both paths.
  if (old.startDate && newStart.getTime() <= old.startDate.getTime()) {
    return {
      ok: false as const,
      error: `A revision must start after the protocol it replaces (${old.startDate.toISOString().slice(0, 10)}). Pick a later date.`,
    };
  }

  // The successor must NOT hard-code endDate: null and drop the cycle
  // columns entirely: a protocol that carries a cycle plan would then have its
  // revision silently ejected from that cycle, moving the reorder-by date
  // computed from it. cycleOnWeeks/cycleOffWeeks/cycleAnchor are ALWAYS
  // carried from the predecessor below — never read from input.next, because a
  // revision edits the schedule/dose, not the cycle plan. endDate carries the
  // predecessor's original planned end unless the caller explicitly sets a new one.
  const nextEndDate = input.next.endDate?.trim();
  const successorEndDate = nextEndDate ? new Date(`${nextEndDate.slice(0, 10)}T00:00:00.000Z`) : old.endDate;

  // Same house rule as the backdated-start guard above: refuse rather than
  // clamp. An end date on or before the new start can't mean what the caller
  // intended, and clamping it would silently corrupt the plan instead.
  if (successorEndDate && successorEndDate.getTime() <= newStart.getTime()) {
    return {
      ok: false as const,
      error: `The course ends on ${successorEndDate.toISOString().slice(0, 10)}, before the revision would start. Pick an earlier start date or clear the end date.`,
    };
  }

  // Validate + canonicalise exactly as saveProtocol does. Without this the
  // revision path is a hole in the validation: normaliseScheduleRule also
  // REJECTS never-due and malformed rules, so a schedule the ordinary save
  // refuses could be stored by revising instead.
  let revisedRule: string | null = null;
  if (input.next.scheduleRule) {
    const norm = normaliseScheduleRule(input.next.scheduleRule, startDate);
    if (!norm.ok) return { ok: false as const, error: norm.error };
    revisedRule = norm.rule;
  }

  // endDate = the day before the new one starts, floored at the last delivered
  // dose's day so an endDate can never land before a real logged dose.
  const lastDose = await prisma.doseLog.findFirst({
    where: { userId: user.id, protocolId: old.id },
    orderBy: { takenAt: "desc" },
    select: { takenAt: true, localDay: true },
  });
  const dayBefore = new Date(newStart.getTime() - 86_400_000);
  const lastDoseDay = lastDose
    ? new Date(`${lastDose.localDay ?? new Date(lastDose.takenAt).toISOString().slice(0, 10)}T00:00:00.000Z`)
    : null;
  const endDate = lastDoseDay && lastDoseDay > dayBefore ? lastDoseDay : dayBefore;

  try {
    const newId = await prisma.$transaction(async (tx) => {
      // Compare-and-swap: only close a protocol that is still active. Without
      // status in the where-clause a double-submit (double click, retried
      // request) races two updateMany calls past this point and each proceeds
      // to create its own successor — two live protocols from one revision.
      // The loser's updateMany now matches zero rows and gets caught below.
      const closed = await tx.protocol.updateMany({
        where: { id: old.id, userId: user.id, status: "active" },
        data: { status: "completed", endDate },
      });
      if (closed.count === 0) throw new RevisionRaceError();

      // Future planned doses are NOT deleted here. isRetired() in
      // lib/planned/materialize.ts retires a non-active protocol's rows from
      // today forward on the next generation run, and runPlannedDoseGeneration
      // is called below — so flipping the status IS the trigger. A second
      // mechanism scoped to one protocol would be free to drift from it.

      const created = await tx.protocol.create({
        data: {
          userId: user.id,
          peptideId: old.peptideId,
          courseId: old.courseId ?? old.id,
          // A stack component's successor stays IN the stack with its pinned
          // vial — sibling cascades, grouped views and prep resolution all key
          // on these; dropping them silently ejects the component.
          stackId: old.stackId,
          vialId: old.vialId,
          name: input.next.name.trim(),
          // Same enum coercion saveProtocol applies — an unrecognised value must
          // fall back to a schema-legal one, never be persisted verbatim.
          scheduleType: ["fixed_times", "interval", "titration"].includes(input.next.scheduleType ?? "")
            ? input.next.scheduleType!
            : "fixed_times",
          scheduleRule: revisedRule,
          // Coerced exactly as saveProtocol does — the two paths must not disagree on
          // the default, or a revision silently changes rebase behaviour.
          rebaseMode: input.next.rebaseMode === "rolling" ? "rolling" : "fixed_anchor",
          adherenceWindowMin: optInt(input.next.adherenceWindowMin) ?? 120,
          defaultSyringeId: input.next.defaultSyringeId || null,
          prescriptionId: input.next.prescriptionId || null,
          targetDose: optDecimal(input.next.targetDose),
          doseInputUnit: ["mcg", "mg", "ml", "units"].includes(input.next.doseInputUnit ?? "")
            ? input.next.doseInputUnit!
            : "mcg",
          doseBasis: input.next.doseBasis === "per_week" ? "per_week" : "per_injection",
          startDate: newStart,
          endDate: successorEndDate,
          status: "active",
          // Carried from the predecessor, ALWAYS — never read from input.next.
          // Dropping these on revise would silently eject the course
          // from its cycle plan and move its reorder-by date. Not
          // shiftPinned: the successor starts unpinned, same as any new row.
          cycleOnWeeks: old.cycleOnWeeks,
          cycleOffWeeks: old.cycleOffWeeks,
          // A NULL anchor is not "no anchor" — every consumer
          // (cyclePlanEnd, cycleState, buildForecastPlan) falls back to
          // `startDate`, so carrying null onto a successor that starts later
          // silently moves the cycle's plan end forward by exactly the
          // revision gap, and with it the reorder-by date. Pin the fallback to
          // the predecessor's own startDate the moment there is a cycle to
          // anchor; a protocol with no cycle plan still carries null.
          cycleAnchor: old.cycleAnchor ?? (old.cycleOnWeeks ? old.startDate : null),
          steps: {
            create: (input.next.steps ?? []).map((s, i) => ({
              stepIndex: i,
              dose: s.dose,
              doseInputUnit: s.doseInputUnit,
              durationDays: s.durationDays == null || s.durationDays === "" ? null : Number(s.durationDays),
              notes: s.notes || null,
            })),
          },
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "Protocol",
          entityId: created.id,
          field: "revise",
          newValue: `revised from ${old.id}; course ${old.courseId ?? old.id}`,
        },
      });

      return created.id;
    });

    await runPlannedDoseGeneration(user.id);
    revalidatePath("/protocols");
    revalidatePath("/");
    revalidatePath("/today");
    return { ok: true as const, id: newId };
  } catch (e) {
    if (e instanceof RevisionRaceError) {
      return { ok: false as const, error: "This protocol was already revised or closed. Refresh and try again." };
    }
    console.error("reviseProtocol failed", e);
    return { ok: false as const, error: "Could not revise the protocol." };
  }
}
