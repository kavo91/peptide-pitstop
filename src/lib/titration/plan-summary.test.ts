import { describe, it, expect } from "vitest";
import { titrationPlanSummary, type PlanStepInput } from "./plan-summary";

const reta: PlanStepInput[] = [
  { stepIndex: 0, dose: "0.5", doseInputUnit: "mg", durationDays: 7 },
  { stepIndex: 1, dose: "1", doseInputUnit: "mg", durationDays: 28 },
  { stepIndex: 2, dose: "2", doseInputUnit: "mg", durationDays: 28 },
  { stepIndex: 3, dose: "3", doseInputUnit: "mg", durationDays: null },
];

describe("titrationPlanSummary", () => {
  it("computes per-phase dose-counts for a per_injection ramp (Reta, every-3-days = 2.5/wk)", () => {
    const plan = titrationPlanSummary({ steps: reta, injectionsPerWeek: 2.5, doseBasis: "per_injection" });
    expect(plan.resolved).toBe(true);
    expect(plan.phases.map((p) => p.doses)).toEqual([3, 10, 10, null]); // round((d/7)*2.5)
    expect(plan.phases.map((p) => p.perInjection)).toEqual(["0.5", "1", "2", "3"]); // per_injection passes through
    expect(plan.phases.map((p) => p.weeks)).toEqual([1, 4, 4, null]);
    expect(plan.phases.map((p) => p.startWeek)).toEqual([0, 1, 5, 9]);
    expect(plan.phases[2].endWeek).toBe(9);
    expect(plan.hasIndefinite).toBe(true);
    expect(plan.totalWeeks).toBeNull(); // final phase indefinite
    expect(plan.totalDoses).toBeNull();
    expect(plan.minPerInjection).toBe(0.5);
    expect(plan.maxPerInjection).toBe(3);
  });

  it("divides a per_week ramp into per-injection values and counts doses", () => {
    const steps: PlanStepInput[] = [
      { stepIndex: 0, dose: "8", doseInputUnit: "mg", durationDays: 14 },  // 8/wk ÷2 = 4; 2 wk × 2 = 4 doses
      { stepIndex: 1, dose: "12", doseInputUnit: "mg", durationDays: 14 },
    ];
    const plan = titrationPlanSummary({ steps, injectionsPerWeek: 2, doseBasis: "per_week" });
    expect(plan.resolved).toBe(true);
    expect(plan.phases.map((p) => p.perInjection)).toEqual(["4", "6"]);
    expect(plan.phases.map((p) => p.doses)).toEqual([4, 4]);
    expect(plan.totalWeeks).toBe(4);
    expect(plan.totalDoses).toBe(8);
  });

  it("a fully-timed ramp reports finite totals", () => {
    const steps: PlanStepInput[] = [
      { stepIndex: 0, dose: "0.25", doseInputUnit: "mg", durationDays: 7 },
      { stepIndex: 1, dose: "0.5", doseInputUnit: "mg", durationDays: 7 },
    ];
    const plan = titrationPlanSummary({ steps, injectionsPerWeek: 7, doseBasis: "per_injection" });
    expect(plan.hasIndefinite).toBe(false);
    expect(plan.totalWeeks).toBe(2);
    expect(plan.phases.map((p) => p.doses)).toEqual([7, 7]);
    expect(plan.totalDoses).toBe(14);
  });

  it("per_week with unknown frequency is unresolved: no per-injection, no dose-counts", () => {
    const plan = titrationPlanSummary({ steps: reta, injectionsPerWeek: null, doseBasis: "per_week" });
    expect(plan.resolved).toBe(false);
    expect(plan.phases.every((p) => p.perInjection === null)).toBe(true);
    expect(plan.phases.every((p) => p.doses === null)).toBe(true);
    expect(plan.totalDoses).toBeNull();
    // weeks still derivable from durations even without a frequency
    expect(plan.phases.map((p) => p.weeks)).toEqual([1, 4, 4, null]);
  });

  it("per_injection still shows the dose ramp when frequency is unknown (counts null)", () => {
    const plan = titrationPlanSummary({ steps: reta, injectionsPerWeek: null, doseBasis: "per_injection" });
    expect(plan.resolved).toBe(true); // per_injection doesn't need a frequency to show doses
    expect(plan.phases.map((p) => p.perInjection)).toEqual(["0.5", "1", "2", "3"]);
    expect(plan.phases.every((p) => p.doses === null)).toBe(true); // counts need a frequency
  });
});
