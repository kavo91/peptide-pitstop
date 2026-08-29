import { describe, expect, it } from "vitest";
import { buildBlendStepBreakdown } from "./blend-step-breakdown";

const CJC = [
  { componentPeptideId: "c1", componentName: "CJC-1295 no-DAC", massMg: 5, source: "label" as const, sortIndex: 0 },
  { componentPeptideId: "c2", componentName: "Ipamorelin", massMg: 5, source: "label" as const, sortIndex: 1 },
];

describe("buildBlendStepBreakdown", () => {
  it("builds the clinician table for the CJC 200→500 ladder, sorted by stepIndex", () => {
    const d = buildBlendStepBreakdown({
      // supplied REVERSED — must sort by stepIndex
      steps: [
        { stepIndex: 3, dose: "500", doseInputUnit: "mcg", durationDays: null },
        { stepIndex: 0, dose: "200", doseInputUnit: "mcg", durationDays: 14 },
        { stepIndex: 2, dose: "400", doseInputUnit: "mcg", durationDays: 14 },
        { stepIndex: 1, dose: "300", doseInputUnit: "mcg", durationDays: 14 },
      ],
      components: CJC,
      doseBasis: "per_injection",
      injectionsPerWeek: 5,
    });
    expect(d!.componentNames).toEqual(["CJC-1295 no-DAC", "Ipamorelin"]);
    expect(d!.source).toBe("label");
    expect(d!.rows.map((r) => [r.stepLabel, ...r.componentMcg])).toEqual([
      ["200 mcg", 100, 100],
      ["300 mcg", 150, 150],
      ["400 mcg", 200, 200],
      ["500 mcg", 250, 250],
    ]);
  });

  it("divides per_week steps through the sanctioned seam before splitting", () => {
    const d = buildBlendStepBreakdown({
      steps: [{ stepIndex: 0, dose: "1000", doseInputUnit: "mcg", durationDays: null }],
      components: CJC,
      doseBasis: "per_week",
      injectionsPerWeek: 5,
    });
    expect(d!.rows[0].componentMcg).toEqual([100, 100]); // 1000/5 = 200 → 100+100
  });

  it("unresolvable per_week and units steps yield null cells, never a number", () => {
    const week = buildBlendStepBreakdown({
      steps: [{ stepIndex: 0, dose: "1000", doseInputUnit: "mcg", durationDays: null }],
      components: CJC,
      doseBasis: "per_week",
      injectionsPerWeek: 0, // unresolvable
    });
    expect(week!.rows[0].componentMcg).toEqual([null, null]);
    const units = buildBlendStepBreakdown({
      steps: [{ stepIndex: 0, dose: "20", doseInputUnit: "units", durationDays: null }],
      components: CJC,
      doseBasis: "per_injection",
      injectionsPerWeek: 5,
    });
    expect(units!.rows[0].componentMcg).toEqual([null, null]);
  });

  it("returns null with no steps or no components", () => {
    expect(buildBlendStepBreakdown({ steps: [], components: CJC, doseBasis: "per_injection", injectionsPerWeek: 5 })).toBeNull();
    expect(buildBlendStepBreakdown({ steps: [{ stepIndex: 0, dose: "200", doseInputUnit: "mcg", durationDays: null }], components: [], doseBasis: "per_injection", injectionsPerWeek: 5 })).toBeNull();
  });
});

describe("review fixes", () => {
  const MIXED = [
    { componentPeptideId: "c1", componentName: "GHK-Cu", massMg: 50, source: "label" as const, sortIndex: 0 },
    { componentPeptideId: "c2", componentName: "KPV", massMg: 10, source: "assumed" as const, sortIndex: 1 },
  ];
  it("mixed provenance presents as the WEAKEST source", () => {
    const d = buildBlendStepBreakdown({
      steps: [{ stepIndex: 0, dose: "600", doseInputUnit: "mcg", durationDays: null }],
      components: MIXED,
      doseBasis: "per_injection",
      injectionsPerWeek: 5,
    });
    expect(d!.source).toBe("assumed");
  });
  it("unresolvable per_week label is marked '/ week', never a bare per-injection-looking figure", () => {
    const d = buildBlendStepBreakdown({
      steps: [{ stepIndex: 0, dose: "2100", doseInputUnit: "mcg", durationDays: null }],
      components: MIXED,
      doseBasis: "per_week",
      injectionsPerWeek: 0,
    });
    expect(d!.rows[0].stepLabel).toBe("2100 mcg / week");
    expect(d!.rows[0].componentMcg).toEqual([null, null]);
  });
  it("resolvable per_week label rounds to 1 dp (no 266.666667 artifact)", () => {
    const d = buildBlendStepBreakdown({
      steps: [{ stepIndex: 0, dose: "800", doseInputUnit: "mcg", durationDays: null }],
      components: MIXED,
      doseBasis: "per_week",
      injectionsPerWeek: 3,
    });
    expect(d!.rows[0].stepLabel).toBe("266.7 mcg");
  });
  it("an unknown stored unit fails safe to em-dash cells with the raw label", () => {
    const d = buildBlendStepBreakdown({
      steps: [{ stepIndex: 0, dose: "10", doseInputUnit: "IU", durationDays: null }],
      components: MIXED,
      doseBasis: "per_injection",
      injectionsPerWeek: 5,
    });
    expect(d!.rows[0].componentMcg).toEqual([null, null]);
    expect(d!.rows[0].stepLabel).toBe("10 IU");
  });
});
