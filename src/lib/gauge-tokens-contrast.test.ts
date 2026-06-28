import { describe, it, expect } from "vitest";
import { contrastRatio } from "./color-contrast";

/**
 * Locks the pitstop gauge / chart token colours against WCAG regression in BOTH
 * themes. These hexes mirror the CSS custom properties in globals.css (kept in
 * sync by hand — same pattern as color-contrast-tokens.test.ts). They are applied
 * to SVG gauges/charts as `rgb(var(--token))`, which resolves in this stack.
 *
 *  - LIGHT Gulf: gauges + chart series sit on the white card surface (#FFFFFF);
 *    the centre numeral is text, so foregrounds need the AA body ratio (>=4.5:1).
 *    This is what the Gulf-polish work fixed (the old hardcoded hex failed here).
 *  - DARK pitstop: the "slipping" gauge figure is the ORIGINAL race-orange
 *    #FF5B14 (NOT the hi-viz --warn #E8FF3A), restoring dark byte-identity; on the
 *    #16181C surface it clears the large/graphical 3:1 threshold.
 */
describe("pitstop gauge/chart tokens — LIGHT Gulf on #FFFFFF clear AA (>=4.5:1)", () => {
  const white = "#FFFFFF";
  const cases: [string, string][] = [
    ["--ok #127C3A (on-track / HRV / RHR)", "#127C3A"],
    ["--gauge-slip #B0531A (adherence slipping)", "#B0531A"],
    ["--danger #C8323F (redline / missed-dose)", "#C8323F"],
    ["--accent #4A6B94 (body-battery gauge)", "#4A6B94"],
    ["--accent-2-strong #B0531A (sleep / VO2max / REM / plasma-5)", "#B0531A"],
    ["--muted #566B78 (no-data gauge)", "#566B78"],
  ];
  for (const [name, hex] of cases) {
    it(`${name} >= 4.5:1`, () => {
      expect(contrastRatio(hex, white)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("pitstop gauge tokens — DARK on #16181C keep the original look", () => {
  const surface = "#16181C";
  it("--gauge-slip dark is the original race-orange #FF5B14 (graphical >= 3:1)", () => {
    // Documents + guards the dark byte-identity value (vs the hi-viz --warn #E8FF3A).
    expect(contrastRatio("#FF5B14", surface)).toBeGreaterThanOrEqual(3);
  });
});
