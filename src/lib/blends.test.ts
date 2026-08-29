import { describe, it, expect } from "vitest";
import { rollUpExposure } from "./blends-core";
import type { DerivedComponentDose } from "./blends-core";

describe("rollUpExposure", () => {
  const derived: DerivedComponentDose[] = [
    { componentPeptideId: "ghk", componentName: "GHK-Cu", doseMcg: 33000, fraction: 0.625, source: "label", derived: true },
    { componentPeptideId: "kpv", componentName: "KPV", doseMcg: 6600, fraction: 0.125, source: "label", derived: true },
  ];

  it("adds blend-delivered mass to standalone mass for the same peptide", () => {
    const rows = rollUpExposure({
      standalone: [{ peptideId: "ghk", peptideName: "GHK-Cu", totalMcg: 40000 }],
      derived,
    });
    const ghk = rows.find((r) => r.peptideId === "ghk")!;
    expect(ghk.standaloneMcg).toBeCloseTo(40000, 2);
    expect(ghk.blendMcg).toBeCloseTo(33000, 2);
    expect(ghk.totalMcg).toBeCloseTo(73000, 2);
    expect(ghk.hasDerived).toBe(true);
  });

  it("surfaces a component that has no standalone protocol at all", () => {
    const kpv = rollUpExposure({ standalone: [], derived }).find((r) => r.peptideId === "kpv")!;
    expect(kpv.standaloneMcg).toBe(0);
    expect(kpv.totalMcg).toBeCloseTo(6600, 2);
    expect(kpv.hasDerived).toBe(true);
  });

  it("leaves a standalone-only peptide unflagged", () => {
    const rows = rollUpExposure({
      standalone: [{ peptideId: "nad", peptideName: "NAD+", totalMcg: 1000 }],
      derived: [],
    });
    expect(rows).toEqual([
      { peptideId: "nad", peptideName: "NAD+", standaloneMcg: 1000, blendMcg: 0, totalMcg: 1000, hasDerived: false },
    ]);
  });

  it("sorts by total mass descending", () => {
    const rows = rollUpExposure({
      standalone: [{ peptideId: "kpv", peptideName: "KPV", totalMcg: 1 }],
      derived,
    });
    expect(rows[0].peptideId).toBe("ghk");
  });

  // The analytics roll-up keys this function by peptide NAME (so derived
  // component rows merge with standalone history), and Peptide carries no
  // unique-name constraint — two separate peptide rows can therefore arrive
  // under one key. Overwriting drops a whole course's delivered mass from a
  // table headed "all time", silently and with no way to notice from the UI.
  it("ACCUMULATES two standalone entries that share a key, never overwrites", () => {
    const rows = rollUpExposure({
      standalone: [
        { peptideId: "BPC-157", peptideName: "BPC-157", totalMcg: 1000 },
        { peptideId: "BPC-157", peptideName: "BPC-157", totalMcg: 500 },
      ],
      derived: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].standaloneMcg).toBe(1500);
    expect(rows[0].totalMcg).toBe(1500);
    expect(rows[0].hasDerived).toBe(false);
  });

  it("still merges derived mass onto an accumulated standalone row", () => {
    const rows = rollUpExposure({
      standalone: [
        { peptideId: "KPV", peptideName: "KPV", totalMcg: 1000 },
        { peptideId: "KPV", peptideName: "KPV", totalMcg: 200 },
      ],
      derived: [
        { componentPeptideId: "KPV", componentName: "KPV", doseMcg: 300, fraction: 0.125, source: "label", derived: true },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].standaloneMcg).toBe(1200);
    expect(rows[0].blendMcg).toBe(300);
    expect(rows[0].totalMcg).toBe(1500);
    expect(rows[0].hasDerived).toBe(true);
  });
});
