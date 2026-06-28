import { describe, it, expect } from "vitest";
import { perInjectionPreview } from "./per-injection-preview";

describe("perInjectionPreview", () => {
  it("formats a clean division (8 mg/wk @ 2/wk → 4 mg/injection)", () => {
    expect(perInjectionPreview({ value: "8", unit: "mg", injectionsPerWeek: 2 })).toBe(
      "≈ 4 mg/injection at 2×/week",
    );
  });

  it("formats a fractional frequency (7 mg/wk @ 3.5/wk → 2 mg/injection)", () => {
    expect(perInjectionPreview({ value: "7", unit: "mg", injectionsPerWeek: 3.5 })).toBe(
      "≈ 2 mg/injection at 3.5×/week",
    );
  });

  it("trims a non-terminating division to a short string", () => {
    // 8 / 3 = 2.666667 (perInjectionDose clamps to 6dp)
    expect(perInjectionPreview({ value: "8", unit: "mg", injectionsPerWeek: 3 })).toBe(
      "≈ 2.666667 mg/injection at 3×/week",
    );
  });

  it("returns null when the weekly value is blank or non-numeric", () => {
    expect(perInjectionPreview({ value: "", unit: "mg", injectionsPerWeek: 2 })).toBeNull();
    expect(perInjectionPreview({ value: "abc", unit: "mg", injectionsPerWeek: 2 })).toBeNull();
  });

  it("returns null when injections/week is missing or zero (no divide-by-zero)", () => {
    expect(perInjectionPreview({ value: "8", unit: "mg", injectionsPerWeek: null })).toBeNull();
    expect(perInjectionPreview({ value: "8", unit: "mg", injectionsPerWeek: 0 })).toBeNull();
  });
});
