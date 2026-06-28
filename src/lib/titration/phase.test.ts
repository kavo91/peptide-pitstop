import { describe, it, expect } from "vitest";
import { phaseTargets, activePhaseAt } from "./phase";
import type { TitrationStep } from "../schedule/schedule";

const steps: TitrationStep[] = [
  { stepIndex: 0, dose: "4", doseInputUnit: "mg", durationDays: 14 }, // 2 wk
  { stepIndex: 1, dose: "8", doseInputUnit: "mg", durationDays: null }, // indefinite
];

describe("phaseTargets", () => {
  it("converts durationDays × injections/week → dose-count (final = null)", () => {
    expect(phaseTargets(steps, 2)).toEqual([4, null]); // 14/7*2 = 4
  });
  it("rounds fractional counts to nearest", () => {
    expect(phaseTargets([{ stepIndex: 0, dose: "1", doseInputUnit: "mg", durationDays: 10 }, steps[1]], 2))
      .toEqual([3, null]); // 10/7*2 = 2.857 → 3
  });
  it("throws on a negative durationDays (degenerate hand-authored step)", () => {
    expect(() => phaseTargets([{ stepIndex: 0, dose: "4", doseInputUnit: "mg", durationDays: -7 }, steps[1]], 2))
      .toThrow(/durationDays must be >= 0/);
  });
});

describe("activePhaseAt", () => {
  const targets = [4, null];
  it("phase 0 until 4 delivered, then phase 1", () => {
    expect(activePhaseAt(targets, 0)).toBe(0);
    expect(activePhaseAt(targets, 3)).toBe(0);
    expect(activePhaseAt(targets, 4)).toBe(1);
    expect(activePhaseAt(targets, 99)).toBe(1); // stays on indefinite final
  });
});
