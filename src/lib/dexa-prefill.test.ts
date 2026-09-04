import { describe, expect, it } from "vitest";
import { parsedToScanInitial, regionsForForm } from "./dexa-prefill";
import type { ParsedScan } from "./dexa-parse-core";
import type { RegionInput } from "@/app/actions/bodycomp";

// SYNTHETIC values (the phase-1 invented subject). Serial TEST1, reference NHANES-Example.
const row = (region: RegionInput["region"], fatG: string, leanG: string, totalG: string, pctFat: string, extra: Partial<RegionInput> = {}): RegionInput => ({
  region, fatG, leanG, totalG, pctFat, ...extra,
});
const EIGHT: RegionInput[] = [
  row("l_arm", "1000", "3500", "4700", "21.3", { bmcG: "200", pctFatYn: "55", pctFatAm: "45", bmdGcm2: "0.800" }),
  row("r_arm", "1050", "3700", "4960", "21.2", { bmcG: "210" }),
  row("trunk", "7300", "30000", "38100", "19.2", { bmcG: "800" }),
  row("l_leg", "2900", "10600", "14000", "20.7", { bmcG: "500" }),
  row("r_leg", "2950", "10700", "14160", "20.8", { bmcG: "510" }),
  row("head", "1200", "3300", "5080", "23.6", { bmcG: "580" }),
  row("android", "1200", "4800", "6000", "20.0"),
  row("gynoid", "2700", "10300", "13000", "20.8"),
];

const SCAN: ParsedScan = {
  header: {
    sex: "male", heightCm: 178, clinicWeightKg: 82, ageYears: 40, scanDate: "2026-01-10", scanDateRaw: "10 January 2026",
    softwareVersion: "13.6", deviceModel: "Horizon A", deviceSerial: "TEST1", scanMode: "Whole Body", referencePopulation: "NHANES-Example",
  },
  totals: { totalFatG: 16400, totalLeanG: 61800, totalBmcG: 2800, totalMassG: 81000, pctFat: 20.2, pctFatYn: 50, pctFatAm: 40 },
  regions: EIGHT,
  vat: { massG: 500, volumeCm3: 540, areaCm2: 104 },
  bone: { totalBmdGcm2: 1.2, tScore: 0.1, zScore: 0.1, cvPct: 1 },
  indices: { fmi: 5.18, fmiYn: 45, fmiAm: 38, lmi: 19.5, lmiYn: 60, lmiAm: 55, almi: 8.99, almiYn: 62, almiAm: 58, androidGynoid: 0.96 },
};

describe("parsedToScanInitial", () => {
  it("maps every printed value to the form's string fields; the scan instant is 00:00 local on the printed date", () => {
    const out = parsedToScanInitial(SCAN);
    expect(out.scannedAt).toBe(new Date("2026-01-10T00:00:00").toISOString());
    expect(out).toMatchObject({
      deviceMake: "Hologic", deviceModel: "Horizon A", deviceSerial: "TEST1", softwareVersion: "13.6", scanMode: "Whole Body", referencePopulation: "NHANES-Example",
      sex: "male", ageYears: "40", heightCm: "178", clinicWeightKg: "82",
      totalFatG: "16400", totalLeanG: "61800", totalBmcG: "2800", totalMassG: "81000", pctFat: "20.2", pctFatYn: "50", pctFatAm: "40",
      vatMassG: "500", vatVolumeCm3: "540", vatAreaCm2: "104",
      totalBmdGcm2: "1.2", bmdTScore: "0.1", bmdZScore: "0.1", bmdCvPct: "1",
      fmiYn: "45", fmiAm: "38", lmiYn: "60", lmiAm: "55", almiYn: "62", almiAm: "58",
    });
    expect(out.regions).toEqual(EIGHT);
    // Nothing the parser does not read is invented.
    expect(out).not.toHaveProperty("facility");
    expect(out).not.toHaveProperty("prep");
    expect(out).not.toHaveProperty("notes");
  });

  it("omits optional values the report did not print instead of sending empty strings or 'null'", () => {
    const sparse: ParsedScan = {
      ...SCAN,
      header: { ...SCAN.header, clinicWeightKg: null, scanDate: null, scanDateRaw: null, deviceSerial: null, scanMode: null },
      totals: { ...SCAN.totals, pctFatYn: null, pctFatAm: null },
      vat: { massG: null, volumeCm3: null, areaCm2: null },
      bone: { totalBmdGcm2: null, tScore: null, zScore: null, cvPct: null },
      indices: { fmi: null, fmiYn: null, fmiAm: null, lmi: null, lmiYn: null, lmiAm: null, almi: null, almiYn: null, almiAm: null, androidGynoid: null },
    };
    const out = parsedToScanInitial(sparse);
    for (const k of ["scannedAt", "clinicWeightKg", "deviceSerial", "scanMode", "pctFatYn", "vatMassG", "totalBmdGcm2", "bmdTScore", "fmiYn", "almiAm"] as const) {
      expect(out[k]).toBeUndefined();
    }
    expect(JSON.stringify(out)).not.toContain("null");
  });
});

describe("regionsForForm — only shapes the server accepts", () => {
  it("all eight rows pass through unchanged", () => {
    expect(regionsForForm(EIGHT)).toBe(EIGHT);
  });
  it("six body rows (no android/gynoid) reduce to the four limbs, in limb order", () => {
    const six = EIGHT.slice(0, 6);
    expect(regionsForForm(six).map((r) => r.region)).toEqual(["l_arm", "r_arm", "l_leg", "r_leg"]);
  });
  it("anything short of the four limbs sends no rows", () => {
    expect(regionsForForm(EIGHT.slice(0, 3))).toEqual([]);
    expect(regionsForForm([])).toEqual([]);
  });
});
