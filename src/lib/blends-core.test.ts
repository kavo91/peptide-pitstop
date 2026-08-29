import { describe, it, expect } from "vitest";
import { componentFractions, expandBlendDose, blendMassCheck, rollUpExposure, type BlendComponent } from "./blends-core";

const KLOW: BlendComponent[] = [
  { componentPeptideId: "ghk", componentName: "GHK-Cu", massMg: 50, source: "label", sortIndex: 0 },
  { componentPeptideId: "bpc", componentName: "BPC-157", massMg: 10, source: "label", sortIndex: 1 },
  { componentPeptideId: "tb5", componentName: "TB-500", massMg: 10, source: "label", sortIndex: 2 },
  { componentPeptideId: "kpv", componentName: "KPV", massMg: 10, source: "label", sortIndex: 3 },
];

const CJC_IPA: BlendComponent[] = [
  { componentPeptideId: "cjc", componentName: "CJC-1295 no-DAC", massMg: 5, source: "assumed", sortIndex: 0 },
  { componentPeptideId: "ipa", componentName: "Ipamorelin", massMg: 5, source: "assumed", sortIndex: 1 },
];

describe("componentFractions", () => {
  it("derives fractions from mass, summing to 1", () => {
    const f = componentFractions(KLOW);
    expect(f.get("ghk")).toBeCloseTo(0.625, 10);
    expect(f.get("bpc")).toBeCloseTo(0.125, 10);
    expect([...f.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("returns an empty map for no components", () => {
    expect(componentFractions([]).size).toBe(0);
  });

  it("returns an empty map when total mass is zero", () => {
    expect(componentFractions([
      { componentPeptideId: "x", componentName: "X", massMg: 0, source: "label", sortIndex: 0 },
    ]).size).toBe(0);
  });
});

describe("expandBlendDose", () => {
  it("splits a KLOW 3200 mcg dose by label ratio", () => {
    const parts = expandBlendDose(3200, KLOW);
    expect(parts).toHaveLength(4);
    expect(parts[0]).toMatchObject({ componentName: "GHK-Cu", source: "label", derived: true });
    expect(parts[0].doseMcg).toBeCloseTo(2000, 6);
    expect(parts[1].doseMcg).toBeCloseTo(400, 6);
    expect(parts[3].doseMcg).toBeCloseTo(400, 6);
  });

  it("splits a CJC/IPA 200 mcg dose evenly and carries the assumed source", () => {
    const parts = expandBlendDose(200, CJC_IPA);
    expect(parts.map((p) => p.doseMcg)).toEqual([100, 100]);
    expect(parts.every((p) => p.source === "assumed")).toBe(true);
  });

  it("preserves total mass across the expansion", () => {
    const total = expandBlendDose(3200, KLOW).reduce((a, p) => a + p.doseMcg, 0);
    expect(total).toBeCloseTo(3200, 6);
  });

  it("returns [] for a peptide with no components, so non-blends are untouched", () => {
    expect(expandBlendDose(3200, [])).toEqual([]);
  });

  it("orders output by sortIndex regardless of input order", () => {
    const shuffled = [KLOW[2], KLOW[0], KLOW[3], KLOW[1]];
    expect(expandBlendDose(3200, shuffled).map((p) => p.componentName))
      .toEqual(["GHK-Cu", "BPC-157", "TB-500", "KPV"]);
  });
});

describe("blendMassCheck", () => {
  it("passes when component masses sum to the vial label strength", () => {
    expect(blendMassCheck(KLOW, 80)).toEqual({ ok: true, sumMg: 80, expectedMg: 80 });
  });

  it("fails (but does not throw) when the sum disagrees", () => {
    expect(blendMassCheck(KLOW, 100)).toEqual({ ok: false, sumMg: 80, expectedMg: 100 });
  });

  it("passes when there is no declared strength to check against", () => {
    expect(blendMassCheck(KLOW, null)).toEqual({ ok: true, sumMg: 80, expectedMg: null });
  });
});

describe("regression anchor — cumulative blend exposure", () => {
  // A fixed cumulative total for a blend course: 40.0 mg = 40,000 mcg. Held
  // constant so the arithmetic below is a stable anchor rather than a moving target.
  const KLOW_TOTAL_MCG = 40_000;

  it("recovers the 25.0 mg of GHK-Cu that the blend delivered", () => {
    const ghk = expandBlendDose(KLOW_TOTAL_MCG, KLOW).find((p) => p.componentName === "GHK-Cu")!;
    expect(ghk.doseMcg / 1000).toBeCloseTo(25.0, 6);
  });

  it("adds blend-delivered mass to standalone mass for the same compound", () => {
    // Standalone-only reporting would stop at 40.0 mg and understate the total.
    const standaloneMg = 40.0;
    const blendMg = expandBlendDose(KLOW_TOTAL_MCG, KLOW)
      .find((p) => p.componentName === "GHK-Cu")!.doseMcg / 1000;
    expect(standaloneMg + blendMg).toBeCloseTo(65.0, 6);
  });

  it("surfaces a component that has no standalone protocol of its own", () => {
    const kpv = expandBlendDose(KLOW_TOTAL_MCG, KLOW).find((p) => p.componentName === "KPV")!;
    expect(kpv.doseMcg / 1000).toBeCloseTo(5.0, 6);
  });
});

describe("distinct compounds must not share an identity", () => {
  // TB-500 (Ac-LKKTETQ fragment) and Thymosin Beta-4 (full 43-aa) are different
  // compounds. A standalone TB-4 course and a KLOW blend delivering TB-500 must
  // stay separate: pointing both at one peptide id reports their sum (17.0 mg)
  // against a compound that was never taken on its own. componentPeptideId is
  // the guard — this locks it.
  const KLOW_WITH_TB500: BlendComponent[] = [
    { componentPeptideId: "ghk", componentName: "GHK-Cu", massMg: 50, source: "label", sortIndex: 0 },
    { componentPeptideId: "bpc", componentName: "BPC-157", massMg: 10, source: "label", sortIndex: 1 },
    { componentPeptideId: "tb500", componentName: "TB-500", massMg: 10, source: "label", sortIndex: 2 },
    { componentPeptideId: "kpv", componentName: "KPV", massMg: 10, source: "label", sortIndex: 3 },
  ];

  it("keeps KLOW's TB-500 separate from standalone Thymosin Beta-4 exposure", () => {
    const derived = expandBlendDose(40_000, KLOW_WITH_TB500);
    const tb500 = derived.find((p) => p.componentPeptideId === "tb500")!;
    expect(tb500.doseMcg / 1000).toBeCloseTo(5.0, 6);

    const rows = rollUpExposure({
      standalone: [{ peptideId: "tb4", peptideName: "Thymosin Beta-4", totalMcg: 12_000 }],
      derived,
    });
    // TB-4 stays at 12.0 mg; TB-500 appears separately at 5.0 mg. Never 17.0 mg of either.
    expect(rows.find((r) => r.peptideId === "tb4")!.totalMcg / 1000).toBeCloseTo(12.0, 6);
    expect(rows.find((r) => r.peptideId === "tb500")!.totalMcg / 1000).toBeCloseTo(5.0, 6);
    expect(rows.find((r) => r.peptideId === "tb4")!.hasDerived).toBe(false);
  });
});

import { describe as dP, expect as eP, it as iP } from "vitest";
import { splitProspectiveDose } from "./blends-core";

const CJC_P = [
  { componentPeptideId: "c1", componentName: "CJC-1295 no-DAC", massMg: 5, source: "label" as const, sortIndex: 0 },
  { componentPeptideId: "c2", componentName: "Ipamorelin", massMg: 5, source: "label" as const, sortIndex: 1 },
];
const KLOW_P = [
  { componentPeptideId: "g", componentName: "GHK-Cu", massMg: 50, source: "label" as const, sortIndex: 0 },
  { componentPeptideId: "b", componentName: "BPC-157", massMg: 10, source: "label" as const, sortIndex: 1 },
  { componentPeptideId: "t", componentName: "TB-500", massMg: 10, source: "label" as const, sortIndex: 2 },
  { componentPeptideId: "k", componentName: "KPV", massMg: 10, source: "label" as const, sortIndex: 3 },
];

dP("splitProspectiveDose", () => {
  iP("splits an mcg titration step directly (CJC 300 → 150 + 150)", () => {
    const r = splitProspectiveDose("300", "mcg", CJC_P);
    eP(r!.map((c) => [c.componentName, c.doseMcg])).toEqual([
      ["CJC-1295 no-DAC", 150],
      ["Ipamorelin", 150],
    ]);
    eP(r!.every((c) => c.derived && c.source === "label")).toBe(true);
  });

  iP("splits KLOW 3200 mcg by the 50/10/10/10 label ratio", () => {
    const r = splitProspectiveDose("3200", "mcg", KLOW_P);
    eP(r!.map((c) => c.doseMcg)).toEqual([2000, 400, 400, 400]);
  });

  iP("mg converts ×1000 before splitting", () => {
    const r = splitProspectiveDose("3.2", "mg", KLOW_P);
    eP(r!.map((c) => c.doseMcg)).toEqual([2000, 400, 400, 400]);
  });

  iP("ml needs the prep concentration; without it returns null", () => {
    eP(splitProspectiveDose("0.12", "ml", KLOW_P)).toBeNull();
    const r = splitProspectiveDose("0.12", "ml", KLOW_P, "26666.6666666667");
    eP(r).not.toBeNull();
    eP(r![0].doseMcg).toBeCloseTo(2000, 6);
  });

  iP("units is syringe-relative — fail-safe null, never a guess", () => {
    eP(splitProspectiveDose("20", "units", KLOW_P, "26666.67")).toBeNull();
  });

  iP("blank/non-finite values and empty components return null", () => {
    eP(splitProspectiveDose("", "mcg", CJC_P)).toBeNull();
    eP(splitProspectiveDose("abc", "mcg", CJC_P)).toBeNull();
    eP(splitProspectiveDose("300", "mcg", [])).toBeNull();
    eP(splitProspectiveDose("-5", "mcg", CJC_P)).toBeNull();
  });
});

import { weakestBlendSource, roundSplitForDisplay } from "./blends-core";

dP("weakestBlendSource", () => {
  iP("one assumed row taints the whole blend's displayed provenance", () => {
    eP(weakestBlendSource([{ source: "label" }, { source: "assumed" }])).toBe("assumed");
    eP(weakestBlendSource([{ source: "label" }, { source: "coa" }])).toBe("coa");
    eP(weakestBlendSource([{ source: "label" }, { source: "label" }])).toBe("label");
  });
});

dP("roundSplitForDisplay", () => {
  iP("components sum exactly to the rounded parent (KLOW 250 mcg case)", () => {
    const r = roundSplitForDisplay([156.25, 31.25, 31.25, 31.25]);
    eP(r.reduce((s, v) => s + v, 0)).toBeCloseTo(250.0, 9);
    eP(r[0]).toBeCloseTo(156.3, 9); // largest remainder gets the increment
  });
  iP("exact values pass through", () => {
    eP(roundSplitForDisplay([2000, 400, 400, 400])).toEqual([2000, 400, 400, 400]);
    eP(roundSplitForDisplay([100, 100])).toEqual([100, 100]);
  });
  iP("KLOW 2667 case sums to 2667.0", () => {
    const r = roundSplitForDisplay([1666.875, 333.375, 333.375, 333.375]);
    eP(r.reduce((s, v) => s + v, 0)).toBeCloseTo(2667.0, 9);
  });
});
