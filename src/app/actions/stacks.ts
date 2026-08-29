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
import { resolveTrackingDayStamp, dayAnchor } from "@/lib/tz-day";
import { localDayOf } from "@/lib/local-day";
import { generateRamp, type GeneratedStep } from "@/lib/titration/generate-ramp";
import { runPlannedDoseGeneration } from "@/lib/planned/run";
import { peptideTokens } from "@/lib/stacks/server";
import { courseTips, courseGroupIds, type LineageProtocol } from "@/lib/stacks/lineage";
import { logDose } from "./doses";
import type { DoseUnit } from "@/lib/dosing/types";

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

export interface StackRampInput {
  startDose: string;
  targetDose: string;
  increment: string;
  weeksPerStep: string;
  doseInputUnit: string; // whitelisted to mcg|mg|ml|units, else coerced to mcg
}
export interface StackComponentInput {
  peptideName: string;
  concentrationMcgPerMl: string; // premixed
  vialSizeMl: string;
  qty: string; // integer ≥ 1
  doseMl: string;
  /** Optional creation-time titration ladder; requires CreateStackInput.startDateISO. */
  ramp?: StackRampInput;
}
export interface CreateStackInput {
  name: string;
  components: StackComponentInput[];
  /**
   * Stack start date (yyyy-mm-dd), written to EVERY component protocol —
   * components share one schedule. REQUIRED when any component carries a ramp:
   * the resolver treats a ladder without startDate as inert (resolve.ts:23),
   * and an inert ladder that later springs to life on an unrelated schedule
   * edit is a surprise dose change.
   */
  startDateISO?: string;
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

  // Titration ramps: generate + validate BEFORE the transaction so a bad ramp
  // refuses the whole stack with the component named (refuse, never clamp).
  const startDate = utcDate(input.startDateISO);
  const rampSteps = new Map<StackComponentInput, GeneratedStep[]>();
  for (const c of valid) {
    if (!c.ramp) continue;
    if (!startDate) {
      return { ok: false as const, error: "A titration ramp needs a stack start date." };
    }
    // "units" is syringe-relative and stack logging is one-button with no
    // syringe picker — the dose's meaning would depend on whichever syringe
    // sorts first. Refuse (mirror guard in logStack for ladders added later).
    if (c.ramp.doseInputUnit === "units") {
      return { ok: false as const, error: `${c.peptideName.trim()}: units ladders aren't supported for stacks — use mcg, mg or ml.` };
    }
    const unit = ["mcg", "mg", "ml"].includes(c.ramp.doseInputUnit) ? c.ramp.doseInputUnit : "mcg";
    try {
      rampSteps.set(
        c,
        generateRamp({
          startDose: c.ramp.startDose,
          targetDose: c.ramp.targetDose,
          increment: c.ramp.increment,
          weeksPerStep: Number(c.ramp.weeksPerStep),
          doseInputUnit: unit as "mcg" | "mg" | "ml" | "units",
        }),
      );
    } catch (e) {
      const why = e instanceof Error ? e.message : "invalid ramp";
      return { ok: false as const, error: `${c.peptideName.trim()}: ${why}` };
    }
  }

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
        const steps = rampSteps.get(c);
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
            // One shared schedule: when a start date is given it goes on EVERY
            // component (ramped or not) — updateStackSchedule keeps them in
            // sync the same way, and getStacks reads it off the first.
            ...(startDate ? { startDate } : {}),
            // Contiguous stepIndex 0..n-1 with a null-duration final
            // maintenance step, straight from generateRamp.
            ...(steps
              ? {
                  steps: {
                    create: steps.map((g) => ({
                      stepIndex: g.stepIndex,
                      dose: g.dose,
                      doseInputUnit: g.doseInputUnit,
                      durationDays: g.durationDays,
                    })),
                  },
                }
              : {}),
          },
        });
      }
      return stack.id;
    });
    // A start date makes the protocols generate planned rows — materialise now
    // (same trigger discipline as updateStackSchedule). The stack is already
    // COMMITTED: a generation hiccup must not report creation failure (a retry
    // would duplicate the stack) — the daily tick / next save regenerates.
    if (startDate) {
      try {
        await runPlannedDoseGeneration(user.id);
      } catch (e) {
        console.error("createStack: planned-dose generation failed post-commit (self-heals on next run)", e);
      }
    }
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
export async function logStack(stackId: string, stamp?: { localDay?: string; tz?: string }) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const stack = await prisma.stack.findFirst({
    where: { id: stackId, userId: user.id },
    include: { protocols: true },
  });
  if (!stack) return { ok: false as const, error: "Stack not found." };

  // Validate the client stamp first — "today" below must be the SAME day the
  // /today page used to show the button, or the page (viewer day) and this
  // action (runtime day) disagree for ~14 h/day while travelling: the due
  // check would refuse a legitimately shown stack, and the dedup window would
  // let a second tap double-log across the runtime midnight.
  const loggedAt = new Date();
  const { localDay: stampDay, tz: stampTz } = resolveTrackingDayStamp(stamp ?? {}, loggedAt);
  const dayRef = stampDay ? dayAnchor(stampDay) : loggedAt;

  // Only log components actually DUE today — reuse the same authority that
  // drives the today view (getTodayDoses applies the start/end window, the
  // schedule, and override rebasing). A component whose protocol has not started
  // or is not scheduled for today is skipped, never logged. The item ALSO
  // carries the resolver's per-slot dose (spec §6) — the only legitimate dose
  // source now that a stack component may carry a titration ladder; first slot
  // per protocol wins (stacks are single-slot daily).
  const dueByProtocol = new Map<string, { doseValue: string; doseUnit: DoseUnit }>();
  for (const d of await getTodayDoses(user.id, dayRef, loggedAt)) {
    if (!dueByProtocol.has(d.protocolId)) dueByProtocol.set(d.protocolId, { doseValue: d.doseValue, doseUnit: d.doseUnit });
  }

  // Stack components are premixed injections, so every logDose call needs a
  // syringe (logDose returns ok:false without one). The user's PREFERRED
  // device wins; only without one fall back to the alphabetical own-or-shared
  // pick (the old behaviour, kept for users who never set a default).
  const pref = (await prisma.user.findUnique({ where: { id: user.id }, select: { defaultSyringeId: true } }))?.defaultSyringeId;
  const syringe =
    (pref
      ? await prisma.syringe.findFirst({ where: { id: pref, OR: [{ userId: user.id }, { userId: null }] } })
      : null) ??
    (await prisma.syringe.findFirst({
      where: { OR: [{ userId: user.id }, { userId: null }] },
      orderBy: { name: "asc" },
    }));
  if (!syringe) return { ok: false as const, error: "Add a syringe before logging a stack." };

  const startOfDay = new Date(dayRef);
  startOfDay.setHours(0, 0, 0, 0);
  const nextDay = new Date(startOfDay.getTime() + 86_400_000);
  // Idempotency-key day: the stamped viewer day when present (legacy
  // expression otherwise). A key change across the deploy boundary is safe —
  // the already-logged count below still dedups.
  // localDayOf, not .toISOString(): startOfDay is LOCAL midnight (setHours
  // above), whose UTC day is the PREVIOUS one east of Greenwich — in Brisbane
  // this key named yesterday. Only the legacy fallback path (stampDay absent)
  // was affected, and the already-logged count below still dedups, so no row
  // was ever double-written; the key was simply mislabelled.
  const dayKey = stampDay ?? localDayOf(startOfDay);

  let logged = 0;
  let firstError: string | null = null;
  // Course TIPS only — a revised component's completed predecessor stays in the
  // stack; logging must see exactly one protocol per peptide course.
  const lineage = stack.protocols as (typeof stack.protocols[number] & LineageProtocol)[];
  for (const p of courseTips(lineage)) {
    const due = dueByProtocol.get(p.id);
    if (!due) {
      firstError ??= "No components are due today.";
      continue;
    }
    // Resolver fail-safe: an unresolvable frequency yields "" (the today card
    // disables submit for the same reason). Never substitute targetDose here —
    // that is the raw-value-reaches-a-dose-path overdose class of bug.
    if (due.doseValue === "") {
      firstError ??= "Dose unresolvable for a stack component — not logged.";
      continue;
    }
    // "units" is syringe-relative (volume = units / unitsPerMl) and this
    // one-button path has no syringe picker — an alphabetically-first syringe
    // would silently define the dose. Refuse rather than guess.
    if (due.doseUnit === "units") {
      firstError ??= "A stack component doses in syringe units — log it individually (units depend on the syringe).";
      continue;
    }
    // Already-logged dedup on the SAME day bucket the views use: stamped rows
    // by localDay, legacy rows by the instant window of that day.
    // Dedup across the WHOLE course lineage, not just this protocol id: on the
    // day a component is revised, the predecessor may already hold today's dose
    // — the successor must not log the same peptide again ("idempotent for the
    // day" is a per-course contract).
    const groupIds = courseGroupIds(lineage, p);
    const already = await prisma.doseLog.count({
      where: stampDay
        ? {
            protocolId: { in: groupIds },
            userId: user.id,
            OR: [{ localDay: stampDay }, { localDay: null, takenAt: { gte: startOfDay, lt: nextDay } }],
          }
        : { protocolId: { in: groupIds }, userId: user.id, takenAt: { gte: startOfDay, lt: nextDay } },
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
      doseValue: due.doseValue,
      doseUnit: due.doseUnit,
      // Device-local day/zone from the StackCard client — same travel-proof
      // stamp the individual log forms send (already validated above; logDose
      // re-validates against its own takenAt).
      localDay: stampDay ?? undefined,
      tz: stampTz ?? undefined,
      takenAtISO: loggedAt.toISOString(),
      clientUuid: `stack-${stackId}-${p.id}-${dayKey}`,
    });
    if (res.ok) logged++;
    else firstError ??= res.error ?? "Could not log a stack component.";
  }
  revalidatePath("/today");
  revalidatePath("/settings");
  // Keep the ok-true contract, but surface the first real reason when nothing
  // got logged so the UI can explain the no-op instead of a bland "Logged 0".
  // Surface the first per-component problem even when others logged — a
  // silently-skipped component otherwise just stops being recorded.
  return logged > 0
    ? { ok: true as const, logged, ...(firstError ? { error: firstError } : {}) }
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

  // Material-change guard (same principle as assertNoScheduleRewrite): a
  // titrating component's phase targets are DERIVED from the schedule frequency
  // (durationDays × injectionsPerWeek → dose counts), so rewriting the rule or
  // start under delivered doses silently re-times every phase and rewrites the
  // historical adherence display. An echoed unchanged schedule passes through.
  const allComps = await prisma.protocol.findMany({
    where: { stackId: stack.id, userId: user.id },
    select: { id: true, courseId: true, status: true, scheduleRule: true, startDate: true, _count: { select: { steps: true, doseLogs: true } } },
  });
  // Course TIPS only: a revised-out predecessor is frozen history — comparing
  // against its rule falsely flags an echo as a change, its old steps+logs
  // would lock the schedule forever, and writing to it retro-edits a closed
  // course (the exact rewrite reviseProtocol exists to prevent).
  const comps = courseTips(allComps);
  const newStart = startDate !== undefined ? utcDate(startDate) : undefined;

  // A ladder without a start date is inert (resolve.ts:23) — clearing (or
  // typo-ing: utcDate treats malformed as null) the date on a ramped stack
  // silently downgrades every titrating component to its flat targetDose.
  const anySteps = comps.some((c) => c._count.steps > 0);
  if (startDate !== undefined && newStart === null && anySteps) {
    return {
      ok: false as const,
      error: "Components carry titration ladders — a valid start date is required (clearing it would silently disable the ramps).",
    };
  }

  const ruleChanged = comps.some((c) => c.scheduleRule !== rule);
  const startChanged =
    newStart !== undefined && comps.some((c) => (c.startDate?.getTime() ?? null) !== (newStart?.getTime() ?? null));
  const liveTitrating = comps.some((c) => c._count.steps > 0 && c._count.doseLogs > 0);
  if ((ruleChanged || startChanged) && liveTitrating) {
    return {
      ok: false as const,
      error:
        "This stack is titrating with logged doses — a schedule change would rewrite its phase targets. Revise the component protocols instead (close + start new).",
    };
  }

  try {
    await prisma.protocol.updateMany({
      // Tips only — superseded predecessors keep their frozen schedule/start.
      where: { id: { in: comps.map((c) => c.id) }, userId: user.id },
      data: {
        scheduleRule: rule,
        // Only touch startDate when the caller passed the argument; "" clears it.
        ...(startDate !== undefined ? { startDate: newStart } : {}),
      },
    });
  } catch (e) {
    console.error("updateStackSchedule failed", e);
    return { ok: false as const, error: "Could not update the schedule." };
  }

  // Re-materialise planned doses NOW so the schedule/date change takes effect
  // immediately (stale out-of-window rows deleted, new grid generated) instead
  // of waiting for the daily tick. Non-fatal — the update itself succeeded.
  try {
    await runPlannedDoseGeneration(user.id);
  } catch (e) {
    console.error("updateStackSchedule: planned-dose regeneration failed", e);
  }

  revalidatePath("/today");
  revalidatePath("/settings");
  revalidatePath("/protocols");
  return { ok: true as const };
}
