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

/** `bg-warn/10 text-warn` pills: the text sits on a 10 % tint of itself over the card or page. */
const tint = (fg: [number, number, number], bg: [number, number, number], alpha: number): string =>
  "#" + fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("");

describe("pitstop light-theme warn pill contrast (WCAG AA, 10 px text)", () => {
  // globals.css `[data-design="pitstop"][data-theme="light"] --warn` — #B45309 was 4.38:1 on the card tint.
  const warn: [number, number, number] = [160, 74, 8];
  const hex = "#A04A08";
  it("clears 4.5:1 on the warn/10 tint over the card (#FFFFFF) and the page (#F5F8FA)", () => {
    expect(contrastRatio(hex, tint(warn, [255, 255, 255], 0.1))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hex, tint(warn, [245, 248, 250], 0.1))).toBeGreaterThanOrEqual(4.5);
  });
});
