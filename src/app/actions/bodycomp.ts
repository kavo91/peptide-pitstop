"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { encryptField, decryptField } from "@/lib/crypto/fieldEncryption";
import { dayKeyInTz, isValidTimeZone } from "@/lib/tz-day";
import { deleteDocumentFile } from "@/lib/documents";
import {
  checksums,
  LIMB_REGIONS,
  type ChecksumResult,
  type Region,
  type RegionValues,
  type ScanValues,
} from "@/lib/body-comp-core";

// ---------------------------------------------------------------------------
// Local encrypt/decrypt helpers, byte-equivalent to encNum/decNum in
// `src/lib/bodycomp-data.ts`. Not imported and not exported: a "use server"
// module may only export async functions.
// ---------------------------------------------------------------------------
const encNum = (n: number | null | undefined): string | null => n == null || !Number.isFinite(n) ? null : encryptField(String(n));
const decNum = (s: string | null | undefined): number | null => { const v = decryptField(s); if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// ---------------------------------------------------------------------------
// Inputs (strings straight from form fields; parsed + validated server-side)
// ---------------------------------------------------------------------------

export interface RegionInput { region: Region; bmcG?: string; fatG: string; leanG: string; totalG: string; pctFat: string; pctFatYn?: string; pctFatAm?: string; bmdGcm2?: string }

export interface CreateScanInput {
  scannedAt: string; // ISO with offset, from a datetime-local + device tz
  tz: string; deviceMake?: string; deviceModel?: string; deviceSerial?: string; softwareVersion?: string; scanMode?: string; facility?: string; referencePopulation?: string;
  sex: "male" | "female"; ageYears: string; heightCm: string; clinicWeightKg?: string;
  totalFatG: string; totalLeanG: string; totalBmcG: string; totalMassG: string; pctFat: string; pctFatYn?: string; pctFatAm?: string;
  vatMassG?: string; vatVolumeCm3?: string; vatAreaCm2?: string; totalBmdGcm2?: string; bmdTScore?: string; bmdZScore?: string; bmdCvPct?: string;
  fmiYn?: string; fmiAm?: string; lmiYn?: string; lmiAm?: string; almiYn?: string; almiAm?: string;
  prep: { fasted: boolean | null; fastingHours?: string; noCaffeine: boolean | null; noTrainingPriorDay: boolean | null; activeTravel: boolean | null; euhydratedVoided: boolean | null; illnessFree14d: boolean | null };
  creatineStatus?: "stable" | "started" | "stopped" | "none"; carbPattern48h?: "normal" | "loaded" | "depleted";
  regions: RegionInput[]; notes?: string;
  /** Uploaded report (`Document.kind = dexa_report`) to link; marked `confirmed` in the same transaction. */
  documentId?: string;
}

export interface CreateMetabolicTestInput { testedAt: string; tz: string; method: "ic_vo2_only" | "ic_vo2_vco2" | "other"; deviceLabel?: string; facility?: string; measuredRmrKcal: string; kcalPerLitreO2?: string; vo2MlMin?: string; vco2MlMin?: string; rq?: string; durationMin?: string; steadyStateCvPct?: string; sex: "male" | "female"; ageYears: string; heightCm: string; weightKg: string; reportedPredictedKcal?: string; reportedPredictionEquation?: string; reportedActivityFactor?: string; reportedActivityLabel?: string; prep: { fasted: boolean | null; fastingHours?: string; noCaffeine: boolean | null; noTrainingPriorDay: boolean | null; activeTravel: boolean | null; rested: boolean | null; restMinBeforeTest?: string; illnessFree14d: boolean | null; awakeQuiet: boolean | null }; roomTempC?: string; bodyCompScanId?: string; notes?: string }

export interface CreateScanResult { ok: boolean; id?: string; error?: string; checks?: ChecksumResult[] }
export interface CreateMetabolicTestResult { ok: boolean; id?: string; error?: string }

/** Subject block of a scan near an entered test date — strings ready for the RMR form (clinic weight decrypted for the owner's own form). */
export interface NearScan { id: string; localDay: string; sex: "male" | "female"; ageYears: string; heightCm: string; clinicWeightKg: string }

// ---------------------------------------------------------------------------
// Parsing / validation helpers
// ---------------------------------------------------------------------------

class ValidationError extends Error {}

const ALL_REGIONS: Region[] = ["l_arm", "r_arm", "trunk", "l_leg", "r_leg", "head", "android", "gynoid"];
const SEXES = new Set(["male", "female"]);
const CREATINE = new Set(["stable", "started", "stopped", "none"]);
const CARB = new Set(["normal", "loaded", "depleted"]);
const METHODS = new Set(["ic_vo2_only", "ic_vo2_vco2", "other"]);
const DAY_MS = 86_400_000;

function str(v: string | undefined | null): string | null {
  const s = (v ?? "").toString().trim();
  return s ? s : null;
}

/** Required finite number ≥ min (default 0). */
function reqNum(v: string | undefined | null, label: string, min = 0, max = Number.POSITIVE_INFINITY): number {
  const s = str(v);
  if (s == null) throw new ValidationError(`${label} is required.`);
  const n = Number(s);
  if (!Number.isFinite(n)) throw new ValidationError(`${label} must be a number.`);
  if (n < min || n > max) throw new ValidationError(`${label} must be between ${min} and ${max === Number.POSITIVE_INFINITY ? "∞" : max}.`);
  return n;
}

/** Optional number: empty → null; non-empty must parse finite (and ≥ min unless `allowNegative`). */
function optNum(v: string | undefined | null, label: string, opts: { allowNegative?: boolean } = {}): number | null {
  const s = str(v);
  if (s == null) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new ValidationError(`${label} must be a number.`);
  if (!opts.allowNegative && n < 0) throw new ValidationError(`${label} must be 0 or more.`);
  return n;
}

/** Optional non-negative integer (Int columns). */
function optInt(v: string | undefined | null, label: string): number | null {
  const n = optNum(v, label);
  if (n == null) return null;
  if (!Number.isInteger(n)) throw new ValidationError(`${label} must be a whole number.`);
  return n;
}

/** Number → Prisma Decimal-safe string (or null). */
const dec = (n: number | null): string | null => (n == null ? null : String(n));

function bool(v: boolean | null | undefined): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function parseInstant(iso: string | undefined, tz: string | undefined, label: string): { at: Date; tz: string; localDay: string } {
  const at = new Date(iso ?? "");
  if (Number.isNaN(at.getTime())) throw new ValidationError(`Invalid ${label}.`);
  const zone = str(tz);
  if (!zone || !isValidTimeZone(zone)) throw new ValidationError("Invalid timezone.");
  return { at, tz: zone, localDay: dayKeyInTz(at, zone) };
}

function parseRegions(input: RegionInput[] | undefined): RegionValues[] {
  const rows = input ?? [];
  if (rows.length === 0) return [];
  const names = rows.map((r) => r.region);
  if (new Set(names).size !== names.length) throw new ValidationError("Duplicate region rows.");
  for (const n of names) if (!ALL_REGIONS.includes(n)) throw new ValidationError(`Unknown region "${n}".`);
  const isLimbs = names.length === LIMB_REGIONS.length && LIMB_REGIONS.every((r) => names.includes(r));
  const isAll = names.length === ALL_REGIONS.length;
  if (!isLimbs && !isAll) throw new ValidationError("Regions must be empty, the four limbs, or all eight rows.");
  return rows.map((r) => {
    const label = `Region ${r.region}`;
    return {
      region: r.region,
      bmcG: optNum(r.bmcG, `${label} BMC`),
      fatG: reqNum(r.fatG, `${label} fat`),
      leanG: reqNum(r.leanG, `${label} lean`),
      totalG: reqNum(r.totalG, `${label} total`),
      pctFat: reqNum(r.pctFat, `${label} % fat`, 0, 100),
      pctFatYn: optNum(r.pctFatYn, `${label} YN percentile`),
      pctFatAm: optNum(r.pctFatAm, `${label} AM percentile`),
      bmdGcm2: optNum(r.bmdGcm2, `${label} BMD`),
    };
  });
}

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------

/**
 * Create a DXA scan header plus its regional rows. Identity from the session; every
 * report-derived number is encrypted at rest (`encNum` / `encryptField`); checksums run on
 * the parsed values and are returned as warnings (they never block the save).
 */
export async function createBodyCompScan(input: CreateScanInput): Promise<CreateScanResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  let parsed: {
    at: Date; tz: string; localDay: string; sex: "male" | "female"; ageYears: number; heightCm: number; clinicWeightKg: number | null;
    totalFatG: number; totalLeanG: number; totalBmcG: number; totalMassG: number; pctFat: number; pctFatYn: number | null; pctFatAm: number | null;
    vatMassG: number | null; vatVolumeCm3: number | null; vatAreaCm2: number | null;
    totalBmdGcm2: number | null; bmdTScore: number | null; bmdZScore: number | null; bmdCvPct: number | null;
    fmiYn: number | null; fmiAm: number | null; lmiYn: number | null; lmiAm: number | null; almiYn: number | null; almiAm: number | null;
    fastingHours: number | null; creatineStatus: string | null; carbPattern48h: string | null; regions: RegionValues[];
  };
  try {
    const { at, tz, localDay } = parseInstant(input.scannedAt, input.tz, "scan date");
    if (!SEXES.has(input.sex)) throw new ValidationError("Sex must be male or female.");
    const creatineStatus = str(input.creatineStatus);
    if (creatineStatus && !CREATINE.has(creatineStatus)) throw new ValidationError("Invalid creatine status.");
    const carbPattern48h = str(input.carbPattern48h);
    if (carbPattern48h && !CARB.has(carbPattern48h)) throw new ValidationError("Invalid carbohydrate pattern.");
    parsed = {
      at, tz, localDay, sex: input.sex,
      ageYears: reqNum(input.ageYears, "Age"),
      heightCm: reqNum(input.heightCm, "Height (cm)", 100, 250),
      clinicWeightKg: optNum(input.clinicWeightKg, "Clinic weight"),
      totalFatG: reqNum(input.totalFatG, "Total fat (g)"),
      totalLeanG: reqNum(input.totalLeanG, "Total lean (g)"),
      totalBmcG: reqNum(input.totalBmcG, "Total BMC (g)"),
      totalMassG: reqNum(input.totalMassG, "Total mass (g)"),
      pctFat: reqNum(input.pctFat, "% fat", 0, 70),
      pctFatYn: optNum(input.pctFatYn, "% fat YN percentile"),
      pctFatAm: optNum(input.pctFatAm, "% fat AM percentile"),
      vatMassG: optNum(input.vatMassG, "VAT mass"),
      vatVolumeCm3: optNum(input.vatVolumeCm3, "VAT volume"),
      vatAreaCm2: optNum(input.vatAreaCm2, "VAT area"),
      totalBmdGcm2: optNum(input.totalBmdGcm2, "Total BMD"),
      bmdTScore: optNum(input.bmdTScore, "BMD T-score", { allowNegative: true }),
      bmdZScore: optNum(input.bmdZScore, "BMD Z-score", { allowNegative: true }),
      bmdCvPct: optNum(input.bmdCvPct, "BMD CV %"),
      fmiYn: optNum(input.fmiYn, "FMI YN percentile"), fmiAm: optNum(input.fmiAm, "FMI AM percentile"),
      lmiYn: optNum(input.lmiYn, "LMI YN percentile"), lmiAm: optNum(input.lmiAm, "LMI AM percentile"),
      almiYn: optNum(input.almiYn, "ALMI YN percentile"), almiAm: optNum(input.almiAm, "ALMI AM percentile"),
      fastingHours: optNum(input.prep?.fastingHours, "Fasting hours"),
      creatineStatus, carbPattern48h,
      regions: parseRegions(input.regions),
    };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    throw e;
  }

  // Linked report: must be this user's dexa_report and not already attached to a scan.
  const documentId = str(input.documentId);
  if (documentId) {
    const doc = await prisma.document.findFirst({
      where: { id: documentId, userId: user.id, kind: "dexa_report" },
      include: { _count: { select: { bodyCompScans: true } } },
    });
    if (!doc) return { ok: false, error: "Uploaded report not found." };
    if (doc._count.bodyCompScans > 0) return { ok: false, error: "That report is already linked to a scan." };
  }

  const prep = input.prep ?? ({} as CreateScanInput["prep"]);
  // Checksums on the parsed values — warnings only. `ghs` is a read-time concern (data layer);
  // the pure checksums ignore it, so a neutral placeholder is fine here.
  const forChecks: ScanValues = {
    id: "", scannedAt: parsed.at, localDay: parsed.localDay,
    deviceSerial: str(input.deviceSerial), softwareVersion: str(input.softwareVersion),
    sex: parsed.sex, ageYears: parsed.ageYears, heightCm: parsed.heightCm, clinicWeightKg: parsed.clinicWeightKg,
    totalFatG: parsed.totalFatG, totalLeanG: parsed.totalLeanG, totalBmcG: parsed.totalBmcG, totalMassG: parsed.totalMassG,
    pctFat: parsed.pctFat, pctFatYn: parsed.pctFatYn, pctFatAm: parsed.pctFatAm,
    vatMassG: parsed.vatMassG, vatVolumeCm3: parsed.vatVolumeCm3, vatAreaCm2: parsed.vatAreaCm2,
    totalBmdGcm2: parsed.totalBmdGcm2, bmdTScore: parsed.bmdTScore, bmdZScore: parsed.bmdZScore, bmdCvPct: parsed.bmdCvPct,
    prep: {
      fasted: bool(prep.fasted), fastingHours: parsed.fastingHours, noCaffeine: bool(prep.noCaffeine),
      noTrainingPriorDay: bool(prep.noTrainingPriorDay), activeTravel: bool(prep.activeTravel),
      euhydratedVoided: bool(prep.euhydratedVoided), illnessFree14d: bool(prep.illnessFree14d),
    },
    creatineStatus: parsed.creatineStatus, ghs: { onGhs: false, daysSinceLastDose: null }, regions: parsed.regions,
  };
  const checks = checksums(forChecks);

  const regionRows = parsed.regions.map((r) => ({
    region: r.region,
    bmcG: encNum(r.bmcG),
    fatG: encNum(r.fatG)!,
    leanG: encNum(r.leanG)!,
    totalG: encNum(r.totalG)!,
    pctFat: encNum(r.pctFat)!,
    pctFatYn: encNum(r.pctFatYn),
    pctFatAm: encNum(r.pctFatAm),
    bmdGcm2: encNum(r.bmdGcm2),
  }));

  try {
    const scan = await prisma.$transaction(async (tx) => {
      const created = await tx.bodyCompScan.create({
        data: {
          userId: user.id,
          scannedAt: parsed.at,
          localDay: parsed.localDay,
          tz: parsed.tz,
          deviceMake: str(input.deviceMake),
          deviceModel: str(input.deviceModel),
          deviceSerial: str(input.deviceSerial),
          softwareVersion: str(input.softwareVersion),
          scanMode: str(input.scanMode),
          facility: str(input.facility),
          referencePopulation: str(input.referencePopulation),
          sex: parsed.sex,
          ageYears: dec(parsed.ageYears)!,
          heightCm: dec(parsed.heightCm)!,
          clinicWeightKg: encNum(parsed.clinicWeightKg),
          totalFatG: encNum(parsed.totalFatG)!,
          totalLeanG: encNum(parsed.totalLeanG)!,
          totalBmcG: encNum(parsed.totalBmcG)!,
          totalMassG: encNum(parsed.totalMassG)!,
          pctFat: encNum(parsed.pctFat)!,
          pctFatYn: encNum(parsed.pctFatYn),
          pctFatAm: encNum(parsed.pctFatAm),
          vatMassG: encNum(parsed.vatMassG),
          vatVolumeCm3: encNum(parsed.vatVolumeCm3),
          vatAreaCm2: encNum(parsed.vatAreaCm2),
          totalBmdGcm2: encNum(parsed.totalBmdGcm2),
          bmdTScore: encNum(parsed.bmdTScore),
          bmdZScore: encNum(parsed.bmdZScore),
          bmdCvPct: dec(parsed.bmdCvPct),
          fmiYn: encNum(parsed.fmiYn), fmiAm: encNum(parsed.fmiAm),
          lmiYn: encNum(parsed.lmiYn), lmiAm: encNum(parsed.lmiAm),
          almiYn: encNum(parsed.almiYn), almiAm: encNum(parsed.almiAm),
          prepFasted: bool(prep.fasted),
          prepFastingHours: dec(parsed.fastingHours),
          prepNoCaffeine: bool(prep.noCaffeine),
          prepNoTrainingPriorDay: bool(prep.noTrainingPriorDay),
          prepActiveTravel: bool(prep.activeTravel),
          prepEuhydratedVoided: bool(prep.euhydratedVoided),
          prepIllnessFree14d: bool(prep.illnessFree14d),
          // prepSameDeviceAsPrior stays null: comparability() reads deviceSerial/softwareVersion directly.
          creatineStatus: parsed.creatineStatus,
          carbPattern48h: parsed.carbPattern48h,
          notes: input.notes?.trim() ? encryptField(input.notes.trim()) : null,
          documentId,
          regions: regionRows.length ? { create: regionRows } : undefined,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "BodyCompScan",
          entityId: created.id,
          field: "create",
          newValue: `${regionRows.length} region(s) @ ${parsed.at.toISOString()}${documentId ? ` (document ${documentId})` : ""}`,
        },
      });

      if (documentId) {
        await tx.document.update({ where: { id: documentId }, data: { extractionStatus: "confirmed" } });
        await tx.auditLog.create({
          data: { userId: user.id, entityType: "Document", entityId: documentId, field: "confirm", newValue: `scan ${created.id}` },
        });
      }

      return created;
    });

    revalidatePath("/body");
    return { ok: true, id: scan.id, checks };
  } catch (e) {
    console.error("createBodyCompScan failed", e);
    return { ok: false, error: "Could not save the scan. Please try again." };
  }
}

/**
 * Delete a scan: cascades its regions, unlinks any metabolic test pointing at it, and
 * removes a linked report document (row in the same transaction, file after commit)
 * when nothing else references that document. Owner-checked; audited.
 */
export async function deleteBodyCompScan(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const scan = await prisma.bodyCompScan.findUnique({ where: { id } });
  if (!scan) return { ok: true };
  if (scan.userId !== user.id) return { ok: false, error: "Not your scan." };

  let orphanFile: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.metabolicTest.updateMany({ where: { bodyCompScanId: id }, data: { bodyCompScanId: null } });
      await tx.bodyCompRegion.deleteMany({ where: { scanId: id } });
      await tx.bodyCompScan.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "BodyCompScan",
          entityId: id,
          field: "delete",
          oldValue: `scanned ${scan.scannedAt.toISOString()}`,
        },
      });

      if (scan.documentId) {
        const doc = await tx.document.findFirst({
          where: { id: scan.documentId, userId: user.id },
          include: { _count: { select: { bodyCompScans: true, metabolicTests: true } } },
        });
        if (doc && doc._count.bodyCompScans === 0 && doc._count.metabolicTests === 0) {
          await tx.document.delete({ where: { id: doc.id } });
          await tx.auditLog.create({
            data: { userId: user.id, entityType: "Document", entityId: doc.id, field: "delete", oldValue: `with scan ${id}` },
          });
          orphanFile = doc.filePath;
        }
      }
    });
  } catch (e) {
    console.error("deleteBodyCompScan failed", e);
    return { ok: false, error: "Could not delete the scan." };
  }

  // File after commit: a failed unlink leaves an orphan file, never a dangling row.
  if (orphanFile) await deleteDocumentFile(orphanFile).catch((e) => console.error("deleteBodyCompScan: unlink failed", e));

  revalidatePath("/body");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Metabolic tests (RMR)
// ---------------------------------------------------------------------------

/** Create an indirect-calorimetry RMR test. Numerics encrypted; optional link to a same-visit scan of the same user. */
export async function createMetabolicTest(input: CreateMetabolicTestInput): Promise<CreateMetabolicTestResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  let parsed: {
    at: Date; tz: string; localDay: string; method: string; sex: "male" | "female";
    measuredRmrKcal: number; kcalPerLitreO2: number | null; vo2MlMin: number | null; vco2MlMin: number | null; rq: number | null;
    durationMin: number | null; steadyStateCvPct: number | null; ageYears: number; heightCm: number; weightKg: number;
    reportedPredictedKcal: number | null; reportedActivityFactor: number | null;
    fastingHours: number | null; restMinBeforeTest: number | null; roomTempC: number | null; bodyCompScanId: string | null;
  };
  try {
    const { at, tz, localDay } = parseInstant(input.testedAt, input.tz, "test date");
    if (!SEXES.has(input.sex)) throw new ValidationError("Sex must be male or female.");
    const method = str(input.method);
    if (!method || !METHODS.has(method)) throw new ValidationError("Invalid measurement method.");
    parsed = {
      at, tz, localDay, method, sex: input.sex,
      measuredRmrKcal: reqNum(input.measuredRmrKcal, "Measured RMR (kcal)"),
      kcalPerLitreO2: optNum(input.kcalPerLitreO2, "kcal per litre O2"),
      vo2MlMin: optNum(input.vo2MlMin, "VO2"),
      vco2MlMin: optNum(input.vco2MlMin, "VCO2"),
      rq: optNum(input.rq, "RQ"),
      durationMin: optInt(input.durationMin, "Duration (min)"),
      steadyStateCvPct: optNum(input.steadyStateCvPct, "Steady-state CV %"),
      ageYears: reqNum(input.ageYears, "Age"),
      heightCm: reqNum(input.heightCm, "Height (cm)", 100, 250),
      weightKg: reqNum(input.weightKg, "Weight (kg)"),
      reportedPredictedKcal: optNum(input.reportedPredictedKcal, "Reported predicted kcal"),
      reportedActivityFactor: optNum(input.reportedActivityFactor, "Reported activity factor"),
      fastingHours: optNum(input.prep?.fastingHours, "Fasting hours"),
      restMinBeforeTest: optInt(input.prep?.restMinBeforeTest, "Rest before test (min)"),
      roomTempC: optNum(input.roomTempC, "Room temperature", { allowNegative: true }),
      bodyCompScanId: str(input.bodyCompScanId),
    };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    throw e;
  }

  if (parsed.bodyCompScanId) {
    const scan = await prisma.bodyCompScan.findUnique({ where: { id: parsed.bodyCompScanId }, select: { userId: true } });
    if (!scan || scan.userId !== user.id) return { ok: false, error: "Linked scan not found." };
  }

  const prep = input.prep ?? ({} as CreateMetabolicTestInput["prep"]);

  try {
    const test = await prisma.$transaction(async (tx) => {
      const created = await tx.metabolicTest.create({
        data: {
          userId: user.id,
          testedAt: parsed.at,
          localDay: parsed.localDay,
          tz: parsed.tz,
          method: parsed.method,
          deviceLabel: str(input.deviceLabel),
          facility: str(input.facility),
          measuredRmrKcal: encNum(parsed.measuredRmrKcal)!,
          kcalPerLitreO2: encNum(parsed.kcalPerLitreO2),
          vo2MlMin: encNum(parsed.vo2MlMin),
          vco2MlMin: encNum(parsed.vco2MlMin),
          rq: encNum(parsed.rq),
          durationMin: parsed.durationMin,
          steadyStateCvPct: encNum(parsed.steadyStateCvPct),
          sex: parsed.sex,
          ageYears: dec(parsed.ageYears)!,
          heightCm: dec(parsed.heightCm)!,
          weightKg: encNum(parsed.weightKg)!,
          reportedPredictedKcal: encNum(parsed.reportedPredictedKcal),
          reportedPredictionEquation: str(input.reportedPredictionEquation),
          reportedActivityFactor: encNum(parsed.reportedActivityFactor),
          reportedActivityLabel: str(input.reportedActivityLabel),
          prepFasted: bool(prep.fasted),
          prepFastingHours: dec(parsed.fastingHours),
          prepNoCaffeine: bool(prep.noCaffeine),
          prepNoTrainingPriorDay: bool(prep.noTrainingPriorDay),
          prepActiveTravel: bool(prep.activeTravel),
          prepRestMinBeforeTest: parsed.restMinBeforeTest,
          prepRested: bool(prep.rested),
          prepIllnessFree14d: bool(prep.illnessFree14d),
          prepAwakeQuiet: bool(prep.awakeQuiet),
          roomTempC: dec(parsed.roomTempC),
          bodyCompScanId: parsed.bodyCompScanId,
          notes: input.notes?.trim() ? encryptField(input.notes.trim()) : null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "MetabolicTest",
          entityId: created.id,
          field: "create",
          newValue: `${parsed.method} @ ${parsed.at.toISOString()}${parsed.bodyCompScanId ? ` (scan ${parsed.bodyCompScanId})` : ""}`,
        },
      });

      return created;
    });

    revalidatePath("/body");
    return { ok: true, id: test.id };
  } catch (e) {
    console.error("createMetabolicTest failed", e);
    return { ok: false, error: "Could not save the metabolic test. Please try again." };
  }
}

/**
 * The caller's scan nearest an entered instant, within ±1 day — the RMR form inherits its
 * subject block and links to it. Nearest by |scannedAt − date|; null when none is that close.
 */
export async function findScanNear(dateIso: string): Promise<NearScan | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const at = new Date(dateIso ?? "");
  if (Number.isNaN(at.getTime())) return null;
  const rows = await prisma.bodyCompScan.findMany({
    where: { userId: user.id, scannedAt: { gte: new Date(at.getTime() - DAY_MS), lte: new Date(at.getTime() + DAY_MS) } },
    select: { id: true, localDay: true, scannedAt: true, sex: true, ageYears: true, heightCm: true, clinicWeightKg: true },
  });
  if (rows.length === 0) return null;
  const near = rows.reduce((best, r) => (Math.abs(r.scannedAt.getTime() - at.getTime()) < Math.abs(best.scannedAt.getTime() - at.getTime()) ? r : best));
  const weight = decNum(near.clinicWeightKg);
  return {
    id: near.id,
    localDay: near.localDay,
    sex: near.sex === "female" ? "female" : "male",
    ageYears: String(near.ageYears),
    heightCm: String(near.heightCm),
    clinicWeightKg: weight == null ? "" : String(weight),
  };
}

/** Delete a metabolic test. Owner-checked; audited. */
export async function deleteMetabolicTest(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const test = await prisma.metabolicTest.findUnique({ where: { id } });
  if (!test) return { ok: true };
  if (test.userId !== user.id) return { ok: false, error: "Not your metabolic test." };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.metabolicTest.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "MetabolicTest",
          entityId: id,
          field: "delete",
          oldValue: `tested ${test.testedAt.toISOString()}`,
        },
      });
    });
  } catch (e) {
    console.error("deleteMetabolicTest failed", e);
    return { ok: false, error: "Could not delete the metabolic test." };
  }

  revalidatePath("/body");
  return { ok: true };
}
