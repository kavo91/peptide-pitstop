import { describe, it, expect } from "vitest";
import { perInjectionDose } from "./dose-basis";

describe("perInjectionDose", () => {
  it("per_injection returns the dose unchanged", () => {
    expect(perInjectionDose({ doseBasis: "per_injection", value: "250", unit: "mcg", injectionsPerWeek: 7 }))
      .toEqual({ value: "250", unit: "mcg" });
  });
  it("per_week divides the weekly dose by injections/week", () => {
    expect(perInjectionDose({ doseBasis: "per_week", value: "8", unit: "mg", injectionsPerWeek: 2 }))
      .toEqual({ value: "4", unit: "mg" });
  });
  it("per_week supports fractional frequency (EOD = 3.5/wk)", () => {
    expect(perInjectionDose({ doseBasis: "per_week", value: "7", unit: "mg", injectionsPerWeek: 3.5 }))
      .toEqual({ value: "2", unit: "mg" });
  });
  it("returns null when per_week frequency is missing/zero (no divide-by-zero)", () => {
    expect(perInjectionDose({ doseBasis: "per_week", value: "8", unit: "mg", injectionsPerWeek: null })).toBeNull();
    expect(perInjectionDose({ doseBasis: "per_week", value: "8", unit: "mg", injectionsPerWeek: 0 })).toBeNull();
  });
  it("clamps a non-terminating per_week division to ≤6 decimal places (no 40-digit string)", () => {
    const r = perInjectionDose({ doseBasis: "per_week", value: "8", unit: "mg", injectionsPerWeek: 3 });
    expect(r).not.toBeNull();
    const decimals = r!.value.split(".")[1] ?? "";
    expect(decimals.length).toBeLessThanOrEqual(6);
    expect(r!.value).toBe("2.666667"); // 8/3 rounded HALF_UP to 6dp
  });
});
