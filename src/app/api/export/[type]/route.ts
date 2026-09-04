import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import { formatSideEffects } from "@/lib/side-effects";
import { toCsv } from "@/lib/csv";
import { expandBlendDose, type BlendComponent } from "@/lib/blends-core";

export const dynamic = "force-dynamic";

/**
 * GET /api/export/{doses|labs|journal|wearable|bodycomp|rmr}
 *
 * Owner-scoped CSV export of the current user's data. Authenticated by the
 * session cookie (the browser sends it on the download link); not logged in →
 * 401, unknown type → 404. Encrypted columns (per schema `// ENCRYPTED`) are
 * decrypted server-side before emitting; the encrypted `raw` wearable blob and
 * any secret columns (totpSecret, passwordHash) are never included. The body
 * composition exports additionally omit `deviceSerial`, `reportJson` and
 * `notes` (spec §5.3, last row).
 *
 * Responds `text/csv; charset=utf-8` with a `<type>-YYYY-MM-DD.csv` attachment
 * filename (container-local date).
 */

const EXPORT_TYPES = ["doses", "labs", "journal", "wearable", "bodycomp", "rmr"] as const;
type ExportType = (typeof EXPORT_TYPES)[number];

function isExportType(t: string): t is ExportType {
  return (EXPORT_TYPES as readonly string[]).includes(t);
}

/** Decimal (or anything stringifiable) → string, preserving null. */
/** Body-comp cells: a corrupt ciphertext or rotated key yields an empty cell, never a failed export. */
function decEnc(v: string | null | undefined): string | null {
  try {
    return decryptField(v);
  } catch (e) {
    console.warn("[export] decrypt failed", e);
    return null;
  }
}

function dec(v: { toString(): string } | null | undefined): string | null {
  return v == null ? null : v.toString();
}

/** Date → ISO-8601 string, preserving null. */
function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** Tri-state boolean → "true" | "false", preserving null (= not recorded). */
function tri(b: boolean | null | undefined): string | null {
  return b == null ? null : b ? "true" : "false";
}

/** Container-local YYYY-MM-DD for the download filename. */
function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type CsvData = { headers: string[]; rows: (string | number | null | undefined)[][] };

async function buildDoses(userId: string): Promise<CsvData> {
  const logs = await prisma.doseLog.findMany({
    where: { userId },
    orderBy: { takenAt: "desc" },
    include: {
      preparation: { include: { vial: { include: { peptide: true } } } },
      protocol: { include: { peptide: true } },
    },
  });

  // Vendor blends are one Peptide dosing the whole blend. Without expansion the
  // export hides what was actually administered — a clinician reading
  // "KLOW 3200 mcg" cannot recover the copper peptide, BPC-157, TB-500 and KPV
  // inside it. Each blend dose therefore emits its own row PLUS one row per
  // component carrying the DERIVED mass, tagged in `derivedFromBlend` so it can
  // never be mistaken for a separately logged dose.
  const componentRows = await prisma.blendComponent.findMany({
    where: { peptide: { userId } },
    include: { peptide: { select: { name: true } }, componentPeptide: { select: { name: true } } },
    orderBy: { sortIndex: "asc" },
  });
  const componentsByBlend = new Map<string, BlendComponent[]>();
  const blendName = new Map<string, string>();
  for (const r of componentRows) {
    blendName.set(r.peptideId, r.peptide.name);
    const list = componentsByBlend.get(r.peptideId) ?? [];
    list.push({
      componentPeptideId: r.componentPeptideId,
      componentName: r.componentPeptide.name,
      massMg: Number(r.massMg.toString()),
      source: r.source as BlendComponent["source"],
      sortIndex: r.sortIndex,
    });
    componentsByBlend.set(r.peptideId, list);
  }

  const rows: (string | number | null | undefined)[][] = [];
  for (const d of logs) {
    const peptideId = d.preparation?.vial?.peptideId ?? d.protocol?.peptideId ?? null;
    const name = d.preparation?.vial?.peptide?.name ?? d.protocol?.peptide?.name ?? null;
    const base = [
      iso(d.takenAt),
      d.localDay,
      d.tz,
      name,
      d.route ?? "injection",
      dec(d.doseMcg),
      d.doseInputUnit,
      dec(d.volumeMl),
      dec(d.syringeUnits),
      d.injectionSite,
      d.source,
      iso(d.scheduledAt),
      d.deltaMinutes,
      decryptField(d.notes),
    ];
    rows.push([...base, null]);

    const components = peptideId ? componentsByBlend.get(peptideId) : undefined;
    if (!components?.length) continue;
    for (const part of expandBlendDose(Number(d.doseMcg.toString()), components)) {
      rows.push([
        iso(d.takenAt), d.localDay, d.tz,
        // Distinct label: a component row must never be name-identical to a
        // separately LOGGED dose of the same compound, or a per-peptide
        // grouping silently merges measured and derived mass.
        `${part.componentName} (derived)`,
        d.route ?? "injection",
        // 4 dp — raw float artefacts (…3333333374) read as spurious precision.
        Math.round(part.doseMcg * 10000) / 10000,
        "mcg",
        null, null,
        d.injectionSite,
        d.source,
        iso(d.scheduledAt),
        d.deltaMinutes,
        null,
        `${blendName.get(peptideId!) ?? "blend"} (derived, ${part.source})`,
      ]);
    }
  }

  return {
    headers: [
      "takenAt", "localDay", "tz", "peptide", "route", "doseMcg", "doseInputUnit", "volumeMl", "syringeUnits",
      "injectionSite", "source", "scheduledAt", "deltaMinutes", "notes", "derivedFromBlend",
    ],
    rows,
  };
}

async function buildLabs(userId: string): Promise<CsvData> {
  // One row per LabResult, joined to its panel + biomarker.
  const results = await prisma.labResult.findMany({
    where: { labPanel: { userId } },
    orderBy: [{ labPanel: { collectedDate: "desc" } }],
    include: { biomarker: true, labPanel: true },
  });
  return {
    headers: [
      "collectedDate", "labSource", "biomarker", "value", "unit",
      "referenceLow", "referenceHigh", "flag", "panelNotes",
    ],
    rows: results.map((r) => [
      iso(r.labPanel.collectedDate),
      r.labPanel.labSource,
      r.biomarker.name,
      decryptField(r.value),
      r.unit,
      dec(r.referenceLow),
      dec(r.referenceHigh),
      r.flag,
      decryptField(r.labPanel.notes),
    ]),
  };
}

async function buildJournal(userId: string): Promise<CsvData> {
  const entries = await prisma.journalEntry.findMany({
    where: { userId },
    orderBy: { date: "desc" },
  });
  return {
    headers: [
      "date", "weight", "weightUnit", "mood", "energy", "sleep",
      "calories", "proteinG", "waterMl", "sideEffects", "notes",
    ],
    rows: entries.map((e) => [
      iso(e.date),
      dec(e.weight),
      e.weightUnit,
      e.mood,
      e.energy,
      dec(e.sleep),
      e.calories,
      dec(e.proteinG),
      e.waterMl,
      formatSideEffects(decryptField(e.sideEffects)),
      decryptField(e.notes),
    ]),
  };
}

async function buildWearable(userId: string): Promise<CsvData> {
  // Numeric/plaintext columns only — the encrypted `raw` blob is excluded.
  const days = await prisma.wearableDaily.findMany({
    where: { userId },
    orderBy: { date: "desc" },
  });
  return {
    headers: [
      "date", "source",
      "sleepSeconds", "sleepDeepSeconds", "sleepLightSeconds", "sleepRemSeconds",
      "sleepAwakeSeconds", "sleepScore",
      "restingHr", "hrvMs", "hrvStatus", "bodyBatteryHigh", "bodyBatteryLow", "stressAvg",
      "weightKg", "bmi", "bodyFatPct",
      "steps", "caloriesActive", "vo2max", "intensityMinutes",
      "spo2Avg", "respirationAvg", "syncedAt",
    ],
    rows: days.map((w) => [
      iso(w.date),
      w.source,
      w.sleepSeconds, w.sleepDeepSeconds, w.sleepLightSeconds, w.sleepRemSeconds,
      w.sleepAwakeSeconds, w.sleepScore,
      w.restingHr, dec(w.hrvMs), w.hrvStatus, w.bodyBatteryHigh, w.bodyBatteryLow, w.stressAvg,
      dec(w.weightKg), dec(w.bmi), dec(w.bodyFatPct),
      w.steps, w.caloriesActive, dec(w.vo2max), w.intensityMinutes,
      w.spo2Avg, dec(w.respirationAvg), iso(w.syncedAt),
    ]),
  };
}

/** APEX print order for the regional rows; unknown regions sort last, alphabetically. */
const REGION_ORDER = ["l_arm", "r_arm", "trunk", "l_leg", "r_leg", "head", "android", "gynoid"];
function regionRank(region: string): number {
  const i = REGION_ORDER.indexOf(region);
  return i === -1 ? REGION_ORDER.length : i;
}

async function buildBodyComp(userId: string): Promise<CsvData> {
  // One row per stored region plus a `total` row per scan, in report order.
  // Every report-derived number is an ENCRYPTED string at rest — decrypted here.
  // Scan-level context (device, height, clinic weight, prep) repeats on every
  // row so each row stands alone; the scan-only measurements (VAT, whole-body
  // BMD, Z-score) appear on the `total` row only so they cannot be misread as
  // regional values. `deviceSerial`, `reportJson` and `notes` are never emitted.
  const scans = await prisma.bodyCompScan.findMany({
    where: { userId },
    orderBy: { scannedAt: "desc" },
    include: { regions: true },
  });

  const rows: (string | number | null | undefined)[][] = [];
  for (const s of scans) {
    const context = [iso(s.scannedAt), s.localDay, s.deviceModel, s.softwareVersion];
    const tail = [
      dec(s.heightCm),
      decEnc(s.clinicWeightKg),
      tri(s.prepFasted),
      tri(s.prepNoCaffeine),
      tri(s.prepNoTrainingPriorDay),
      tri(s.prepActiveTravel),
      s.creatineStatus,
    ];
    const regions = [...s.regions].sort(
      (a, b) => regionRank(a.region) - regionRank(b.region) || a.region.localeCompare(b.region),
    );
    for (const r of regions) {
      rows.push([
        ...context,
        r.region,
        decEnc(r.bmcG),
        decEnc(r.fatG),
        decEnc(r.leanG),
        decEnc(r.totalG),
        decEnc(r.pctFat),
        decEnc(r.pctFatYn),
        decEnc(r.pctFatAm),
        decEnc(r.bmdGcm2),
        null, null, null, null, // vatMassG, vatAreaCm2, totalBmdGcm2, bmdZScore — whole-body only
        ...tail,
      ]);
    }
    rows.push([
      ...context,
      "total",
      decEnc(s.totalBmcG),
      decEnc(s.totalFatG),
      decEnc(s.totalLeanG),
      decEnc(s.totalMassG),
      decEnc(s.pctFat),
      decEnc(s.pctFatYn),
      decEnc(s.pctFatAm),
      null, // bmdGcm2 is regional; the whole-body value is totalBmdGcm2
      decEnc(s.vatMassG),
      decEnc(s.vatAreaCm2),
      decEnc(s.totalBmdGcm2),
      decEnc(s.bmdZScore),
      ...tail,
    ]);
  }

  return {
    headers: [
      "scannedAt", "localDay", "deviceModel", "softwareVersion", "region",
      "bmcG", "fatG", "leanG", "totalG", "pctFat", "pctFatYn", "pctFatAm", "bmdGcm2",
      "vatMassG", "vatAreaCm2", "totalBmdGcm2", "bmdZScore",
      "heightCm", "clinicWeightKg",
      "prepFasted", "prepNoCaffeine", "prepNoTrainingPriorDay", "prepActiveTravel", "creatineStatus",
    ],
    rows,
  };
}

async function buildRmr(userId: string): Promise<CsvData> {
  // One row per MetabolicTest: decrypted numerics, method, equation inputs as
  // fed to the clinic, prep fields. The same-visit scan is referenced by its
  // localDay (not its id). `notes` and the attached document are never emitted.
  const tests = await prisma.metabolicTest.findMany({
    where: { userId },
    orderBy: { testedAt: "desc" },
    include: { bodyCompScan: { select: { localDay: true } } },
  });
  return {
    headers: [
      "testedAt", "localDay", "tz", "method", "deviceLabel",
      "measuredRmrKcal", "kcalPerLitreO2", "vo2MlMin", "vco2MlMin", "rq", "durationMin", "steadyStateCvPct",
      "sex", "ageYears", "heightCm", "weightKg",
      "reportedPredictedKcal", "reportedPredictionEquation", "reportedActivityFactor", "reportedActivityLabel",
      "prepFasted", "prepFastingHours", "prepNoCaffeine", "prepNoTrainingPriorDay", "prepActiveTravel",
      "prepRestMinBeforeTest", "prepRested", "prepIllnessFree14d", "prepAwakeQuiet", "roomTempC",
      "linkedScanLocalDay",
    ],
    rows: tests.map((t) => [
      iso(t.testedAt), t.localDay, t.tz, t.method, t.deviceLabel,
      decEnc(t.measuredRmrKcal),
      decEnc(t.kcalPerLitreO2),
      decEnc(t.vo2MlMin),
      decEnc(t.vco2MlMin),
      decEnc(t.rq),
      t.durationMin,
      decEnc(t.steadyStateCvPct),
      t.sex, dec(t.ageYears), dec(t.heightCm), decEnc(t.weightKg),
      decEnc(t.reportedPredictedKcal),
      t.reportedPredictionEquation,
      decEnc(t.reportedActivityFactor),
      t.reportedActivityLabel,
      tri(t.prepFasted), dec(t.prepFastingHours), tri(t.prepNoCaffeine), tri(t.prepNoTrainingPriorDay),
      tri(t.prepActiveTravel), t.prepRestMinBeforeTest, tri(t.prepRested), tri(t.prepIllnessFree14d), tri(t.prepAwakeQuiet),
      dec(t.roomTempC),
      t.bodyCompScan?.localDay ?? null,
    ]),
  };
}

const BUILDERS: Record<ExportType, (userId: string) => Promise<CsvData>> = {
  doses: buildDoses,
  labs: buildLabs,
  journal: buildJournal,
  wearable: buildWearable,
  bodycomp: buildBodyComp,
  rmr: buildRmr,
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  // Tolerate an explicit ".csv" suffix on the path segment.
  const type = (await params).type.replace(/\.csv$/, "");
  if (!isExportType(type)) {
    return NextResponse.json({ ok: false, error: "Unknown export type" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { headers, rows } = await BUILDERS[type](user.id);
    const csv = toCsv(headers, rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${type}-${localDateStr()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error(`[export/${type}] error`, err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
