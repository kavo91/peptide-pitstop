import { describe, it, expect } from "vitest";
import { contrastRatio } from "./color-contrast";

/**
 * Guards the pitstop on-surface token pairs against WCAG AA regression.
 * Surface panel is #16181C; --muted was bumped from #7A8088 (4.46:1, fails AA)
 * to #8A929B (5.64:1) per UI review C1.
 */
describe("pitstop on-surface contrast (WCAG AA)", () => {
  const surface = "#16181C";

  it("muted text clears AA body contrast on surface", () => {
    expect(contrastRatio("#8A929B", surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("ink text clears AA body contrast on surface", () => {
    expect(contrastRatio("#EDEFF2", surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("ok colour clears large/graphical contrast on surface", () => {
    expect(contrastRatio("#2ED16A", surface)).toBeGreaterThanOrEqual(3);
  });
});
