import { describe, it, expect } from "vitest";
import { libraryComponents, libraryHalfLifeHours, PEPTIDE_LIBRARY } from "./peptide-library";

describe("libraryComponents", () => {
  it("returns KLOW's 80 mg composition", () => {
    expect(libraryComponents("KLOW")).toEqual([
      { name: "GHK-Cu", mg: 50 },
      { name: "BPC-157", mg: 10 },
      { name: "TB-500", mg: 10 },
      { name: "KPV", mg: 10 },
    ]);
  });

  it("KLOW's components sum to the 80 mg label strength", () => {
    const total = libraryComponents("KLOW")!.reduce((s, c) => s + c.mg, 0);
    expect(total).toBe(80);
  });

  it("GHK-Cu is 62.5% of the blend by mass", () => {
    const comps = libraryComponents("KLOW")!;
    const total = comps.reduce((s, c) => s + c.mg, 0);
    const ghk = comps.find((c) => c.name === "GHK-Cu")!;
    expect(ghk.mg / total).toBeCloseTo(0.625, 5);
  });

  it("matches by alias as well as canonical name", () => {
    expect(libraryComponents("GHK-Cu + KPV + BPC-157 + TB-500")).not.toBeNull();
  });

  it("returns null for a non-blend", () => {
    expect(libraryComponents("BPC-157")).toBeNull();
    expect(libraryComponents("Tesamorelin")).toBeNull();
  });

  it("returns null for blends whose split is not recorded", () => {
    // Deliberately absent — a guessed ratio is worse than one honest composite line.
    expect(libraryComponents("GLOW")).toBeNull();
    expect(libraryComponents("Tri-Heal")).toBeNull();
  });

  it("returns null for an unknown peptide", () => {
    expect(libraryComponents("Not A Peptide")).toBeNull();
  });

  it("every declared component resolves to a real library entry", () => {
    // A typo in a component name would silently drop that curve.
    for (const entry of PEPTIDE_LIBRARY) {
      for (const comp of entry.components ?? []) {
        const hit = PEPTIDE_LIBRARY.find(
          (e) =>
            [e.name, ...(e.aliases ?? "").split(",")]
              .map((s) => s.trim().toLowerCase())
              .includes(comp.name.trim().toLowerCase()),
        );
        expect(hit, `${entry.name} component "${comp.name}" has no library entry`).toBeTruthy();
      }
    }
  });

  it("KLOW's components carry the half-lives the chart will use", () => {
    expect(libraryHalfLifeHours("GHK-Cu")).toBe("1");
    expect(libraryHalfLifeHours("BPC-157")).toBe("7");
    expect(libraryHalfLifeHours("TB-500")).toBe("2.5");
    // KPV is in the library but PK is not well characterised — no curve, named
    // in the chart's "no curve for" notice instead of silently vanishing.
    expect(libraryHalfLifeHours("KPV")).toBeNull();
  });

  it("splits a 3200 mcg KLOW dose into the logged per-component amounts", () => {
    // 0.12 mL of 80 mg / 3.0 mL = 3200 mcg total blend — the real target dose.
    const comps = libraryComponents("KLOW")!;
    const total = comps.reduce((s, c) => s + c.mg, 0);
    const split = Object.fromEntries(
      comps.map((c) => [c.name, Math.round(3200 * (c.mg / total))]),
    );
    expect(split).toEqual({
      "GHK-Cu": 2000,
      "BPC-157": 400,
      "TB-500": 400,
      KPV: 400,
    });
  });
});
