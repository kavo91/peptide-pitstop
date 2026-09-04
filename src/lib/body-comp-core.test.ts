// src/lib/body-comp-core.test.ts
import { describe, it, expect } from "vitest";
import { indices, checksums, limbAsymmetry, distributionRatios, heightM2, type ScanValues } from "./body-comp-core";

/** SYNTHETIC subject — never real data. Regions sum exactly to totals. */
export const FIX: ScanValues = {
  id: "s1", scannedAt: new Date("2026-01-10T06:00:00+10:00"), localDay: "2026-01-10",
  deviceSerial: "TEST1", softwareVersion: "APEX 13.6", sex: "male", ageYears: 40, heightCm: 178, clinicWeightKg: 82,
  totalFatG: 16400, totalLeanG: 61800, totalBmcG: 2800, totalMassG: 81000, pctFat: 20.2, pctFatYn: 50, pctFatAm: 40,
  vatMassG: 500, vatVolumeCm3: 540, vatAreaCm2: 104, totalBmdGcm2: 1.2, bmdTScore: 0.1, bmdZScore: 0.1, bmdCvPct: 1.0,
  prep: { fasted: true, fastingHours: 12, noCaffeine: true, noTrainingPriorDay: true, activeTravel: false, euhydratedVoided: true, illnessFree14d: true },
  creatineStatus: "stable", ghs: { onGhs: false, daysSinceLastDose: null },
  regions: [
    { region: "l_arm", bmcG: 200, fatG: 1000, leanG: 3500, totalG: 4700, pctFat: 21.3 },
    { region: "r_arm", bmcG: 210, fatG: 1050, leanG: 3700, totalG: 4960, pctFat: 21.2 },
    { region: "trunk", bmcG: 800, fatG: 7300, leanG: 30000, totalG: 38100, pctFat: 19.2 },
    { region: "l_leg", bmcG: 500, fatG: 2900, leanG: 10600, totalG: 14000, pctFat: 20.7 },
    { region: "r_leg", bmcG: 510, fatG: 2950, leanG: 10700, totalG: 14160, pctFat: 20.8 },
    { region: "head", bmcG: 580, fatG: 1200, leanG: 3300, totalG: 5080, pctFat: 23.6 },
    { region: "android", bmcG: null, fatG: 1200, leanG: 4800, totalG: 6000, pctFat: 20.0 },
    { region: "gynoid", bmcG: null, fatG: 2700, leanG: 10300, totalG: 13000, pctFat: 20.8 },
  ],
};

describe("indices", () => {
  it("computes FFMI, LMI, FMI, ALM, ALMI and recomputed %fat", () => {
    const i = indices(FIX);
    expect(heightM2(178)).toBeCloseTo(3.1684, 4);
    expect(i.ffmKg).toBeCloseTo(64.6, 3);
    expect(i.ffmi).toBeCloseTo(64.6 / 3.1684, 3);
    expect(i.lmi).toBeCloseTo(61.8 / 3.1684, 3);
    expect(i.fmi).toBeCloseTo(16.4 / 3.1684, 3);
    expect(i.almKg).toBeCloseTo(28.5, 3);          // 3.5+3.7+10.6+10.7
    expect(i.almi).toBeCloseTo(28.5 / 3.1684, 3);
    expect(i.pctFatRecomputed).toBeCloseTo(16400 / 81000 * 100, 2);
  });
  it("returns null ALM when limb regions are missing", () => {
    const i = indices({ ...FIX, regions: [] });
    expect(i.almKg).toBeNull(); expect(i.almi).toBeNull(); expect(i.ffmi).toBeCloseTo(64.6 / 3.1684, 3);
  });
});
describe("checksums", () => {
  it("passes on a consistent table", () => { expect(checksums(FIX).every((c) => c.pass)).toBe(true); });
  it("fails when a region is mis-keyed", () => {
    const bad = { ...FIX, regions: FIX.regions.map((r) => r.region === "trunk" ? { ...r, fatG: 9300 } : r) };
    expect(checksums(bad).find((c) => c.name === "fat_sum")!.pass).toBe(false);
  });
  it("marks region checks not evaluated when regions are absent", () => {
    expect(checksums({ ...FIX, regions: [] }).find((c) => c.name === "fat_sum")!.detail).toMatch(/not evaluated/);
  });
});
describe("asymmetry and ratios", () => {
  it("signs right-minus-left over the mean", () => {
    const a = limbAsymmetry(FIX.regions);
    expect(a.armsPct).toBeCloseTo((3700 - 3500) / 3600 * 100, 3);
    expect(a.legsPct).toBeCloseTo((10700 - 10600) / 10650 * 100, 3);
  });
  it("android/gynoid is a %fat ratio; trunk/limb is a mass ratio", () => {
    const r = distributionRatios(FIX);
    expect(r.androidGynoidPctFat).toBeCloseTo(20.0 / 20.8, 3);
    expect(r.trunkLimbFatMass).toBeCloseTo(7300 / (1000 + 1050 + 2900 + 2950), 3);
  });
});

import { DEFAULT_PRECISION, fatLsc, leanLsc, pctFatLsc, almLsc, vatLsc, bmdLsc, rmrLsc, deltaFlag, demoteTier, demoteFlag, ratePer30d, comparability, nextScanDue, intervalCompleteness } from "./body-comp-core";
describe("LSC bands (2.77 × CV)", () => {
  it("fat: technical 2.16% of value, practical ×1.9", () => {
    const b = fatLsc(16.4, DEFAULT_PRECISION);
    expect(b.technical).toBeCloseTo(16.4 * 0.0078 * 2.77, 4);
    expect(b.practical).toBeCloseTo(b.technical * 1.9, 4);
  });
  it("lean: technical from 0.52% CV, practical ×3.4", () => {
    const b = leanLsc(61.8, DEFAULT_PRECISION);
    expect(b.technical).toBeCloseTo(61.8 * 0.0052 * 2.77, 4);
    expect(b.practical).toBeCloseTo(b.technical * 3.4, 4);
  });
  it("%fat: absolute points", () => { expect(pctFatLsc(DEFAULT_PRECISION).technical).toBe(0.5); expect(pctFatLsc(DEFAULT_PRECISION).practical).toBeCloseTo(1.7, 4); });
  it("ALM has no practical band", () => { expect(almLsc(28.5, DEFAULT_PRECISION).practical).toBeNull(); });
  it("VAT practical is 2× technical; BMD and RMR are single numbers", () => {
    expect(vatLsc(500, DEFAULT_PRECISION).practical).toBeCloseTo(vatLsc(500, DEFAULT_PRECISION).technical * 2, 6);
    expect(bmdLsc(1.2, 1.0)).toBeCloseTo(1.2 * 0.01 * 2.77, 6);
    expect(rmrLsc(1800, DEFAULT_PRECISION)).toBeCloseTo(1800 * 0.08 * 2.77, 4);
  });
});
describe("deltaFlag", () => {
  const band = { technical: 0.3, practical: 1.2 };
  it("within noise below technical (boundary inclusive on technical → indeterminate)", () => {
    expect(deltaFlag(16.4, 16.2, band).tier).toBe("within_noise");
    expect(deltaFlag(16.4, 16.1, band).tier).toBe("indeterminate");       // |Δ| = 0.3 = technical
    expect(deltaFlag(16.4, 15.2, band).tier).toBe("exceeds_lsc");         // |Δ| = 1.2 = practical
    expect(deltaFlag(16.4, 15.9, band).multipleOfTechnical).toBeCloseTo(0.5 / 0.3, 4);
  });
  it("without a practical band the top tier is unreachable", () => {
    expect(deltaFlag(28.5, 26.0, { technical: 0.66, practical: null }).tier).toBe("indeterminate");
  });
  it("demote lowers one tier and floors at within_noise", () => {
    expect(demoteTier("exceeds_lsc")).toBe("indeterminate"); expect(demoteTier("indeterminate")).toBe("within_noise"); expect(demoteTier("within_noise")).toBe("within_noise");
    // demoteFlag keeps the undemoted tier and marks the flag, so surfaces can print "exceeds LSC (demoted)" instead of a tier the multiple contradicts.
    const raw = deltaFlag(16.4, 15.2, { technical: 0.3, practical: 1.2 });
    const d = demoteFlag(raw);
    expect(d).toMatchObject({ tier: "indeterminate", rawTier: "exceeds_lsc", demoted: true, delta: raw.delta, multipleOfTechnical: raw.multipleOfTechnical });
    expect(raw.demoted).toBeUndefined();
    expect(demoteFlag(d).rawTier).toBe("exceeds_lsc"); // a second demotion never loses the original tier
  });
});
describe("ratePer30d", () => {
  it("is null inside technical LSC or under 28 days", () => {
    expect(ratePer30d(0.2, 90, { technical: 0.3, practical: 1.2 })).toBeNull();
    expect(ratePer30d(2.0, 20, { technical: 0.3, practical: 1.2 })).toBeNull();
    expect(ratePer30d(-1.5, 90, { technical: 0.3, practical: 1.2 })).toBeCloseTo(-0.5, 6);
  });
});
describe("comparability", () => {
  const a = FIX; const b: ScanValues = { ...FIX, id: "s2", scannedAt: new Date("2026-04-10T06:00:00+10:00"), localDay: "2026-04-10" };
  it("identical device + prep + state is comparable", () => { expect(comparability(a, b)).toMatchObject({ comparable: true, hidden: false, demote: false }); });
  it("different serial hides deltas", () => { expect(comparability(a, { ...b, deviceSerial: "OTHER" }).hidden).toBe(true); });
  it("unknown prep on either side demotes", () => { expect(comparability(a, { ...b, prep: { ...b.prep, fasted: null } }).demote).toBe(true); });
  it("different creatine or secretagogue state demotes with a reason", () => {
    const r = comparability(a, { ...b, ghs: { onGhs: true, daysSinceLastDose: 1 } });
    expect(r.demote).toBe(true); expect(r.reasons.join(" ")).toMatch(/secretagogue/);
  });
});
describe("nextScanDue", () => {
  it("opens at +84 days and closes at +112 days", () => {
    const d = nextScanDue(new Date("2026-01-10T00:00:00Z"), new Date("2026-02-01T00:00:00Z"));
    expect(d.dueStart.toISOString().slice(0, 10)).toBe("2026-04-04"); expect(d.dueEnd.toISOString().slice(0, 10)).toBe("2026-05-02"); expect(d.status).toBe("upcoming");
    expect(nextScanDue(new Date("2026-01-10T00:00:00Z"), new Date("2026-04-10T00:00:00Z")).status).toBe("in_window");
    expect(nextScanDue(new Date("2026-01-10T00:00:00Z"), new Date("2026-06-10T00:00:00Z")).status).toBe("window_passed");
  });
});
describe("intervalCompleteness", () => {
  it("blocks attribution when intake is under 80% logged", () => {
    expect(intervalCompleteness({ prepMatched: true, intakeLoggedPct: 0, weightDaysPct: 90, trainingDaysPct: 90, lifeEventsTagged: true }).attributionBlocked).toBe(true);
    expect(intervalCompleteness({ prepMatched: true, intakeLoggedPct: 85, weightDaysPct: 90, trainingDaysPct: 90, lifeEventsTagged: true }).attributionBlocked).toBe(false);
  });
});

import { rmrEquations, rmrPerKg, vo2FromRmr, biaOffset, calibrateBia, cleanWeightSeries } from "./body-comp-core";
describe("rmrEquations", () => {
  const rows = rmrEquations({ rmrKcal: 1900, sex: "male", ageYears: 40, heightCm: 178, weightKg: 82, ffmKg: 64.6 });
  const by = (k: string) => rows.find((r) => r.key === k)!;
  it("matches hand-computed predictions", () => {
    expect(by("mifflin").predictedKcal).toBeCloseTo(10 * 82 + 6.25 * 178 - 5 * 40 + 5, 1);
    expect(by("harris_benedict_roza").predictedKcal).toBeCloseTo(88.362 + 13.397 * 82 + 4.799 * 178 - 5.677 * 40, 1);
    expect(by("katch_mcardle").predictedKcal).toBeCloseTo(370 + 21.6 * 64.6, 1);
    expect(by("cunningham_1980").predictedKcal).toBeCloseTo(500 + 22 * 64.6, 1);
    expect(by("ten_haaf_ffm").predictedKcal).toBeCloseTo((95.272 * 64.6 + 2026.161) / 4.184, 1);
    expect(by("ten_haaf_weight").predictedKcal).toBeCloseTo((49.94 * 82 + 2459.053 * 1.78 - 34.014 * 40 + 799.257 + 122.502) / 4.184, 1);
    expect(by("tinsley_2019_ffm").predictedKcal).toBeCloseTo(25.9 * 64.6 + 284, 1);
    expect(by("tinsley_2019_ffm").primary).toBe(true);
    expect(by("mifflin").ratio).toBeCloseTo(1900 / by("mifflin").predictedKcal!, 4);
  });
  it("female Mifflin uses −161 and FFM rows are null without FFM", () => {
    const f = rmrEquations({ rmrKcal: 1400, sex: "female", ageYears: 30, heightCm: 165, weightKg: 60, ffmKg: null });
    expect(f.find((r) => r.key === "mifflin")!.predictedKcal).toBeCloseTo(10 * 60 + 6.25 * 165 - 5 * 30 - 161, 1);
    expect(f.find((r) => r.key === "cunningham_1980")!.predictedKcal).toBeNull();
    expect(f.find((r) => r.primary)!.key).toBe("mifflin");
  });
});
describe("rmrPerKg and VO2", () => {
  it("names its denominators", () => {
    const k = rmrPerKg(1900, 64.6, 61.8, 82);
    expect(k.perKgFfm).toBeCloseTo(1900 / 64.6, 3); expect(k.perKgLean).toBeCloseTo(1900 / 61.8, 3); expect(k.perKgBodyMass).toBeCloseTo(1900 / 82, 3);
  });
  it("converts kcal/day to VO2 and METs", () => {
    const v = vo2FromRmr(1900, 4.81, 82);
    expect(v.litresPerDay).toBeCloseTo(1900 / 4.81, 3); expect(v.mlPerMin).toBeCloseTo((1900 / 4.81) * 1000 / 1440, 3); expect(v.mets).toBeCloseTo(v.mlPerMin / 82 / 3.5, 3);
  });
});
describe("BIA offset and weight cleaning", () => {
  const scale = [
    { day: "2026-01-09", bodyFatPct: 16.1, weightKg: 81.9 }, { day: "2026-01-10", bodyFatPct: 16.4, weightKg: 82.2 }, { day: "2026-01-11", bodyFatPct: 16.0, weightKg: 82.0 },
  ];
  it("uses the same-day reading first, then ±1 day; null beyond", () => {
    expect(biaOffset(24.0, scale, "2026-01-10")).toEqual({ offsetPts: 7.6, scaleDay: "2026-01-10", anchorWeightKg: 82.2 });
    expect(biaOffset(24.0, scale.filter((s) => s.day !== "2026-01-10"), "2026-01-10")!.scaleDay).toBe("2026-01-09");
    expect(biaOffset(24.0, [], "2026-01-10")).toBeNull();
  });
  it("calibrates additively and drops points > 3 kg from the anchor", () => {
    const out = calibrateBia([{ day: "2026-02-01", bodyFatPct: 16.5, weightKg: 82.5 }, { day: "2026-02-02", bodyFatPct: 15.0, weightKg: 78.0 }], 7.6, 82.2);
    expect(out[0].calibratedPct).toBeCloseTo(24.1, 6); expect(out[1].calibratedPct).toBeNull();
  });
  it("drops readings more than 3 kg from the 7-day rolling median and counts them", () => {
    const rows = ["01", "02", "03", "04", "05", "06", "07", "08"].map((d, i) => ({ day: `2026-01-${d}`, weightKg: i === 5 ? 74.0 : 82 + (i % 2) * 0.2 }));
    const r = cleanWeightSeries(rows);
    expect(r.excluded).toHaveLength(1); expect(r.excluded[0].day).toBe("2026-01-06"); expect(r.kept).toHaveLength(7);
  });
});
