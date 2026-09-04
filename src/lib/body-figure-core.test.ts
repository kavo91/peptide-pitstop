import { describe, expect, it } from "vitest";
import { DEFAULT_PRECISION, type Region, type RegionValues, type ScanValues } from "./body-comp-core";
import { BAND_REGIONS, LAYER_DOMAIN, LAYER_FLOOR, buildBodyFigureModel, fatHueT, layerStrengths, mapRange } from "./body-figure-core";

// Synthetic subject — never the owner's numbers.
const region = (region: Region, fatG: number, leanG: number, bmcG: number | null = 200, bmdGcm2: number | null = 1.1): RegionValues => {
  const totalG = fatG + leanG + (bmcG ?? 0);
  return { region, bmcG, fatG, leanG, totalG, pctFat: (fatG / totalG) * 100, bmdGcm2 };
};
const scan = (id: string, day: string, regions: RegionValues[]): ScanValues => ({
  id, scannedAt: new Date(`${day}T00:30:00Z`), localDay: day,
  deviceSerial: null, softwareVersion: null, sex: "male", ageYears: 40, heightCm: 178, clinicWeightKg: 82.4,
  totalFatG: 16350, totalLeanG: 63100, totalBmcG: 3000, totalMassG: 82450, pctFat: 19.8, pctFatYn: null, pctFatAm: null,
  vatMassG: null, vatVolumeCm3: null, vatAreaCm2: null, totalBmdGcm2: null, bmdTScore: null, bmdZScore: null, bmdCvPct: null,
  prep: { fasted: null, fastingHours: null, noCaffeine: null, noTrainingPriorDay: null, activeTravel: null, euhydratedVoided: null, illnessFree14d: null },
  creatineStatus: null, ghs: { onGhs: false, daysSinceLastDose: null }, regions,
});
// deliberately out of display order
const BASE = scan("scan_a", "2026-01-15", [
  region("r_leg", 3100, 11200, 610, 1.31), region("gynoid", 2200, 8200, null, null), region("l_leg", 3000, 11000, 600, 1.3),
  region("trunk", 7400, 29000, 900, 1.02), region("android", 1200, 4100, null, null), region("r_arm", 900, 4100, 200, 0.87),
  region("l_arm", 850, 3900, 190, 0.85), region("head", 1100, 3900, 500, 2.1),
]);
const LATER = scan("scan_b", "2026-04-09", [
  region("r_leg", 2780, 11600, 614, 1.32), region("gynoid", 1900, 8500, null, null), region("l_leg", 2700, 11400, 604, 1.31),
  region("trunk", 6150, 30000, 905, 1.03), region("android", 930, 4350, null, null), region("r_arm", 800, 4280, 202, 0.88),
  region("l_arm", 760, 4080, 192, 0.86), region("head", 1080, 3920, 500, 2.1),
]);

describe("drawing helpers", () => {
  it("mapRange clamps and is linear inside the domain", () => {
    expect(mapRange(0, 0, 10, 0, 1)).toBe(0);
    expect(mapRange(5, 0, 10, 0, 1)).toBeCloseTo(0.5, 9);
    expect(mapRange(50, 0, 10, 0, 1)).toBe(1);
    expect(mapRange(-5, 0, 10, 0.2, 1)).toBe(0.2);
  });
  it("layerStrengths sits on the fixed domains with floors, and never exceeds 1", () => {
    const lo = layerStrengths({ fatShare: 0, leanShare: 0, bmdGcm2: 0 });
    expect(lo).toEqual({ fat: LAYER_FLOOR.fat, lean: LAYER_FLOOR.lean, bone: LAYER_FLOOR.bone });
    const hi = layerStrengths({ fatShare: 0.9, leanShare: 0.99, bmdGcm2: 3 });
    expect(hi).toEqual({ fat: 1, lean: 1, bone: 1 });
    const mid = layerStrengths({ fatShare: (LAYER_DOMAIN.fatShare[0] + LAYER_DOMAIN.fatShare[1]) / 2, leanShare: 0.7, bmdGcm2: null });
    expect(mid.fat).toBeCloseTo((LAYER_FLOOR.fat + 1) / 2, 9);
    expect(mid.bone).toBe(LAYER_FLOOR.bone); // null BMD draws at the floor
  });
  it("fatHueT slides 0 → 1 across the fixed %fat window", () => {
    expect(fatHueT(LAYER_DOMAIN.fatHuePct[0])).toBe(0);
    expect(fatHueT(LAYER_DOMAIN.fatHuePct[1])).toBe(1);
    expect(fatHueT(20)).toBeCloseTo(0.5, 9);
    expect(fatHueT(-3)).toBe(0);
  });
});

describe("buildBodyFigureModel — one scan", () => {
  const m = buildBodyFigureModel(BASE);

  it("orders the six body regions head → arms → trunk → legs and the two bands android, gynoid", () => {
    expect(m.paint).toBe("art");
    expect(m.regions.map((c) => c.region)).toEqual(["head", "l_arm", "r_arm", "trunk", "l_leg", "r_leg"]);
    expect(m.bands.map((c) => c.region)).toEqual([...BAND_REGIONS]);
    expect(m.missing).toEqual([]);
    expect(m.change).toBeNull();
    for (const c of [...m.regions, ...m.bands]) expect(c.delta).toBeNull();
  });

  it("splits every region into fat, lean and bone shares that sum to one, in kg and as printed", () => {
    for (const c of [...m.regions, ...m.bands]) { expect(c.fatShare + c.leanShare + c.boneShare).toBeCloseTo(1, 9); expect(c.leanShare).toBeGreaterThan(c.fatShare); }
    const trunk = m.regions.find((c) => c.region === "trunk")!;
    expect(trunk.label).toBe("Trunk");
    expect(trunk.fatShare).toBeCloseTo(7400 / 37300, 9);
    expect(trunk.pctLean).toBeCloseTo((29000 / 37300) * 100, 6);
    expect(trunk.pctBone).toBeCloseTo((900 / 37300) * 100, 6);
    expect(trunk.fatKg).toBeCloseTo(7.4, 6); expect(trunk.leanKg).toBeCloseTo(29.0, 6); expect(trunk.totalKg).toBeCloseTo(37.3, 6);
    expect(trunk.bmcG).toBe(900); expect(trunk.bmdGcm2).toBe(1.02);
  });

  it("gives bands no bone share and a null bone percentage", () => {
    for (const b of m.bands) { expect(b.bmcG).toBeNull(); expect(b.pctBone).toBeNull(); expect(b.boneShare).toBe(0); expect(b.fatShare + b.leanShare).toBeCloseTo(1, 9); }
  });

  it("carries the whole-body totals shown when no region is selected", () => {
    const w = m.wholeBody;
    // synthetic subject: fat 16350 g, lean 63100 g, BMC 3000 g, mass 82450 g, 19.8 %, 178 cm
    expect(w.fatKg).toBeCloseTo(16.35, 9);
    expect(w.leanKg).toBeCloseTo(63.1, 9);
    expect(w.bmcKg).toBeCloseTo(3.0, 9);
    expect(w.massKg).toBeCloseTo(82.45, 9);
    expect(w.pctFat).toBeCloseTo(19.8, 9);
    expect(w.clinicWeightKg).toBeCloseTo(82.4, 9);
    // FFMI = (lean + BMC) / height(m)^2 = 66.1 / 1.78^2
    expect(w.ffmi).toBeCloseTo(66.1 / (1.78 * 1.78), 6);
    expect(w.almi).not.toBeNull();
  });

  it("carries scan identity, ratios and asymmetry as plain numbers and survives JSON", () => {
    expect(m.scanId).toBe("scan_a");
    expect(m.scannedAtMs).toBe(new Date("2026-01-15T00:30:00Z").getTime());
    expect(m.ratios.androidGynoidPctFat).not.toBeNull(); expect(m.asymmetry.armsPct).not.toBeNull();
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });

  it("lists regions the report did not print and leaves them out", () => {
    const partial: ScanValues = { ...BASE, regions: BASE.regions.filter((r) => r.region !== "head" && r.region !== "gynoid") };
    const p = buildBodyFigureModel(partial);
    expect(p.regions.map((c) => c.region)).toEqual(["l_arm", "r_arm", "trunk", "l_leg", "r_leg"]);
    expect(p.bands.map((c) => c.region)).toEqual(["android"]);
    expect(p.missing).toEqual(["head", "gynoid"]);
  });

  it("never divides by zero on a degenerate region", () => {
    const z = buildBodyFigureModel({ ...BASE, regions: [{ region: "head", bmcG: 0, fatG: 0, leanG: 0, totalG: 0, pctFat: 0 }] }).regions[0];
    expect(z.fatShare).toBe(0); expect(z.leanShare).toBe(0); expect(z.boneShare).toBe(0); expect(Number.isFinite(z.pctLean)).toBe(true);
  });
});

describe("buildBodyFigureModel — change versus the previous scan", () => {
  const m = buildBodyFigureModel(LATER, { prev: BASE, precision: DEFAULT_PRECISION, comparability: { hidden: false, demote: false } });

  it("attaches the %fat noise band and the previous scan identity", () => {
    expect(m.change).not.toBeNull();
    expect(m.change!.prevScanId).toBe("scan_a");
    expect(m.change!.prevLocalDay).toBe("2026-01-15");
    expect(m.change!.band.technical).toBe(DEFAULT_PRECISION.pctFatLscAbs);
    expect(m.change!.demoted).toBe(false);
  });

  it("gives every region a signed delta in points and kg, tiered against the band", () => {
    const trunk = m.regions.find((c) => c.region === "trunk")!;
    const prevTrunk = buildBodyFigureModel(BASE).regions.find((c) => c.region === "trunk")!;
    expect(trunk.delta).not.toBeNull();
    expect(trunk.delta!.fatPts).toBeCloseTo(trunk.pctFat - prevTrunk.pctFat, 9);
    expect(trunk.delta!.fatPts).toBeLessThan(0);
    expect(trunk.delta!.fatKg).toBeCloseTo(6.15 - 7.4, 9);
    expect(trunk.delta!.leanPts).toBeGreaterThan(0);
    expect(["within_noise", "indeterminate", "exceeds_lsc"]).toContain(trunk.delta!.tier);
    const head = m.regions.find((c) => c.region === "head")!;
    expect(head.delta!.tier).toBe("within_noise"); // −0.4 pts is inside any default band
    expect(Math.abs(trunk.delta!.multipleOfTechnical)).toBeGreaterThan(Math.abs(head.delta!.multipleOfTechnical));
  });

  it("demotes every tier one step when comparability says so, and hides change entirely when hidden", () => {
    const d = buildBodyFigureModel(LATER, { prev: BASE, precision: DEFAULT_PRECISION, comparability: { hidden: false, demote: true } });
    expect(d.change!.demoted).toBe(true);
    for (const c of d.regions) { expect(c.delta!.demoted).toBe(true); expect(c.delta!.tier).not.toBe("exceeds_lsc"); }
    const h = buildBodyFigureModel(LATER, { prev: BASE, precision: DEFAULT_PRECISION, comparability: { hidden: true, demote: false } });
    expect(h.change).toBeNull();
    for (const c of h.regions) expect(c.delta).toBeNull();
  });

  it("leaves a region's delta null when the previous report lacks that region", () => {
    const prevNoHead: ScanValues = { ...BASE, regions: BASE.regions.filter((r) => r.region !== "head") };
    const m2 = buildBodyFigureModel(LATER, { prev: prevNoHead, precision: DEFAULT_PRECISION });
    expect(m2.change).not.toBeNull();
    expect(m2.regions.find((c) => c.region === "head")!.delta).toBeNull();
    expect(m2.regions.find((c) => c.region === "trunk")!.delta).not.toBeNull();
  });

  it("does not build change without precision", () => {
    expect(buildBodyFigureModel(LATER, { prev: BASE }).change).toBeNull();
  });
});
