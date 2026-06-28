"use server";

import { revalidatePath } from "next/cache";
import Decimal from "decimal.js";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { PEPTIDE_LIBRARY } from "@/lib/peptide-library";
import { vialLabelStrengthMg, perInjectionMcg, DAILY_SCHEDULE_RULE } from "@/lib/stacks/compute";
import { normaliseScheduleRule } from "@/lib/schedule/normalise";
import { encryptField } from "@/lib/crypto/fieldEncryption";
import { getTodayDoses } from "@/lib/today";
import { peptideTokens } from "@/lib/stacks/server";
import { logDose } from "./doses";

// getStacks (a data reader) + its stack-view types now live in a server-only lib
// module, since a "use server" module should export only server actions. Re-export
// the types here so existing importers (e.g. components/StackCard) keep working.
export type { StackComponentView, StackPrescriptionView, StackView } from "@/lib/stacks/server";

/** Optional positive-int string → number | null. */
function optInt(v?: string): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Math.floor(Number(s));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
/** Optional finite-decimal string → string | null (kept as string for Prisma Decimal). */
function optDecimal(v?: string): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  return Number.isFinite(Number(s)) ? s : null;
}
/** "yyyy-mm-dd" → UTC-midnight Date | null (matches the app's date-only storage). */
function utcDate(v?: string): Date | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export interface StackComponentInput {
  peptideName: string;
  concentrationMcgPerMl: string; // premixed
  vialSizeMl: string;
  qty: string; // integer ≥ 1
  doseMl: string;
}
export interface CreateStackInput {
  name: string;
  components: StackComponentInput[];
}

/** Strict whole-vial quantity: a positive integer (>= 1) → number, else null.
 *  Rejects blanks, non-finite, zero/negative, and non-integers (e.g. "2.7")
 *  instead of silently flooring/defaulting them to 1. */
const positiveInt = (v: string): number | null => {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 ? n : null;
};

/** True when the dose-ml string parses to a strictly-positive Decimal (mirrors compute.pos). */
const positiveDose = (v: string): boolean => {
  const s = (v ?? "").trim();
  if (!s) return false;
  try {
    const d = new Decimal(s);
    return d.isFinite() && d.gt(0);
  } catch {
    return false;
  }
};

/**
 * Ensure a peptide exists for this user; match by name OR alias (case-insensitive),
 * preferring the user's own peptide over a shared library row, so e.g. picking
 * "TB-500" resolves to an owned "Thymosin Beta-4" instead of creating a duplicate.
 * Creates from the library entry (or a minimal injectable mass peptide) when none match.
 */
async function ensurePeptide(tx: Prisma.TransactionClient, userId: string, name: string): Promise<string> {
  const trimmed = name.trim();
  const lc = trimmed.toLowerCase();
  const candidates = await tx.peptide.findMany({ where: { OR: [{ userId }, { userId: null }] } });
  const owned = candidates.find((c) => c.userId === userId && peptideTokens(c).includes(lc));
  const shared = candidates.find((c) => peptideTokens(c).includes(lc));
  const existing = owned ?? shared;
  if (existing) return existing.id;
  const lib = PEPTIDE_LIBRARY.find((e) => e.name.toLowerCase() === lc);
  const created = await tx.peptide.create({
    data: {
      userId,
      name: trimmed,
      aliases: lib?.aliases ?? null,
      category: lib?.category ?? null,
      substanceClass: lib?.substanceClass ?? "mass",
      halfLifeHours: lib?.halfLifeHours ?? null,
      storageNotes: lib?.storageNotes ?? null,
      route: "injection",
    },
  });
  return created.id;
}

/**
 * Create a stack: for each premixed component, ensure the peptide, create qty
 * vials (first in_use, rest sealed), a premixed Preparation on the first vial,
 * and a daily ml-dosed Protocol — all linked under one Stack. Transactional:
 * any component failure rolls the whole stack back (no orphan rows).
 */
export async function createStack(input: CreateStackInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Give the stack a name." };

  const valid = (input.components ?? []).filter(
    (c) =>
      c.peptideName?.trim() &&
      vialLabelStrengthMg(c.concentrationMcgPerMl, c.vialSizeMl) &&
      perInjectionMcg(c.doseMl, c.concentrationMcgPerMl) &&
      positiveDose(c.doseMl), // reject a zero dose (perInjectionMcg accepts 0)
  );
  if (valid.length === 0) return { ok: false as const, error: "Add at least one component with a concentration and positive dose." };

  // Reject degenerate input BEFORE the transaction instead of silently clamping.
  if (valid.length > 20) return { ok: false as const, error: "A stack can have at most 20 components." };
  // Each qty must be a positive integer — reject (don't silently default to 1).
  const qtys = valid.map((c) => positiveInt(c.qty));
  if (qtys.some((q) => q === null)) return { ok: false as const, error: "Each component needs a whole vial quantity of 1 or more." };
  if (qtys.some((q) => q! > 50)) return { ok: false as const, error: "Each component can have at most 50 vials." };

  try {
    const stackId = await prisma.$transaction(async (tx) => {
      const stack = await tx.stack.create({ data: { userId: user.id, name } });
      const seenPeptideIds = new Set<string>();
      for (const c of valid) {
        const peptideId = await ensurePeptide(tx, user.id, c.peptideName);
        // Dedupe by RESOLVED peptide — two components mapping to one peptide would
        // otherwise create duplicate protocols/vials for it. Abort (rolls back).
        if (seenPeptideIds.has(peptideId)) {
          throw new Error("This stack has two components for the same peptide.");
        }
        seenPeptideIds.add(peptideId);
        const labelMg = vialLabelStrengthMg(c.concentrationMcgPerMl, c.vialSizeMl)!;
        const qty = positiveInt(c.qty)!; // validated as a positive integer above
        let pinnedVialId: string | null = null;
        for (let i = 0; i < qty; i++) {
          const vial = await tx.vial.create({
            data: {
              userId: user.id,
              peptideId,
              labelStrengthMg: labelMg,
              status: i === 0 ? "in_use" : "sealed",
            },
          });
          if (i === 0) {
            pinnedVialId = vial.id;
            await tx.preparation.create({
              data: {
                vialId: vial.id,
                prepType: "premixed",
                bacWaterMl: null,
                totalMg: labelMg,
                concentrationMcgPerMl: c.concentrationMcgPerMl,
                remainingMl: c.vialSizeMl,
                active: true,
              },
            });
          }
        }
        await tx.protocol.create({
          data: {
            userId: user.id,
            peptideId,
            stackId: stack.id,
            vialId: pinnedVialId, // pin the in-use vial so resolution can't pick a sibling
            name: `${c.peptideName.trim()} (stack)`,
            source: "manual",
            scheduleType: "fixed_times",
            scheduleRule: DAILY_SCHEDULE_RULE,
            targetDose: c.doseMl,
            doseInputUnit: "ml",
            doseBasis: "per_injection",
            status: "active",
          },
        });
      }
      return stack.id;
    });
    revalidatePath("/settings");
    revalidatePath("/inventory");
    revalidatePath("/protocols");
    revalidatePath("/today");
    return { ok: true as const, stackId };
  } catch (e) {
    console.error("createStack failed", e);
    // Surface the deliberate duplicate-peptide abort; mask any other failure.
    const error = e instanceof Error && /same peptide/.test(e.message) ? e.message : "Could not create the stack.";
    return { ok: false as const, error };
  }
}

/**
 * Log today's dose for every component of a stack via the existing logDose path
 * (so depletion / doseMcg are identical to logging each individually). Skips
 * components already logged today — idempotent for the day.
 */
export async function logStack(stackId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const stack = await prisma.stack.findFirst({
    where: { id: stackId, userId: user.id },
    include: { protocols: true },
  });
  if (!stack) return { ok: false as const, error: "Stack not found." };

  // Only log components actually DUE today — reuse the same authority that
  // drives the today view (getTodayDoses applies the start/end window, the
  // schedule, and override rebasing). A component whose protocol has not started
  // or is not scheduled for today is skipped, never logged.
  const dueProtocolIds = new Set((await getTodayDoses(user.id)).map((d) => d.protocolId));

  // Stack components are premixed injections, so every logDose call needs a
  // syringe (logDose returns ok:false without one). Resolve the user's default
  // syringe once — same selection the log forms use (own-or-shared, name asc).
  const syringe = await prisma.syringe.findFirst({
    where: { OR: [{ userId: user.id }, { userId: null }] },
    orderBy: { name: "asc" },
  });
  if (!syringe) return { ok: false as const, error: "Add a syringe before logging a stack." };

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const nextDay = new Date(startOfDay.getTime() + 86_400_000);
  const dayKey = startOfDay.toISOString().slice(0, 10);

  let logged = 0;
  let firstError: string | null = null;
  for (const p of stack.protocols) {
    if (!dueProtocolIds.has(p.id)) {
      firstError ??= "No components are due today.";
      continue;
    }
    const already = await prisma.doseLog.count({
      where: { protocolId: p.id, userId: user.id, takenAt: { gte: startOfDay, lt: nextDay } },
    });
    if (already > 0) {
      firstError ??= "Already logged today.";
      continue;
    }
    const prep = await prisma.preparation.findFirst({
      // Prefer the pinned vial; legacy rows (null vialId) fall back to peptideId.
      where: p.vialId ? { active: true, vialId: p.vialId } : { active: true, vial: { peptideId: p.peptideId, userId: user.id } },
      orderBy: { reconstitutedAt: "desc" },
    });
    if (!prep) {
      firstError ??= "No active preparation for a stack component.";
      continue;
    }
    const res = await logDose({
      protocolId: p.id,
      preparationId: prep.id,
      syringeId: syringe.id,
      doseValue: p.targetDose?.toString() ?? "0",
      doseUnit: "ml",
      clientUuid: `stack-${stackId}-${p.id}-${dayKey}`,
    });
    if (res.ok) logged++;
    else firstError ??= res.error ?? "Could not log a stack component.";
  }
  revalidatePath("/today");
  revalidatePath("/settings");
  // Keep the ok-true contract, but surface the first real reason when nothing
  // got logged so the UI can explain the no-op instead of a bland "Logged 0".
  return logged > 0
    ? { ok: true as const, logged }
    : { ok: true as const, logged, error: firstError ?? "Nothing to log." };
}

export interface StackPrescriptionInput {
  stackId: string;
  source?: string;
  prescriber?: string;
  pharmacy?: string;
  doseInstructions?: string;
  refillsAuthorized?: string;
  refillsRemaining?: string;
  nextRefill?: string; // yyyy-mm-dd
  expiration?: string; // yyyy-mm-dd
  dateWritten?: string; // yyyy-mm-dd
  cost?: string;
  quantity?: string;
  leadTimeDays?: string;
}

/** The active premixed vial ids for a stack's components (one per protocol's pinned/peptide vial). */
async function stackComponentVialIds(userId: string, protocols: { peptideId: string; vialId: string | null }[]): Promise<string[]> {
  const ids: string[] = [];
  for (const p of protocols) {
    const prep = await prisma.preparation.findFirst({
      // Prefer the pinned vial; legacy rows (null vialId) fall back to peptideId.
      where: p.vialId ? { active: true, vialId: p.vialId } : { active: true, vial: { peptideId: p.peptideId, userId } },
      orderBy: { reconstitutedAt: "desc" },
      include: { vial: true },
    });
    if (prep?.vial) ids.push(prep.vial.id);
  }
  return [...new Set(ids)];
}

/**
 * Record ONE grouped prescription covering a whole stack: a single Prescription
 * (stackId set, peptideId null) linked to every component vial. Idempotent —
 * updates the stack's existing grouped prescription if present. Relinking the
 * vials supersedes any per-peptide prescriptions they had; those are deleted
 * when they end up with no vials and no protocols (clean consolidation).
 */
export async function addStackPrescription(input: StackPrescriptionInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const stack = await prisma.stack.findFirst({
    where: { id: input.stackId, userId: user.id },
    include: { protocols: true },
  });
  if (!stack) return { ok: false as const, error: "Stack not found." };

  const vialIds = await stackComponentVialIds(user.id, stack.protocols);

  // Only write fields the form actually provided, so editing (e.g.) the refill
  // count never wipes the encrypted prescriber/pharmacy/dose-instructions.
  const data: Record<string, unknown> = {};
  const txt = (v?: string) => (v ?? "").trim();
  if (txt(input.source)) data.source = txt(input.source);
  if (txt(input.prescriber)) data.prescriber = encryptField(txt(input.prescriber));
  if (txt(input.pharmacy)) data.pharmacy = encryptField(txt(input.pharmacy));
  if (txt(input.doseInstructions)) data.doseInstructions = encryptField(txt(input.doseInstructions));
  if (txt(input.refillsAuthorized)) data.refillsAuthorized = optInt(input.refillsAuthorized);
  if (txt(input.refillsRemaining)) data.refillsRemaining = optInt(input.refillsRemaining);
  if (txt(input.nextRefill)) data.nextRefill = utcDate(input.nextRefill);
  if (txt(input.expiration)) data.expiration = utcDate(input.expiration);
  if (txt(input.dateWritten)) data.dateWritten = utcDate(input.dateWritten);
  if (txt(input.cost)) data.cost = optDecimal(input.cost);
  if (txt(input.quantity)) data.quantity = optInt(input.quantity);
  if (txt(input.leadTimeDays)) data.leadTimeDays = optInt(input.leadTimeDays);

  try {
    // Prescription ids currently on the stack's vials — candidates to clean up.
    const oldRxIds = [
      ...new Set(
        (await prisma.vial.findMany({ where: { id: { in: vialIds }, prescriptionId: { not: null } }, select: { prescriptionId: true } }))
          .map((v) => v.prescriptionId!)
          .filter(Boolean),
      ),
    ];

    const existing = await prisma.prescription.findFirst({ where: { stackId: stack.id, userId: user.id } });
    let prescriptionId: string;
    if (existing) {
      await prisma.prescription.update({ where: { id: existing.id }, data: data as Prisma.PrescriptionUncheckedUpdateInput });
      prescriptionId = existing.id;
    } else {
      const created = await prisma.prescription.create({
        data: { ...data, userId: user.id, stackId: stack.id, peptideId: null } as Prisma.PrescriptionUncheckedCreateInput,
      });
      prescriptionId = created.id;
    }

    if (vialIds.length) {
      await prisma.vial.updateMany({ where: { id: { in: vialIds }, userId: user.id }, data: { prescriptionId } });
    }

    // Consolidate: drop superseded per-peptide prescriptions now orphaned.
    for (const oldId of oldRxIds) {
      if (oldId === prescriptionId) continue;
      const [vc, pc] = await Promise.all([
        prisma.vial.count({ where: { prescriptionId: oldId } }),
        prisma.protocol.count({ where: { prescriptionId: oldId } }),
      ]);
      if (vc === 0 && pc === 0) await prisma.prescription.delete({ where: { id: oldId } });
    }

    revalidatePath("/settings");
    revalidatePath("/today");
    revalidatePath("/prescriptions");
    revalidatePath("/inventory");
    return { ok: true as const, prescriptionId };
  } catch (e) {
    console.error("addStackPrescription failed", e);
    return { ok: false as const, error: "Could not save the prescription." };
  }
}

/**
 * Permanently delete a stack and its component PROTOCOLS, while PRESERVING dose
 * history and inventory. Mirrors deleteProtocol's contract per component:
 * logged doses are detached (protocolId → null) and kept; planned doses and
 * titration steps — which only describe the now-deleted schedule — are removed.
 * Inventory survives untouched: Vials are unlinked from the stack's grouped
 * prescription (prescriptionId → null) and the Preparations on them are NEVER
 * deleted. Only the grouped Prescription row and the Stack row are removed.
 *
 * The schema has ZERO onDelete clauses, so every FK is implicit RESTRICT — each
 * child is hand-cleared inside ONE transaction before its parent, or the delete
 * throws (and rolls back, leaving the stack intact). Ownership-scoped at every
 * level; audited; no redirect.
 *
 * Cascade order (every child write scoped by userId where the column exists):
 *   (a) component protocols — SAME cascade as deleteProtocol:
 *       1. DoseLog.protocolId → null        (PRESERVE history; do NOT delete logs)
 *       2. DoseLog.plannedDoseId → null     (break the 1-1 link before PlannedDose dies)
 *       3. delete PlannedDose (by protocol ids)
 *       4. delete ProtocolStep (by protocol ids)
 *       5. delete Protocol (by stackId + userId)
 *   (b) grouped prescriptions — PRESERVE inventory:
 *       1. Vial.prescriptionId → null       (keep the vials + their preparations)
 *       2. Protocol.prescriptionId → null   (defensive: unlink any stray protocol still pointing here)
 *       3. delete Prescription (by stackId + userId)
 *   (c) delete the Stack (by id + userId)
 *   (d) auditLog (field: "delete")
 */
export async function deleteStack(stackId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  // Ownership check — only the caller's stack. Missing → safe no-op.
  const stack = await prisma.stack.findFirst({
    where: { id: stackId, userId: user.id },
    include: { prescriptions: { select: { id: true } } },
  });
  if (!stack) return { ok: true as const };

  // Derive protocol ids from an explicitly userId-scoped query (not the stack
  // include) so every child write below is unconditionally the caller's own —
  // ProtocolStep has no userId column, so this is its only ownership guarantee.
  const protocolIds = (
    await prisma.protocol.findMany({ where: { stackId: stack.id, userId: user.id }, select: { id: true } })
  ).map((p) => p.id);
  const prescriptionIds = stack.prescriptions.map((rx) => rx.id);

  try {
    await prisma.$transaction(async (tx) => {
      // (a) Component protocols — per-component, this is deleteProtocol's cascade.
      if (protocolIds.length) {
        // 1. Preserve dose history: detach logs from these protocols (keep the logs).
        await tx.doseLog.updateMany({
          where: { protocolId: { in: protocolIds }, userId: user.id },
          data: { protocolId: null },
        });
        // 2. Drop the 1-1 DoseLog → PlannedDose link before the PlannedDose dies.
        const plannedIds = (
          await tx.plannedDose.findMany({ where: { protocolId: { in: protocolIds } }, select: { id: true } })
        ).map((p) => p.id);
        if (plannedIds.length) {
          await tx.doseLog.updateMany({
            where: { plannedDoseId: { in: plannedIds }, userId: user.id },
            data: { plannedDoseId: null },
          });
        }
        // 3. + 4. Remove the schedule's planned doses and titration steps.
        await tx.plannedDose.deleteMany({ where: { protocolId: { in: protocolIds }, userId: user.id } });
        await tx.protocolStep.deleteMany({ where: { protocolId: { in: protocolIds } } });
      }
      // 5. Delete the component protocols (ownership-scoped) — done BEFORE the
      //    grouped prescription so no protocol still RESTRICT-references it.
      await tx.protocol.deleteMany({ where: { stackId: stack.id, userId: user.id } });

      // (b) Grouped prescriptions — preserve inventory, then remove the script.
      if (prescriptionIds.length) {
        // 1. Keep the vials + their preparations; just unlink them.
        await tx.vial.updateMany({
          where: { prescriptionId: { in: prescriptionIds }, userId: user.id },
          data: { prescriptionId: null },
        });
        // 2. Defensive: unlink any stray protocol still pointing at these scripts
        //    (stack protocols are already gone; this preserves any other protocol).
        await tx.protocol.updateMany({
          where: { prescriptionId: { in: prescriptionIds }, userId: user.id },
          data: { prescriptionId: null },
        });
      }
      await tx.prescription.deleteMany({ where: { stackId: stack.id, userId: user.id } });

      // (c) Delete the stack itself (ownership-scoped).
      await tx.stack.deleteMany({ where: { id: stack.id, userId: user.id } });

      // (d) Audit.
      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "Stack",
          entityId: stack.id,
          field: "delete",
          oldValue: stack.name,
          newValue: `deleted: ${protocolIds.length} protocols removed (logs kept); ${prescriptionIds.length} grouped prescriptions removed; vials + preparations preserved`,
        },
      });
    });
  } catch (e) {
    console.error("deleteStack failed", e);
    return { ok: false as const, error: "Could not delete the stack." };
  }

  revalidatePath("/settings");
  revalidatePath("/today");
  revalidatePath("/protocols");
  revalidatePath("/inventory");
  return { ok: true as const };
}

/**
 * Update the schedule for a whole stack: writes the same scheduleRule (and, when
 * provided, startDate) to EVERY component protocol so the stack stays in sync.
 * Ownership-scoped. The rule is validated + canonicalised by normaliseScheduleRule
 * — the same single entry point saveProtocol/updateProtocol use — so a malformed/
 * empty rule is rejected and the stored string is always canonical JSON entries
 * (matches ProtocolForm, which persists JSON.stringify(entries)).
 *
 * `startDate` is "yyyy-mm-dd" (or "" to clear). When the argument is omitted,
 * startDate is left untouched.
 */
export async function updateStackSchedule(stackId: string, scheduleRule: string, startDate?: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const stack = await prisma.stack.findFirst({ where: { id: stackId, userId: user.id } });
  if (!stack) return { ok: false as const, error: "Stack not found." };

  // Resolve the EFFECTIVE startDate the rule will run against: the passed value
  // when supplied ("" clears it), else the existing component anchor (so an
  // interval/cycle rule isn't falsely flagged never-due when an anchor is kept).
  let effectiveStart: string | Date | null;
  if (startDate !== undefined) {
    effectiveStart = utcDate(startDate);
  } else {
    const existing = await prisma.protocol.findFirst({
      where: { stackId: stack.id, userId: user.id },
      select: { startDate: true },
    });
    effectiveStart = existing?.startDate ?? null;
  }

  // Strict validation (the editor blocks these, but a direct POST must not write a
  // never-due / malformed rule): unknown kind, weekly with no/invalid days,
  // interval/cycle with non-positive counts, or interval/cycle with no startDate.
  const norm = normaliseScheduleRule(scheduleRule, effectiveStart);
  if (!norm.ok) return { ok: false as const, error: norm.error };
  const rule = norm.rule;

  try {
    await prisma.protocol.updateMany({
      where: { stackId: stack.id, userId: user.id },
      data: {
        scheduleRule: rule,
        // Only touch startDate when the caller passed the argument; "" clears it.
        ...(startDate !== undefined ? { startDate: utcDate(startDate) } : {}),
      },
    });
  } catch (e) {
    console.error("updateStackSchedule failed", e);
    return { ok: false as const, error: "Could not update the schedule." };
  }

  revalidatePath("/today");
  revalidatePath("/settings");
  revalidatePath("/protocols");
  return { ok: true as const };
}
