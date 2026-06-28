import { describe, it, expect } from "vitest";
import { contrastRatio } from "./color-contrast";

/**
 * Light-mode AA-critical tokens from the spec.
 * All must pass WCAG AA (>=4.5:1) against their background.
 *
 * Token           | Hex       | Background  | Hex
 * --accent-strong | #0A7A6E  | --surface   | #FFFFFF  (text on white cards)
 * --ok            | #0A7A5E  | --surface   | #FFFFFF  (status text)
 * --on-accent     | #04221E  | --accent    | #0FB5A0  (text ON accent fills)
 */
describe("contrastRatio", () => {
  it("returns 1 for identical colours", () => {
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 1);
  });

  it("returns 21 for black on white", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
  });

  it("light accent-strong (#0A7A6E) on white surface passes AA >=4.5:1", () => {
    expect(contrastRatio("#0A7A6E", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });

  it("light ok (#0A7A5E) on white surface passes AA >=4.5:1", () => {
    expect(contrastRatio("#0A7A5E", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });

  it("light accent-2-strong (#0A6E7A) on white surface passes AA >=4.5:1 (the 'Shifted' chip text)", () => {
    expect(contrastRatio("#0A6E7A", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });

  it("light on-accent (#04221E) on accent fill (#0FB5A0) passes AA >=4.5:1", () => {
    expect(contrastRatio("#04221E", "#0FB5A0")).toBeGreaterThanOrEqual(4.5);
  });
});
