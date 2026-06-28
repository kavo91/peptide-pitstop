import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  computeConcentrationMcgPerMl,
  canonicaliseDose,
  computeDraw,
  dosesPerVial,
  mgToMcg,
} from "./engine";
import type { Preparation, Syringe } from "./types";

// --- Fixtures -------------------------------------------------------------

const u100_1ml: Syringe = {
  name: "1 mL U-100 insulin",
  graduationType: "units",
  unitsPerMl: 100,
  capacityMl: 1,
  capacityUnits: 100,
  increment: 1,
};
const u100_half: Syringe = {
  name: "0.5 mL U-100 insulin",
  graduationType: "units",
  unitsPerMl: 100,
  capacityMl: "0.5",
  capacityUnits: 50,
  increment: 1,
};
const u100_03: Syringe = {
  name: "0.3 mL U-100 insulin",
  graduationType: "units",
  unitsPerMl: 100,
  capacityMl: "0.3",
  capacityUnits: 30,
  increment: 1,
};
const ml_1ml: Syringe = {
  name: "1 mL mL-graduated",
  graduationType: "ml",
  unitsPerMl: 100,
  capacityMl: 1,
  capacityUnits: 100,
  increment: "0.01",
};

// Thymosin Alpha-1: premixed 3000 mcg/mL (real prescription).
const thymosin: Preparation = {
  prepType: "premixed",
  concentrationMcgPerMl: new Decimal(3000),
};

// --- Real prescription: Thymosin Alpha-1, 0.5 mL = 1.5 mg ------------------

describe("Thymosin Alpha-1 (real prescription)", () => {
  it("0.5 mL on a 1 mL U-100 syringe = 50 units = 1500 mcg, no rounding error", () => {
    const r = computeDraw({
      dose: { value: "0.5", unit: "ml" },
      preparation: thymosin,
      syringe: u100_1ml,
    });
    expect(r.targetMassMcg.toNumber()).toBe(1500);
    expect(r.targetVolumeMl.toNumber()).toBe(0.5);
    expect(r.markingValue.toNumber()).toBe(50);
    expect(r.markingScale).toBe("units");
    expect(r.deliveredMassMcg.toNumber()).toBe(1500);
    expect(r.roundingErrorMcg.toNumber()).toBe(0);
    expect(r.warnings.some((w) => w.severity === "block")).toBe(false);
  });

  it("the same dose is identical whether entered as mL, mg, mcg, or units", () => {
    const base = { preparation: thymosin, syringe: u100_1ml };
    const asMl = computeDraw({ ...base, dose: { value: "0.5", unit: "ml" } });
    const asMg = computeDraw({ ...base, dose: { value: "1.5", unit: "mg" } });
    const asMcg = computeDraw({ ...base, dose: { value: "1500", unit: "mcg" } });
    const asUnits = computeDraw({ ...base, dose: { value: "50", unit: "units" } });
    for (const r of [asMg, asMcg, asUnits]) {
      expect(r.markingValue.toNumber()).toBe(asMl.markingValue.toNumber());
      expect(r.deliveredMassMcg.toNumber()).toBe(asMl.deliveredMassMcg.toNumber());
      expect(r.targetVolumeMl.toNumber()).toBe(asMl.targetVolumeMl.toNumber());
    }
  });

  it("on a 0.5 mL syringe it fills the whole barrel (warns, not blocks)", () => {
    const r = computeDraw({
      dose: { value: "0.5", unit: "ml" },
      preparation: thymosin,
      syringe: u100_half,
    });
    expect(r.markingValue.toNumber()).toBe(50);
    expect(r.warnings.some((w) => w.code === "FULL_BARREL")).toBe(true);
    expect(r.warnings.some((w) => w.severity === "block")).toBe(false);
  });

  it("on a 0.3 mL syringe it does not fit (blocks)", () => {
    const r = computeDraw({
      dose: { value: "0.5", unit: "ml" },
      preparation: thymosin,
      syringe: u100_03,
    });
    expect(r.warnings.some((w) => w.code === "EXCEEDS_SYRINGE_CAPACITY")).toBe(true);
  });

  it("on an mL-graduated syringe, draw to the 0.5 mL mark", () => {
    const r = computeDraw({
      dose: { value: "1.5", unit: "mg" },
      preparation: thymosin,
      syringe: ml_1ml,
    });
    expect(r.markingScale).toBe("ml");
    expect(r.markingValue.toNumber()).toBe(0.5);
  });

  it("a 5 mL vial yields 10 doses of 0.5 mL", () => {
    expect(dosesPerVial({ totalVolumeMl: 5, doseVolumeMl: "0.5" }).toNumber()).toBe(10);
  });
});

// --- Reconstituted vial: BPC-157 ------------------------------------------

describe("BPC-157 (reconstituted)", () => {
  const conc = computeConcentrationMcgPerMl({ totalMassMg: 5, bacWaterMl: 2 });
  const bpc: Preparation = { prepType: "reconstituted", concentrationMcgPerMl: conc };

  it("5 mg in 2 mL BAC = 2500 mcg/mL", () => {
    expect(conc.toNumber()).toBe(2500);
  });

  it("400 mcg dose = 0.16 mL = 16 units exactly", () => {
    const r = computeDraw({ dose: { value: "400", unit: "mcg" }, preparation: bpc, syringe: u100_1ml });
    expect(r.targetVolumeMl.toNumber()).toBe(0.16);
    expect(r.markingValue.toNumber()).toBe(16);
    expect(r.roundingErrorMcg.toNumber()).toBe(0);
  });

  it("250 mcg titration-start dose = 10 units", () => {
    const r = computeDraw({ dose: { value: "250", unit: "mcg" }, preparation: bpc, syringe: u100_1ml });
    expect(r.markingValue.toNumber()).toBe(10);
  });

  it("a tiny 30 mcg dose triggers the below-measurable-minimum warning", () => {
    const r = computeDraw({ dose: { value: "30", unit: "mcg" }, preparation: bpc, syringe: u100_1ml });
    // 30 / 2500 * 100 = 1.2 units
    expect(r.warnings.some((w) => w.code === "BELOW_MEASURABLE_MINIMUM")).toBe(true);
  });
});

// --- Invariants / property checks -----------------------------------------

describe("invariants", () => {
  const prep: Preparation = { prepType: "premixed", concentrationMcgPerMl: new Decimal(2500) };

  it("mg→mcg is exactly ×1000", () => {
    expect(mgToMcg("1.5").toNumber()).toBe(1500);
  });

  it("canonical mass is independent of the entry unit (mcg path)", () => {
    const a = canonicaliseDose({ dose: { value: "400", unit: "mcg" }, preparation: prep, syringe: u100_1ml });
    const b = canonicaliseDose({ dose: { value: "0.16", unit: "ml" }, preparation: prep, syringe: u100_1ml });
    expect(a.massMcg.toNumber()).toBe(b.massMcg.toNumber());
  });

  it("units→volume→units round-trips for whole-unit draws", () => {
    for (let u = 1; u <= 100; u++) {
      const r = computeDraw({ dose: { value: u, unit: "units" }, preparation: prep, syringe: u100_1ml });
      expect(r.markingValue.toNumber()).toBe(u);
    }
  });

  it("delivered dose is monotonic in requested dose", () => {
    let prev = new Decimal(-1);
    for (let mcg = 100; mcg <= 1000; mcg += 50) {
      const r = computeDraw({ dose: { value: mcg, unit: "mcg" }, preparation: prep, syringe: u100_1ml });
      expect(r.deliveredMassMcg.gte(prev)).toBe(true);
      prev = r.deliveredMassMcg;
    }
  });

  it("no floating-point drift: 0.1 + 0.2 style case is exact", () => {
    // 0.3 mL premixed at 1000 mcg/mL must be exactly 300 mcg.
    const p: Preparation = { prepType: "premixed", concentrationMcgPerMl: new Decimal(1000) };
    const r = computeDraw({ dose: { value: "0.3", unit: "ml" }, preparation: p, syringe: u100_1ml });
    expect(r.targetMassMcg.toString()).toBe("300");
  });

  it("zero BAC water throws rather than producing Infinity", () => {
    expect(() => computeConcentrationMcgPerMl({ totalMassMg: 5, bacWaterMl: 0 })).toThrow();
  });
});
