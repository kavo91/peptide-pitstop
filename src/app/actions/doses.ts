"use server";

import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { computeDraw } from "@/lib/dosing/engine";
import { buildOralDoseRecord, isOralDoseUnit } from "@/lib/dosing/oral";
import { reconcileDoseEditRemaining } from "@/lib/dosing/recompute";
import { encryptField } from "@/lib/crypto/fieldEncryption";
import type { DoseUnit } from "@/lib/dosing/types";
import { computeRebaseSuggestion } from "@/lib/schedule/rebase-suggest";
import { plannedDayWindow, doseDeltaMinutes, pickNearestPlanned } from "@/lib/planned/match";

export interface LogDoseInput {
  protocolId?: string;
  /** Required for injection doses; omitted for oral (route === "oral"). */
  preparationId?: string;
  syringeId?: string;
  doseValue: string;
  doseUnit: DoseUnit;
  injectionSite?: string;
  notes?: string;
  takenAtISO?: string;
  clientUuid?: string;
  /** "oral" routes the dose through the prep-less / syringe-less oral path. Default injection. */
  route?: "injection" | "oral";
  /** The oral peptide being logged (oral has no prep to derive the peptide from). */
  peptideId?: string;
}

export interface LogDoseResult {
  ok: boolean;
  doseLogId?: string;
  error?: string;
  /** Set when the dose landed off its protocol's grid day (weekly only) — drives the rebase prompt. */
  rebase?: { protocolId: string; plannedDateISO: string; actualDateISO: string; suggestedDays: string[] };
}

/** The original fill volume of a preparation, used to clamp volume restoration. */
function prepFillMl(prep: { prepType: string; bacWaterMl: Decimal | null; totalMg: Decimal; concentrationMcgPerMl: Decimal }): Decimal {
  if (prep.prepType === "reconstituted" && prep.bacWaterMl) return new Decimal(prep.bacWaterMl.toString());
  // premixed (or missing bac): mass / concentration
  const conc = new Decimal(prep.concentrationMcgPerMl.toString());
  return conc.gt(0) ? new Decimal(prep.totalMg.toString()).times(1000).div(conc) : new Decimal(0);
}

/**
 * Server-authoritative dose log. Identity comes from the session (never the
 * client). Verifies the preparation/syringe belong to the user, recomputes the
 * draw from the stored prep/syringe (never trusts client maths), blocks on hard
 * guardrails, decrements the vial atomically, and audits. Idempotent by clientUuid.
 */
export async function logDose(input: LogDoseInput): Promise<LogDoseResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const clientUuid = input.clientUuid ?? randomUUID();
  const existing = await prisma.doseLog.findUnique({ where: { clientUuid } });
  if (existing) return { ok: true, doseLogId: existing.id };

  // ── ORAL / non-injection branch ─────────────────────────────────────────────
  // Oral doses have NO preparation, NO syringe, NO volume/needle maths and no
  // vial to decrement. We canonicalise the entered mass directly and write a
  // prep-less DoseLog. The protocol resolution + planned-dose linking + rebase
  // logic below mirror the injection path so scheduling/adherence work identically.
  if (input.route === "oral") {
    return logOralDose(input, user.id, clientUuid);
  }

  // Ownership-scoped lookups — reject ids that aren't the caller's.
  if (!input.preparationId) return { ok: false, error: "A preparation is required to log an injection" };
  const prep = await prisma.preparation.findFirst({ where: { id: input.preparationId, vial: { userId: user.id } }, include: { vial: true } });
  if (!prep) return { ok: false, error: "Preparation not found" };
  if (!prep.active) return { ok: false, error: "That preparation is no longer active." };

  const syringe = input.syringeId
    ? await prisma.syringe.findFirst({ where: { id: input.syringeId, OR: [{ userId: user.id }, { userId: null }] } })
    : null;
  if (!syringe) return { ok: false, error: "A syringe is required to log a dose" };

  // Resolve which protocol this dose belongs to: explicit, else infer the prep's
  // peptide's single active protocol — so ad-hoc/off-day logs still attribute and
  // can trigger a rebase (the off-cycle case where the peptide isn't carded today).
  let effectiveProtocolId = input.protocolId;
  if (effectiveProtocolId) {
    // Load (not just count) the protocol so we can assert the prep belongs to it:
    // a mismatched peptide/vial would silently attribute the dose to the wrong
    // protocol and corrupt adherence. Reject rather than guess.
    const protocol = await prisma.protocol.findFirst({ where: { id: effectiveProtocolId, userId: user.id }, select: { peptideId: true, vialId: true } });
    if (!protocol) return { ok: false, error: "Protocol not found" };
    if (protocol.peptideId !== prep.vial.peptideId) return { ok: false, error: "Preparation does not match the protocol's peptide." };
    if (protocol.vialId && protocol.vialId !== prep.vialId) return { ok: false, error: "Preparation is not the protocol's pinned vial." };
  } else {
    const vial = await prisma.vial.findUnique({ where: { id: prep.vialId } });
    if (vial) {
      const active = await prisma.protocol.findMany({ where: { userId: user.id, status: "active", peptideId: vial.peptideId } });
      if (active.length === 1) effectiveProtocolId = active[0].id;
    }
  }

  const draw = computeDraw({
    dose: { value: input.doseValue, unit: input.doseUnit },
    preparation: {
      prepType: prep.prepType as "reconstituted" | "premixed",
      concentrationMcgPerMl: new Decimal(prep.concentrationMcgPerMl.toString()),
    },
    syringe: {
      name: syringe.name,
      graduationType: syringe.graduationType as "units" | "ml",
      unitsPerMl: syringe.unitsPerMl,
      capacityMl: syringe.capacityMl.toString(),
      capacityUnits: syringe.capacityUnits,
      increment: syringe.increment.toString(),
    },
    remainingMl: prep.remainingMl.toString(),
  });

  const blocker = draw.warnings.find((w) => w.severity === "block");
  if (blocker) return { ok: false, error: blocker.message };

  const takenAt = input.takenAtISO ? new Date(input.takenAtISO) : new Date();

  const created = await prisma.$transaction(async (tx) => {
    // Link this log to the matching planned dose for the day so the cron stops
    // falsely marking logged doses as "missed" (the link was never set — a real
    // bug). Among the still-planned, unlinked slots on takenAt's day, pick the
    // one nearest in time to takenAt (e.g. an evening log links to the PM slot,
    // not the AM one) so the delta + adherence reflect the intended slot.
    let plannedDoseId: string | null = null;
    let scheduledAt: Date | null = null;
    if (effectiveProtocolId) {
      const { dayStart, dayEnd } = plannedDayWindow(takenAt);
      const candidates = await tx.plannedDose.findMany({
        where: {
          protocolId: effectiveProtocolId,
          status: "planned",
          scheduledAt: { gte: dayStart, lt: dayEnd },
          doseLog: null,
        },
      });
      const planned = pickNearestPlanned(candidates, takenAt);
      if (planned) {
        plannedDoseId = planned.id;
        scheduledAt = planned.scheduledAt;
      }
    }
    const deltaMinutes = doseDeltaMinutes(takenAt, scheduledAt);

    const log = await tx.doseLog.create({
      data: {
        userId: user.id,
        clientUuid,
        preparationId: prep.id,
        protocolId: effectiveProtocolId,
        plannedDoseId,
        scheduledAt,
        deltaMinutes,
        takenAt,
        doseMcg: draw.deliveredMassMcg.toString(),
        doseInputUnit: input.doseUnit,
        volumeMl: draw.deliveredVolumeMl.toString(),
        syringeUnits: draw.markingScale === "units" ? draw.markingValue.toString() : null,
        syringeId: syringe.id,
        injectionSite: input.injectionSite,
        source: "app",
        notes: input.notes ? encryptField(input.notes) : null,
      },
    });

    // Re-read remaining INSIDE the transaction to avoid a lost-update race.
    const fresh = await tx.preparation.findUnique({ where: { id: prep.id } });
    const current = new Decimal(fresh!.remainingMl.toString());
    const newRemaining = Decimal.max(current.minus(draw.deliveredVolumeMl), 0);
    await tx.preparation.update({ where: { id: prep.id }, data: { remainingMl: newRemaining.toString() } });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        entityType: "DoseLog",
        entityId: log.id,
        field: "create",
        oldValue: `remainingMl ${current.toString()}`,
        newValue: `${draw.deliveredMassMcg.toString()} mcg (${draw.markingValue.toString()} ${draw.markingScale}); remainingMl ${newRemaining.toString()}`,
      },
    });

    return log;
  });

  revalidatePath("/");
  revalidatePath("/inventory");

  const rebase = await computeRebaseSuggestion({ protocolId: effectiveProtocolId, userId: user.id, takenAt, matchedPlanned: created.plannedDoseId != null });
  return { ok: true, doseLogId: created.id, rebase };
}


/**
 * Log an ORAL (non-injection) dose. No preparation, no syringe, no body-site,
 * no volume/needle maths, no vial decrement. The entered mass (mcg/mg) is
 * canonicalised to mcg and a prep-less DoseLog is written with the same
 * clientUuid dedup, protocol resolution, planned-dose linking and rebase
 * suggestion the injection path uses — so scheduling + adherence work identically.
 */
async function logOralDose(input: LogDoseInput, userId: string, clientUuid: string): Promise<LogDoseResult> {
  if (!input.peptideId) return { ok: false, error: "A peptide is required to log an oral dose" };
  if (!isOralDoseUnit(input.doseUnit)) return { ok: false, error: "Oral doses must be entered in mcg or mg" };

  // Confirm the peptide is the caller's (or a shared/library row) and is oral.
  const peptide = await prisma.peptide.findFirst({ where: { id: input.peptideId, OR: [{ userId }, { userId: null }] } });
  if (!peptide) return { ok: false, error: "Peptide not found" };
  if (peptide.route !== "oral") return { ok: false, error: "That peptide is not an oral medication" };

  let oral: ReturnType<typeof buildOralDoseRecord>;
  try {
    oral = buildOralDoseRecord({ doseValue: input.doseValue, doseUnit: input.doseUnit });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid oral dose" };
  }

  // Resolve which protocol this dose belongs to (explicit, else the peptide's
  // single active protocol) — mirrors the injection path so off-day oral logs
  // still attribute + can rebase.
  let effectiveProtocolId = input.protocolId;
  if (effectiveProtocolId) {
    // Load the protocol so we can assert it actually targets this peptide —
    // otherwise an explicit, mismatched protocolId would misattribute the dose.
    const protocol = await prisma.protocol.findFirst({ where: { id: effectiveProtocolId, userId }, select: { peptideId: true } });
    if (!protocol) return { ok: false, error: "Protocol not found" };
    if (protocol.peptideId !== input.peptideId) return { ok: false, error: "Protocol does not match this peptide." };
  } else {
    const active = await prisma.protocol.findMany({ where: { userId, status: "active", peptideId: input.peptideId } });
    if (active.length === 1) effectiveProtocolId = active[0].id;
  }

  const takenAt = input.takenAtISO ? new Date(input.takenAtISO) : new Date();

  const created = await prisma.$transaction(async (tx) => {
    // Link to the matching planned dose for the day (same nearest-slot rule as injection).
    let plannedDoseId: string | null = null;
    let scheduledAt: Date | null = null;
    if (effectiveProtocolId) {
      const { dayStart, dayEnd } = plannedDayWindow(takenAt);
      const candidates = await tx.plannedDose.findMany({
        where: { protocolId: effectiveProtocolId, status: "planned", scheduledAt: { gte: dayStart, lt: dayEnd }, doseLog: null },
      });
      const planned = pickNearestPlanned(candidates, takenAt);
      if (planned) {
        plannedDoseId = planned.id;
        scheduledAt = planned.scheduledAt;
      }
    }
    const deltaMinutes = doseDeltaMinutes(takenAt, scheduledAt);

    const log = await tx.doseLog.create({
      data: {
        userId,
        clientUuid,
        preparationId: oral.preparationId,
        protocolId: effectiveProtocolId,
        plannedDoseId,
        scheduledAt,
        deltaMinutes,
        takenAt,
        doseMcg: oral.doseMcg,
        doseInputUnit: oral.doseInputUnit,
        volumeMl: oral.volumeMl,
        syringeUnits: oral.syringeUnits,
        syringeId: oral.syringeId,
        injectionSite: oral.injectionSite,
        route: oral.route,
        source: "app",
        notes: input.notes ? encryptField(input.notes) : null,
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        entityType: "DoseLog",
        entityId: log.id,
        field: "create",
        newValue: `${oral.doseMcg} mcg oral (${input.doseValue} ${input.doseUnit})`,
      },
    });

    return log;
  });

  revalidatePath("/");

  const rebase = await computeRebaseSuggestion({ protocolId: effectiveProtocolId, userId, takenAt, matchedPlanned: created.plannedDoseId != null });
  return { ok: true, doseLogId: created.id, rebase };
}

/**
 * Delete a logged dose and return its volume to the vial (clamped to the
 * preparation's original fill, so log→delete is an exact, non-inflating
 * round-trip). Identity from the session; transactional; audited.
 */
export async function deleteDoseLog(input: { id: string }): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const log = await prisma.doseLog.findUnique({ where: { id: input.id } });
  if (!log) return { ok: true };
  if (log.userId !== user.id) return { ok: false, error: "Not your dose log." };

  try {
    await prisma.$transaction(async (tx) => {
      // Delete first; only restore volume if a row was actually removed (no double-restore).
      const removed = await tx.doseLog.deleteMany({ where: { id: log.id } });
      if (removed.count === 1) {
        // Oral doses have no preparation → no vial volume to restore.
        const prep = log.preparationId
          ? await tx.preparation.findUnique({ where: { id: log.preparationId } })
          : null;
        if (prep) {
          const cap = prepFillMl(prep);
          const restored = Decimal.min(new Decimal(prep.remainingMl.toString()).plus(log.volumeMl.toString()), cap);
          await tx.preparation.update({ where: { id: prep.id }, data: { remainingMl: restored.toString() } });
        }
        await tx.auditLog.create({
          data: {
            userId: user.id,
            entityType: "DoseLog",
            entityId: log.id,
            field: "delete",
            oldValue: `${log.doseMcg.toString()} mcg @ ${log.takenAt.toISOString()}; +${log.volumeMl.toString()} mL restored`,
          },
        });
      }
    });
  } catch (e) {
    console.error("deleteDoseLog failed", e);
    return { ok: false, error: "Could not delete the dose log." };
  }

  revalidatePath("/");
  revalidatePath("/inventory");
  return { ok: true };
}

export interface EditDoseLogInput {
  id: string;
  doseValue?: string;        // if changing the drawn amount
  doseUnit?: DoseUnit;
  takenAtISO?: string;       // if changing the time
  injectionSite?: string | null;
  notes?: string | null;
}

export async function editDoseLog(input: EditDoseLogInput): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const log = await prisma.doseLog.findUnique({ where: { id: input.id }, include: { preparation: true, syringe: true } });
  if (!log) return { ok: false, error: "Dose log not found." };
  if (log.userId !== user.id) return { ok: false, error: "Not your dose log." };

  const prep = log.preparation;
  const amountChanged = input.doseValue != null && input.doseUnit != null;

  // ── ORAL edit branch ────────────────────────────────────────────────────────
  // An oral dose has no preparation, no syringe, no vial to reconcile. Editing
  // only recanonicalises the entered mass (mcg/mg → mcg), and updates time/notes.
  // injectionSite stays null (the field is hidden in the oral edit UI).
  if (!prep) {
    let oralDoseMcgStr = log.doseMcg.toString();
    let oralUnit = log.doseInputUnit;
    if (amountChanged) {
      if (!isOralDoseUnit(input.doseUnit!)) return { ok: false, error: "Oral doses must be entered in mcg or mg" };
      try {
        oralDoseMcgStr = buildOralDoseRecord({ doseValue: input.doseValue!, doseUnit: input.doseUnit! }).doseMcg;
        oralUnit = input.doseUnit!;
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Invalid oral dose" };
      }
    }
    const oralTakenAt = input.takenAtISO ? new Date(input.takenAtISO) : log.takenAt;
    const oralDelta = doseDeltaMinutes(oralTakenAt, log.scheduledAt);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.doseLog.update({
          where: { id: log.id },
          data: {
            doseInputUnit: oralUnit,
            doseMcg: oralDoseMcgStr,
            takenAt: oralTakenAt,
            deltaMinutes: oralDelta,
            notes: input.notes === undefined ? log.notes : (input.notes ? encryptField(input.notes) : null),
          },
        });
        await tx.auditLog.create({
          data: {
            userId: user.id, entityType: "DoseLog", entityId: log.id, field: "edit",
            oldValue: `${log.doseMcg.toString()} mcg oral @ ${log.takenAt.toISOString()}`,
            newValue: `${oralDoseMcgStr} mcg oral @ ${oralTakenAt.toISOString()}`,
          },
        });
      });
    } catch (e) {
      console.error("editDoseLog (oral) failed", e);
      return { ok: false, error: "Could not save the edit." };
    }
    revalidatePath("/"); revalidatePath("/doses"); revalidatePath("/analytics");
    return { ok: true };
  }

  let newVolumeMl = new Decimal(log.volumeMl.toString());
  let newDoseMcg = new Decimal(log.doseMcg.toString());
  let newSyringeUnits = log.syringeUnits;

  if (amountChanged) {
    if (!log.syringe) return { ok: false, error: "Original syringe missing; cannot recompute draw." };
    let draw;
    try {
      draw = computeDraw({
        dose: { value: input.doseValue!, unit: input.doseUnit! },
        preparation: { prepType: prep.prepType as "reconstituted" | "premixed", concentrationMcgPerMl: new Decimal(prep.concentrationMcgPerMl.toString()) },
        syringe: {
          name: log.syringe.name, graduationType: log.syringe.graduationType as "units" | "ml",
          unitsPerMl: log.syringe.unitsPerMl, capacityMl: log.syringe.capacityMl.toString(),
          capacityUnits: log.syringe.capacityUnits, increment: log.syringe.increment.toString(),
        },
      });
    } catch {
      return { ok: false, error: "Could not compute the draw for that amount." };
    }
    newVolumeMl = draw.deliveredVolumeMl;
    newDoseMcg = draw.deliveredMassMcg;
    newSyringeUnits = draw.markingScale === "units" ? new Decimal(draw.markingValue.toString()) : null;
  }

  const takenAt = input.takenAtISO ? new Date(input.takenAtISO) : log.takenAt;
  const deltaMinutes = doseDeltaMinutes(takenAt, log.scheduledAt);

  const remaining = reconcileDoseEditRemaining({
    remainingMl: prep.remainingMl.toString(),
    oldVolumeMl: log.volumeMl.toString(),
    newVolumeMl: newVolumeMl.toString(),
    fillCapMl: prepFillMl(prep).toString(),
  });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.doseLog.update({
        where: { id: log.id },
        data: {
          doseInputUnit: input.doseUnit ?? log.doseInputUnit,
          doseMcg: newDoseMcg.toString(),
          volumeMl: newVolumeMl.toString(),
          syringeUnits: newSyringeUnits ? newSyringeUnits.toString() : null,
          takenAt,
          deltaMinutes,
          injectionSite: input.injectionSite === undefined ? log.injectionSite : input.injectionSite,
          notes: input.notes === undefined ? log.notes : (input.notes ? encryptField(input.notes) : null),
        },
      });
      await tx.preparation.update({ where: { id: prep.id }, data: { remainingMl: remaining.remainingMl } });
      await tx.auditLog.create({
        data: {
          userId: user.id, entityType: "DoseLog", entityId: log.id, field: "edit",
          oldValue: `${log.doseMcg.toString()} mcg / ${log.volumeMl.toString()} mL @ ${log.takenAt.toISOString()}`,
          newValue: `${newDoseMcg.toString()} mcg / ${newVolumeMl.toString()} mL @ ${takenAt.toISOString()}; remaining ${remaining.remainingMl} mL`,
        },
      });
    });
  } catch (e) {
    console.error("editDoseLog failed", e);
    return { ok: false, error: "Could not save the edit." };
  }

  revalidatePath("/"); revalidatePath("/inventory"); revalidatePath("/doses"); revalidatePath("/analytics");
  return { ok: true };
}
