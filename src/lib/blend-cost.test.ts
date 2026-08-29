import { describe, it, expect } from "vitest";
import { splitCostByComponent } from "./blend-cost";
import type { BlendComponent } from "./blends-core";

const KLOW: BlendComponent[] = [
  { componentPeptideId: "ghk", componentName: "GHK-Cu", massMg: 50, source: "label", sortIndex: 0 },
  { componentPeptideId: "bpc", componentName: "BPC-157", massMg: 10, source: "label", sortIndex: 1 },
  { componentPeptideId: "tb5", componentName: "TB-500", massMg: 10, source: "label", sortIndex: 2 },
  { componentPeptideId: "kpv", componentName: "KPV", massMg: 10, source: "label", sortIndex: 3 },
];

describe("splitCostByComponent", () => {
  it("splits a blend vial's cost by label mass fraction", () => {
    const parts = splitCostByComponent("200.00", KLOW);
    expect(parts.map((p) => p.componentName)).toEqual(["GHK-Cu", "BPC-157", "TB-500", "KPV"]);
    expect(parts[0].cost).toBeCloseTo(125.0, 5);
    expect(parts[1].cost).toBeCloseTo(25.0, 5);
  });

  it("sums back to the original vial cost — no money invented or lost", () => {
    const total = splitCostByComponent("200.00", KLOW).reduce((a, p) => a + p.cost, 0);
    expect(total).toBeCloseTo(200.00, 6);
  });

  it("marks every split as derived and carries the ratio source", () => {
    expect(splitCostByComponent("200.00", KLOW).every((p) => p.derived && p.source === "label")).toBe(true);
  });

  it("returns [] for a non-blend so nothing changes for ordinary peptides", () => {
    expect(splitCostByComponent("200.00", [])).toEqual([]);
  });

  it("returns [] when the vial has no resolvable cost", () => {
    expect(splitCostByComponent(null, KLOW)).toEqual([]);
  });
});
