import { describe, it, expect } from "vitest";
import { generateRamp } from "./generate-ramp";

describe("generateRamp", () => {
  it("builds an inclusive ramp, final step indefinite", () => {
    const steps = generateRamp({ startDose: "2", targetDose: "8", increment: "2", weeksPerStep: 4, doseInputUnit: "mg" });
    expect(steps).toEqual([
      { stepIndex: 0, dose: "2", doseInputUnit: "mg", durationDays: 28 },
      { stepIndex: 1, dose: "4", doseInputUnit: "mg", durationDays: 28 },
      { stepIndex: 2, dose: "6", doseInputUnit: "mg", durationDays: 28 },
      { stepIndex: 3, dose: "8", doseInputUnit: "mg", durationDays: null },
    ]);
  });
  it("clamps a non-multiple last pre-target step to target", () => {
    const steps = generateRamp({ startDose: "2", targetDose: "5", increment: "2", weeksPerStep: 2, doseInputUnit: "mg" });
    expect(steps.map((s) => s.dose)).toEqual(["2", "4", "5"]);
    expect(steps[steps.length - 1].durationDays).toBeNull();
  });
  it("start == target → single indefinite step", () => {
    expect(generateRamp({ startDose: "5", targetDose: "5", increment: "1", weeksPerStep: 4, doseInputUnit: "mg" }))
      .toEqual([{ stepIndex: 0, dose: "5", doseInputUnit: "mg", durationDays: null }]);
  });
  it("throws on invalid inputs", () => {
    expect(() => generateRamp({ startDose: "8", targetDose: "2", increment: "2", weeksPerStep: 4, doseInputUnit: "mg" })).toThrow();
    expect(() => generateRamp({ startDose: "2", targetDose: "8", increment: "0", weeksPerStep: 4, doseInputUnit: "mg" })).toThrow();
    expect(() => generateRamp({ startDose: "2", targetDose: "8", increment: "2", weeksPerStep: 0, doseInputUnit: "mg" })).toThrow();
  });
  it("throws a clear domain error on a non-numeric dose (not a raw DecimalError)", () => {
    expect(() => generateRamp({ startDose: "abc", targetDose: "8", increment: "2", weeksPerStep: 4, doseInputUnit: "mg" }))
      .toThrow(/startDose must be a number/);
  });
});
