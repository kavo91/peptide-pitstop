// src/lib/dexa-prefill.ts — PURE. Parsed Hologic report → the scan form's initial values.
//
// Every number stays the string the scanner printed (the server action parses,
// validates and encrypts). The scanner prints a date but no time, so the scan
// instant defaults to 00:00 local on that date — the form keeps it editable.
import type { ParsedScan } from "@/lib/dexa-parse-core";
import type { CreateScanInput, RegionInput } from "@/app/actions/bodycomp";
import { LIMB_REGIONS } from "@/lib/body-comp-core";

const s = (n: number | null | undefined): string | undefined => (n == null || !Number.isFinite(n) ? undefined : String(n));
const t = (v: string | null | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined);

/**
 * The server accepts region rows only as none, the four limbs, or all eight.
 * All eight parsed → all eight; otherwise the four limb rows when present; else none.
 */
export function regionsForForm(regions: RegionInput[]): RegionInput[] {
  if (regions.length === 8) return regions;
  const limbs = LIMB_REGIONS.map((k) => regions.find((r) => r.region === k)).filter((r): r is RegionInput => r != null);
  return limbs.length === LIMB_REGIONS.length ? limbs : [];
}

/** Parsed report → `Partial<CreateScanInput>` for `BodyCompScanForm`'s `initial` prop. */
export function parsedToScanInitial(scan: ParsedScan): Partial<CreateScanInput> {
  const h = scan.header;
  const scannedAt = h.scanDate ? new Date(`${h.scanDate}T00:00:00`) : null;
  return {
    scannedAt: scannedAt && !Number.isNaN(scannedAt.getTime()) ? scannedAt.toISOString() : undefined,
    deviceMake: "Hologic",
    deviceModel: t(h.deviceModel),
    deviceSerial: t(h.deviceSerial),
    softwareVersion: t(h.softwareVersion),
    scanMode: t(h.scanMode),
    referencePopulation: t(h.referencePopulation),
    sex: h.sex,
    ageYears: String(h.ageYears),
    heightCm: String(h.heightCm),
    clinicWeightKg: s(h.clinicWeightKg),
    totalFatG: String(scan.totals.totalFatG),
    totalLeanG: String(scan.totals.totalLeanG),
    totalBmcG: String(scan.totals.totalBmcG),
    totalMassG: String(scan.totals.totalMassG),
    pctFat: String(scan.totals.pctFat),
    pctFatYn: s(scan.totals.pctFatYn),
    pctFatAm: s(scan.totals.pctFatAm),
    vatMassG: s(scan.vat.massG),
    vatVolumeCm3: s(scan.vat.volumeCm3),
    vatAreaCm2: s(scan.vat.areaCm2),
    totalBmdGcm2: s(scan.bone.totalBmdGcm2),
    bmdTScore: s(scan.bone.tScore),
    bmdZScore: s(scan.bone.zScore),
    bmdCvPct: s(scan.bone.cvPct),
    fmiYn: s(scan.indices.fmiYn),
    fmiAm: s(scan.indices.fmiAm),
    lmiYn: s(scan.indices.lmiYn),
    lmiAm: s(scan.indices.lmiAm),
    almiYn: s(scan.indices.almiYn),
    almiAm: s(scan.indices.almiAm),
    regions: regionsForForm(scan.regions),
  };
}
