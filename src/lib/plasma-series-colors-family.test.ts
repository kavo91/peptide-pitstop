import { describe, it, expect } from "vitest";
import { assignPlasmaSeriesColors } from "./plasma-series-colors";

/**
 * Smallest arc (in degrees) containing every hue. Hue is circular, so a naive
 * max-minus-min reports ~344 for the adjacent set {354, 10, 28, 44} — the
 * family straddling 0. Find the largest empty gap and subtract it from 360.
 */
function hueSpread(hues: number[]): number {
  if (hues.length < 2) return 0;
  const sorted = [...hues].sort((a, b) => a - b);
  let largestGap = 360 - sorted[sorted.length - 1] + sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    largestGap = Math.max(largestGap, sorted[i] - sorted[i - 1]);
  }
  return 360 - largestGap;
}

/** Circular distance between two hues, 0..180. */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** hsl(H S% L%) -> { h, s, l } */
function parse(color: string) {
  const m = color.match(/hsl\((\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%\)/);
  if (!m) throw new Error(`unparseable colour: ${color}`);
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

const KLOW = "cklowid";
const blend = ["GHK-Cu", "BPC-157", "TB-500", "KPV"].map((n) => ({
  peptideId: `${KLOW}::${n}`,
  peptideName: `KLOW · ${n}`,
  stackIds: [] as string[],
  familyKey: `blend:${KLOW}`,
}));

describe("blend components are coloured as one family", () => {
  it("keeps all four components within a narrow hue band", () => {
    const out = assignPlasmaSeriesColors(blend);
    const hues = out.map((a) => parse(a.color).h);
    const spread = hueSpread(hues);
    // variantForIndex spreads hue by -24..+26 around the base: one family, not
    // four unrelated colours (which would be >=100 apart on the 12-hue wheel).
    expect(spread).toBeLessThanOrEqual(60);
  });

  it("distinguishes them by lightness, so they stay individually readable", () => {
    const out = assignPlasmaSeriesColors(blend);
    const ls = out.map((a) => parse(a.color).l).sort((a, b) => a - b);
    expect(new Set(ls).size).toBe(4); // all distinct
    expect(ls[ls.length - 1] - ls[0]).toBeGreaterThanOrEqual(20); // visibly apart
  });

  it("without familyKey the same components scatter across the wheel", () => {
    // Guards the regression this fixes: synthetic per-component ids each became
    // their own `solo:` family, so one vial rendered as four unrelated colours.
    const scattered = assignPlasmaSeriesColors(blend.map(({ familyKey, ...rest }) => rest));
    expect(hueSpread(scattered.map((a) => parse(a.color).h))).toBeGreaterThan(60);
  });

  it("does not merge a blend into unrelated solo peptides", () => {
    const out = assignPlasmaSeriesColors([
      ...blend,
      { peptideId: "ctesa", peptideName: "Tesamorelin", stackIds: [] },
      { peptideId: "cmotsc", peptideName: "MOTS-c", stackIds: [] },
    ]);
    const familyHues = out.filter((a) => a.peptideName.startsWith("KLOW")).map((a) => parse(a.color).h);
    const soloHues = out.filter((a) => !a.peptideName.startsWith("KLOW")).map((a) => parse(a.color).h);
    for (const solo of soloHues) {
      for (const fam of familyHues) {
        expect(hueDistance(solo, fam)).toBeGreaterThan(10);
      }
    }
  });

  it("still groups by stack when no familyKey is given", () => {
    const stacked = assignPlasmaSeriesColors([
      { peptideId: "a", peptideName: "BPC-157", stackIds: ["s1"] },
      { peptideId: "b", peptideName: "TB-500", stackIds: ["s1"] },
    ]);
    expect(hueSpread(stacked.map((a) => parse(a.color).h))).toBeLessThanOrEqual(60);
  });
});
