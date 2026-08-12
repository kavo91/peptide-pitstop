"use server";

import Decimal from "decimal.js";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { encryptField } from "@/lib/crypto/fieldEncryption";
import { computeConcentrationMcgPerMl } from "@/lib/dosing/engine";
import { prescriptionWizardEnabled } from "@/lib/features";
import { runPlannedDoseGeneration } from "@/lib/planned/run";
import { PEPTIDE_LIBRARY } from "@/lib/peptide-library";
import {
  findDuplicateResolvedPeptideIds,
  validateDirectionsConfirmation,
  validateProtocolTranscriptionFields,
} from "@/lib/prescription-wizard";
import { dosesPerWeek } from "@/lib/schedule/frequency";
import { normaliseScheduleRule } from "@/lib/schedule/normalise";
import { peptideTokens } from "@/lib/stacks/server";
import {
  parseDateOrder,
  parseEnum,
  parseNonNegativeDecimal,
  parsePositiveDecimal,
} from "@/lib/validation/domain";

type WizardTx = Prisma.TransactionClient;

const PRESCRIPTION_STATUSES = ["active", "expired", "cancelled"] as const;
const VIAL_STATUSES = ["sealed", "in_use", "finished", "discarded"] as const;
const PROTOCOL_STATUSES = ["active", "paused", "completed"] as const;
const DOSE_UNITS = ["mcg", "mg", "ml", "units"] as const;
const DOSE_BASES = ["per_injection", "per_week"] as const;
const SCHEDULE_TYPES = ["fixed_times", "interval", "titration"] as const;

function optInt(v?: string | null): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function optDecimal(v?: string | null): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  try {
    const d = new Decimal(s);
    return d.isFinite() ? d.toString() : null;
  } catch {
    return null;
  }
}

function encOrNull(v?: string | null): string | null {
  const s = (v ?? "").trim();
  return s ? encryptField(s) : null;
}

function requireDateOrder(start?: string | null, end?: string | null) {
  if (!(start ?? "").trim() || !(end ?? "").trim()) return;
  const order = parseDateOrder(start, end);
  if (!order.ok) throw new Error(order.error);
}

function positiveInt(v?: string | null): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toDate(v?: string | null): Date | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function requireNonNegative(label: string, value?: string | null) {
  if (!(value ?? "").trim()) return;
  if (parseNonNegativeDecimal(value) === null) {
    throw new Error(`${label} must be zero or a positive number.`);
  }
}

function requirePositive(label: string, value?: string | null): string {
  const parsed = parsePositiveDecimal(value);
  if (parsed === null) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function buildPeptideData(input: {
  name: string;
  aliases?: string | null;
  category?: string | null;
  substanceClass?: string | null;
  defaultStrengthMg?: string | null;
  halfLifeHours?: string | null;
  minIntervalHours?: string | null;
  missedDosePolicy?: string | null;
  storageNotes?: string | null;
  route?: string | null;
}) {
  return {
    name: input.name.trim(),
    aliases: input.aliases?.trim() || null,
    category: input.category?.trim() || null,
    substanceClass: input.substanceClass === "IU" ? "IU" : "mass",
    defaultStrengthMg: optDecimal(input.defaultStrengthMg),
    halfLifeHours: optDecimal(input.halfLifeHours),
    minIntervalHours: optDecimal(input.minIntervalHours),
    missedDosePolicy:
      input.missedDosePolicy === "skip" || input.missedDosePolicy === "take_now"
        ? input.missedDosePolicy
        : "prompt",
    storageNotes: input.storageNotes?.trim() || null,
    route: input.route === "oral" ? "oral" : "injection",
  };
}

function findLibraryPeptide(name?: string | null) {
  const want = (name ?? "").trim().toLowerCase();
  if (!want) return null;
  return (
    PEPTIDE_LIBRARY.find((entry) =>
      peptideTokens({ name: entry.name, aliases: entry.aliases ?? null }).includes(want),
    ) ?? null
  );
}

async function assertSyringeUsableTx(
  tx: WizardTx,
  userId: string,
  syringeId?: string | null,
): Promise<void> {
  if (!syringeId) return;
  const syringe = await tx.syringe.findUnique({
    where: { id: syringeId },
    select: { userId: true },
  });
  if (!syringe || (syringe.userId !== null && syringe.userId !== userId)) {
    throw new Error("Syringe not found.");
  }
}

async function resolvePeptide(
  tx: WizardTx,
  userId: string,
  input: NonNullable<PrescriptionWizardInput["peptide"]>,
): Promise<{
  id: string;
  name: string;
  route: string;
}> {
  if (input.mode === "existing") {
    if (!input.id) throw new Error("Choose a peptide.");
    const peptide = await tx.peptide.findUnique({
      where: { id: input.id },
      select: { id: true, userId: true, name: true, route: true },
    });
    if (!peptide || (peptide.userId !== null && peptide.userId !== userId)) {
      throw new Error("Peptide not found.");
    }
    return { id: peptide.id, name: peptide.name, route: peptide.route };
  }

  const name = (input.name ?? "").trim();
  if (!name) throw new Error("Peptide name is required.");

  const candidates = await tx.peptide.findMany({
    where: { OR: [{ userId }, { userId: null }] },
    select: { id: true, userId: true, name: true, aliases: true, route: true },
  });
  const token = name.toLowerCase();
  const owned = candidates.find(
    (candidate) =>
      candidate.userId === userId &&
      peptideTokens({ name: candidate.name, aliases: candidate.aliases }).includes(token),
  );
  const shared = candidates.find((candidate) =>
    peptideTokens({ name: candidate.name, aliases: candidate.aliases }).includes(token),
  );
  const existing = owned ?? shared;
  if (existing) return { id: existing.id, name: existing.name, route: existing.route };

  const lib = findLibraryPeptide(input.mode === "library" ? name : input.name);
  const created = await tx.peptide.create({
    data: {
      ...buildPeptideData({
        name,
        aliases: input.aliases ?? lib?.aliases ?? "",
        category: input.category ?? lib?.category ?? "",
        substanceClass: input.substanceClass ?? lib?.substanceClass ?? "mass",
        defaultStrengthMg: input.defaultStrengthMg ?? "",
        halfLifeHours: input.halfLifeHours ?? lib?.halfLifeHours ?? "",
        minIntervalHours: input.minIntervalHours ?? "",
        missedDosePolicy: input.missedDosePolicy ?? "prompt",
        storageNotes: input.storageNotes ?? lib?.storageNotes ?? "",
        route: input.route ?? "injection",
      }),
      userId,
    },
    select: { id: true, name: true, route: true },
  });
  return created;
}

async function resolveStackComponentPeptide(
  tx: WizardTx,
  userId: string,
  input: StackWizardComponentInput,
): Promise<{ id: string; name: string; route: string }> {
  if (input.peptideId) {
    return resolvePeptide(tx, userId, { mode: "existing", id: input.peptideId });
  }
  return resolvePeptide(tx, userId, {
    mode: "custom",
    name: input.peptideName,
    route: "injection",
  });
}

function buildPrescriptionData(
  peptideId: string | null,
  stackId: string | null,
  input: PrescriptionWizardInput["prescription"],
) {
  requireNonNegative("Cost", input.cost);
  requireNonNegative("Quantity", input.quantity);
  requireNonNegative("Refills authorized", input.refillsAuthorized);
  requireNonNegative("Refills remaining", input.refillsRemaining);
  requireNonNegative("Reorder lead time", input.leadTimeDays);
  requireDateOrder(input.dateWritten, input.expiration);
  requireDateOrder(input.dateWritten, input.nextRefill);

  const parsedStatus =
    parseEnum(input.status, PRESCRIPTION_STATUSES) ?? ("active" as (typeof PRESCRIPTION_STATUSES)[number]);

  return {
    peptideId,
    stackId,
    source: input.source?.trim() || null,
    pharmacy: encOrNull(input.pharmacy),
    prescriber: encOrNull(input.prescriber),
    cost: parseNonNegativeDecimal(input.cost),
    currency: input.currency?.trim() || "AUD",
    quantity: optInt(input.quantity),
    refillsAuthorized: optInt(input.refillsAuthorized),
    refillsRemaining: optInt(input.refillsRemaining),
    dateWritten: toDate(input.dateWritten),
    nextRefill: toDate(input.nextRefill),
    expiration: toDate(input.expiration),
    leadTimeDays: optInt(input.leadTimeDays),
    doseInstructions: encOrNull(input.doseInstructions),
    status: parsedStatus,
  };
}

function deriveSingleVialStrength(
  vial?: PrescriptionWizardInput["vial"],
  preparation?: PrescriptionWizardInput["preparation"],
): string | null {
  const direct = parsePositiveDecimal(vial?.labelStrengthMg);
  if (direct) return direct;
  if (!preparation?.enabled) return null;
  if (preparation.prepType === "reconstituted") {
    return parsePositiveDecimal(preparation.totalMg);
  }
  const conc = parsePositiveDecimal(preparation.concentrationMcgPerMl);
  const vol = parsePositiveDecimal(preparation.vialVolumeMl);
  if (!conc || !vol) return null;
  return new Decimal(conc).times(vol).div(1000).toString();
}

function buildVialData(
  peptideId: string,
  prescriptionId: string | null,
  input: PrescriptionWizardInput["vial"] | undefined,
  fallbackStrength?: string | null,
) {
  const labelStrengthMg = parsePositiveDecimal(input?.labelStrengthMg) ?? fallbackStrength;
  if (!labelStrengthMg) throw new Error("Enter the vial strength in mg.");
  const status =
    parseEnum(input?.status, VIAL_STATUSES) ?? ("sealed" as (typeof VIAL_STATUSES)[number]);

  return {
    peptideId,
    prescriptionId,
    labelStrengthMg,
    lot: input?.lot?.trim() || null,
    expiry: toDate(input?.expiry),
    storageLocation: input?.storageLocation?.trim() || null,
    status,
  };
}

function buildPreparationSnapshot(
  input: NonNullable<PrescriptionWizardInput["preparation"]>,
): {
  prepType: "reconstituted" | "premixed";
  bacWaterMl: string | null;
  totalMg: string;
  concentrationMcgPerMl: string;
  remainingMl: string;
  beyondUseDate: Date | null;
} {
  if (input.prepType === "reconstituted") {
    const totalMg = requirePositive("Vial strength", input.totalMg);
    const bacWaterMl = requirePositive("BAC water volume", input.bacWaterMl);
    const concentrationMcgPerMl = computeConcentrationMcgPerMl({
      totalMassMg: totalMg,
      bacWaterMl,
    }).toString();
    return {
      prepType: "reconstituted",
      bacWaterMl,
      totalMg,
      concentrationMcgPerMl,
      remainingMl: bacWaterMl,
      beyondUseDate: toDate(input.beyondUseDateISO),
    };
  }

  const concentrationMcgPerMl = requirePositive(
    "Premixed concentration",
    input.concentrationMcgPerMl,
  );
  const remainingMl = requirePositive("Vial volume", input.vialVolumeMl);
  const totalMg = new Decimal(concentrationMcgPerMl).times(remainingMl).div(1000).toString();
  return {
    prepType: "premixed",
    bacWaterMl: null,
    totalMg,
    concentrationMcgPerMl,
    remainingMl,
    beyondUseDate: toDate(input.beyondUseDateISO),
  };
}

async function buildProtocolData(
  tx: WizardTx,
  userId: string,
  peptideId: string,
  prescriptionId: string | null,
  vialId: string | null,
  stackId: string | null,
  input: NonNullable<PrescriptionWizardInput["protocol"]>,
) {
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("Protocol name is required.");

  const dup = await tx.protocol.count({ where: { userId, peptideId } });
  if (dup > 0) {
    throw new Error("That peptide already has a protocol — edit it instead.");
  }

  const transcriptionError = validateProtocolTranscriptionFields(input);
  if (transcriptionError) throw new Error(transcriptionError);
  const norm = normaliseScheduleRule(input.scheduleRule ?? "", input.startDate || null);
  if (!norm.ok) throw new Error(norm.error);

  requireDateOrder(input.startDate, input.endDate);

  const parsedDoseBasis = parseEnum(input.doseBasis, DOSE_BASES);
  const parsedDoseUnit = parseEnum(input.doseInputUnit, DOSE_UNITS);

  if (parsedDoseBasis === "per_week") {
    const injectionsPerWeek = dosesPerWeek(norm.rule);
    if (injectionsPerWeek == null || injectionsPerWeek <= 0) {
      throw new Error("Per-week dosing needs a schedule with a known injection frequency.");
    }
  }

  let targetDose: string | null = null;
  if ((input.targetDose ?? "").trim()) {
    targetDose = requirePositive("Target dose", input.targetDose);
  }

  await assertSyringeUsableTx(tx, userId, input.defaultSyringeId || null);

  return {
    peptideId,
    prescriptionId,
    stackId,
    vialId,
    name,
    source: "prescription",
    scheduleType:
      parseEnum(input.scheduleType, SCHEDULE_TYPES) ??
      ("fixed_times" as (typeof SCHEDULE_TYPES)[number]),
    scheduleRule: norm.rule,
    rebaseMode: input.rebaseMode === "rolling" ? "rolling" : "fixed_anchor",
    adherenceWindowMin: optInt(input.adherenceWindowMin) ?? 120,
    defaultSyringeId: input.defaultSyringeId?.trim() || null,
    targetDose,
    doseInputUnit: parsedDoseUnit ?? ("mcg" as (typeof DOSE_UNITS)[number]),
    doseBasis: parsedDoseBasis ?? ("per_injection" as (typeof DOSE_BASES)[number]),
    startDate: toDate(input.startDate),
    endDate: toDate(input.endDate),
    status:
      parseEnum(input.status, PROTOCOL_STATUSES) ??
      ("active" as (typeof PROTOCOL_STATUSES)[number]),
  };
}

function revalidateWizardPaths(target: "peptide" | "stack") {
  const paths = [
    "/settings",
    "/prescriptions",
    "/inventory",
    "/protocols",
    "/today",
    "/doses",
    "/analytics",
  ];
  if (target === "stack") paths.push("/stacks");
  for (const path of paths) revalidatePath(path);
}

async function saveSingleWizard(
  tx: WizardTx,
  userId: string,
  input: PrescriptionWizardInput,
): Promise<Extract<PrescriptionWizardResult, { ok: true }>> {
  if (!input.peptide) throw new Error("Choose a peptide.");
  const peptide = await resolvePeptide(tx, userId, input.peptide);

  const prescription = await tx.prescription.create({
    data: {
      userId,
      ...buildPrescriptionData(peptide.id, null, input.prescription),
    },
    select: { id: true },
  });

  const isOral = peptide.route === "oral";
  let vialId: string | undefined;
  let preparationId: string | undefined;
  let protocolId: string | undefined;

  if (!isOral) {
    const vial = await tx.vial.create({
      data: {
        userId,
        ...buildVialData(
          peptide.id,
          prescription.id,
          input.vial,
          deriveSingleVialStrength(input.vial, input.preparation),
        ),
      },
      select: { id: true },
    });
    vialId = vial.id;

    if (input.preparation?.enabled) {
      const preparation = buildPreparationSnapshot(input.preparation);
      await tx.preparation.updateMany({
        where: { vialId: vial.id, active: true },
        data: { active: false },
      });
      const createdPreparation = await tx.preparation.create({
        data: {
          vialId: vial.id,
          prepType: preparation.prepType,
          bacWaterMl: preparation.bacWaterMl,
          totalMg: preparation.totalMg,
          concentrationMcgPerMl: preparation.concentrationMcgPerMl,
          remainingMl: preparation.remainingMl,
          beyondUseDate: preparation.beyondUseDate,
          active: true,
        },
        select: { id: true },
      });
      preparationId = createdPreparation.id;
      await tx.vial.update({
        where: { id: vial.id },
        data: { status: "in_use", openedAt: new Date() },
      });
    }
  }

  if (input.protocol?.enabled) {
    const protocol = await tx.protocol.create({
      data: {
        userId,
        ...(await buildProtocolData(
          tx,
          userId,
          peptide.id,
          prescription.id,
          vialId ?? null,
          null,
          input.protocol,
        )),
      },
      select: { id: true },
    });
    protocolId = protocol.id;
  }

  await tx.auditLog.create({
    data: {
      userId,
      entityType: "PrescriptionWizard",
      entityId: prescription.id,
      field: "create",
      newValue: JSON.stringify({
        peptideId: peptide.id,
        peptideName: peptide.name,
        prescriptionId: prescription.id,
        vialId: vialId ?? null,
        preparationId: preparationId ?? null,
        protocolId: protocolId ?? null,
      }),
    },
  });

  return {
    ok: true,
    target: "peptide",
    peptideId: peptide.id,
    prescriptionId: prescription.id,
    vialId,
    preparationId,
    protocolId,
  };
}

async function saveStackWizard(
  tx: WizardTx,
  userId: string,
  input: PrescriptionWizardInput,
): Promise<Extract<PrescriptionWizardResult, { ok: true }>> {
  if (!input.stack) throw new Error("Choose or create a stack.");
  const mode = input.stack.mode;

  let stack =
    mode === "existing" && input.stack.id
      ? await tx.stack.findFirst({
          where: { id: input.stack.id, userId },
          select: { id: true, name: true },
        })
      : null;

  if (mode === "existing" && !stack) throw new Error("Stack not found.");
  if (mode === "new") {
    const name = (input.stack.name ?? "").trim();
    if (!name) throw new Error("Stack name is required.");
    stack = await tx.stack.create({
      data: { userId, name, notes: input.stack.notes?.trim() || null },
      select: { id: true, name: true },
    });
  }
  if (!stack) throw new Error("Stack not found.");

  const components = input.stack.components ?? [];
  if (components.length < 1 || components.length > 20) {
    throw new Error("Stack mode requires between 1 and 20 components.");
  }

  const existingGroupedPrescription = await tx.prescription.findFirst({
    where: { userId, stackId: stack.id },
    select: { id: true },
  });

  const groupedPrescriptionData = buildPrescriptionData(null, stack.id, input.prescription);
  const prescriptionId = existingGroupedPrescription
    ? (
        await tx.prescription.update({
          where: { id: existingGroupedPrescription.id },
          data: groupedPrescriptionData,
          select: { id: true },
        })
      ).id
    : (
        await tx.prescription.create({
          data: { userId, ...groupedPrescriptionData },
          select: { id: true },
        })
      ).id;

  const resolvedPeptideIds: string[] = [];
  const componentVialIds: string[] = [];
  const componentPreparationIds: string[] = [];
  const componentProtocolIds: string[] = [];

  for (const component of components) {
    const peptide = await resolveStackComponentPeptide(tx, userId, component);
    if (peptide.route === "oral") {
      throw new Error("Stack components must use injection-route peptides.");
    }
    if (findDuplicateResolvedPeptideIds([...resolvedPeptideIds, peptide.id]).length > 0) {
      throw new Error("Stack mode rejects duplicate component peptides.");
    }
    resolvedPeptideIds.push(peptide.id);

    const qty = positiveInt(component.qty);
    if (!qty) throw new Error("Stack component quantity must be a whole number of 1 or more.");
    if (qty > 50) throw new Error("Each stack component can have at most 50 vials.");

    const concentrationMcgPerMl = requirePositive(
      "Component concentration",
      component.concentrationMcgPerMl,
    );
    const vialSizeMl = requirePositive("Component vial size", component.vialSizeMl);
    const doseMl = requirePositive("Component dose volume", component.doseMl);
    if (!(component.startDate ?? "").trim()) throw new Error("Component start date is required.");
    requireDateOrder(component.startDate, component.endDate);

    const norm = normaliseScheduleRule(component.scheduleRule, component.startDate);
    if (!norm.ok) throw new Error(norm.error);

    const existingProtocol = await tx.protocol.count({ where: { userId, peptideId: peptide.id } });
    if (existingProtocol > 0) {
      throw new Error("That peptide already has a protocol — edit it instead.");
    }

    const labelStrengthMg = new Decimal(concentrationMcgPerMl)
      .times(vialSizeMl)
      .div(1000)
      .toString();

    let pinnedVialId: string | null = null;
    for (let index = 0; index < qty; index += 1) {
      const vial = await tx.vial.create({
        data: {
          userId,
          peptideId: peptide.id,
          prescriptionId,
          labelStrengthMg,
          status: index === 0 ? "in_use" : "sealed",
        },
        select: { id: true },
      });
      componentVialIds.push(vial.id);
      if (index === 0) {
        pinnedVialId = vial.id;
        const preparation = await tx.preparation.create({
          data: {
            vialId: vial.id,
            prepType: "premixed",
            bacWaterMl: null,
            totalMg: labelStrengthMg,
            concentrationMcgPerMl,
            remainingMl: vialSizeMl,
            active: true,
          },
          select: { id: true },
        });
        componentPreparationIds.push(preparation.id);
      }
    }

    const protocol = await tx.protocol.create({
      data: {
        userId,
        peptideId: peptide.id,
        prescriptionId,
        stackId: stack.id,
        vialId: pinnedVialId,
        name: `${peptide.name} (prescription stack)`,
        source: "prescription",
        scheduleType: "fixed_times",
        scheduleRule: norm.rule,
        rebaseMode: "fixed_anchor",
        adherenceWindowMin: 120,
        defaultSyringeId: null,
        targetDose: doseMl,
        doseInputUnit: "ml",
        doseBasis: "per_injection",
        startDate: toDate(component.startDate),
        endDate: toDate(component.endDate),
        status: "active",
      },
      select: { id: true },
    });
    componentProtocolIds.push(protocol.id);
  }

  await tx.auditLog.create({
    data: {
      userId,
      entityType: "PrescriptionWizard",
      entityId: prescriptionId,
      field: "create_stack",
      newValue: JSON.stringify({
        stackId: stack.id,
        stackName: stack.name,
        prescriptionId,
        componentVialIds,
        componentProtocolIds,
      }),
    },
  });

  return {
    ok: true,
    target: "stack",
    stackId: stack.id,
    prescriptionId,
    componentVialIds,
    componentPreparationIds,
    componentProtocolIds,
  };
}

export interface PrescriptionWizardInput {
  target: "peptide" | "stack";
  directionsConfirmed?: boolean;
  peptide?: {
    mode: "existing" | "library" | "custom";
    id?: string;
    name?: string;
    aliases?: string;
    category?: string;
    substanceClass?: "mass" | "IU";
    defaultStrengthMg?: string;
    halfLifeHours?: string;
    minIntervalHours?: string;
    missedDosePolicy?: "skip" | "take_now" | "prompt";
    route?: "injection" | "oral";
    storageNotes?: string;
  };
  stack?: {
    mode: "existing" | "new";
    id?: string;
    name?: string;
    notes?: string;
    components?: StackWizardComponentInput[];
  };
  prescription: {
    source?: string;
    pharmacy?: string;
    prescriber?: string;
    cost?: string;
    currency?: string;
    quantity?: string;
    refillsAuthorized?: string;
    refillsRemaining?: string;
    dateWritten?: string;
    nextRefill?: string;
    expiration?: string;
    leadTimeDays?: string;
    doseInstructions?: string;
    status?: string;
  };
  vial?: {
    labelStrengthMg?: string;
    lot?: string;
    expiry?: string;
    storageLocation?: string;
    status?: string;
  };
  preparation?: {
    enabled: boolean;
    prepType: "reconstituted" | "premixed";
    totalMg?: string;
    bacWaterMl?: string;
    concentrationMcgPerMl?: string;
    vialVolumeMl?: string;
    beyondUseDateISO?: string;
  };
  protocol?: {
    enabled: boolean;
    name?: string;
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
  };
}

export interface StackWizardComponentInput {
  peptideId?: string;
  peptideName?: string;
  concentrationMcgPerMl: string;
  vialSizeMl: string;
  qty: string;
  doseMl: string;
  scheduleRule: string;
  startDate: string;
  endDate?: string;
}

export type PrescriptionWizardResult =
  | {
      ok: true;
      target: "peptide" | "stack";
      peptideId?: string;
      stackId?: string;
      prescriptionId: string;
      vialId?: string;
      componentVialIds?: string[];
      preparationId?: string;
      componentPreparationIds?: string[];
      protocolId?: string;
      componentProtocolIds?: string[];
      warnings?: string[];
    }
  | {
      ok: false;
      error: string;
    };

export async function createPrescriptionWizard(
  input: PrescriptionWizardInput,
): Promise<PrescriptionWizardResult> {
  if (!prescriptionWizardEnabled()) {
    return { ok: false, error: "Prescription wizard is unavailable in this build." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const confirmationError = validateDirectionsConfirmation({
    target: input.target,
    protocolEnabled: input.protocol?.enabled,
    confirmed: input.directionsConfirmed,
  });
  if (confirmationError) return { ok: false, error: confirmationError };

  try {
    const result =
      input.target === "stack"
        ? await prisma.$transaction((tx) => saveStackWizard(tx, user.id, input))
        : await prisma.$transaction((tx) => saveSingleWizard(tx, user.id, input));

    const warnings: string[] = [];
    try {
      await runPlannedDoseGeneration(user.id);
    } catch (error) {
      console.error("createPrescriptionWizard: planned-dose regeneration failed", error);
      warnings.push("Planned doses will catch up shortly. The records were still saved.");
    }

    revalidateWizardPaths(result.target);
    return warnings.length > 0 ? { ...result, warnings } : result;
  } catch (error) {
    console.error("createPrescriptionWizard failed", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not create the tracking setup.",
    };
  }
}
