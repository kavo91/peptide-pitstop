import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeDraw } from "./engine";
import { doseUnitBreakdown } from "./unit-breakdown";
import type { Preparation, Syringe } from "./types";

const u100_1ml: Syringe = {
  name: "1 mL U-100 insulin",
  graduationType: "units",
  unitsPerMl: 100,
  capacityMl: 1,
  capacityUnits: 100,
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

// 500 mcg/mL preparation.
const prep500: Preparation = {
  prepType: "premixed",
  concentrationMcgPerMl: new Decimal(500),
};

describe("doseUnitBreakdown", () => {
  it("250 mcg @ 500 mcg/mL on U-100 → 0.5 mL, 50 units, 0.25 mg", () => {
    const draw = computeDraw({ dose: { value: "250", unit: "mcg" }, preparation: prep500, syringe: u100_1ml });
    const b = doseUnitBreakdown(draw, u100_1ml);
    expect(b.mcg).toBe("250");
    expect(b.mg).toBe("0.25");
    expect(b.ml).toBe("0.5");
    expect(b.units).toBe("50");
  });

  it("reports units from rawUnits even on an mL-graduated syringe", () => {
    // rawUnits = targetVolumeMl × unitsPerMl regardless of graduation type.
    const draw = computeDraw({ dose: { value: "250", unit: "mcg" }, preparation: prep500, syringe: ml_1ml });
    const b = doseUnitBreakdown(draw, ml_1ml);
    expect(b.ml).toBe("0.5");
    expect(b.units).toBe("50"); // 0.5 mL × 100 units/mL
  });

  it("clamps display precision (mcg 1dp, mg 3dp, ml 3dp, units 1dp)", () => {
    // 175 mcg @ 500 mcg/mL → 0.35 mL, 35 units, 0.175 mg.
    const draw = computeDraw({ dose: { value: "175", unit: "mcg" }, preparation: prep500, syringe: u100_1ml });
    const b = doseUnitBreakdown(draw, u100_1ml);
    expect(b.mcg).toBe("175");
    expect(b.mg).toBe("0.175");
    expect(b.ml).toBe("0.35");
    expect(b.units).toBe("35");
  });

  it("rounds a non-terminating mcg value to 1dp", () => {
    // 100/3 ≈ 33.333… mcg → mcg "33.3"
    const draw = computeDraw({ dose: { value: new Decimal(100).div(3).toString(), unit: "mcg" }, preparation: prep500, syringe: u100_1ml });
    const b = doseUnitBreakdown(draw, u100_1ml);
    expect(b.mcg).toBe("33.3");
  });
});
