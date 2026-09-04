import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FIGURE_REGIONS } from "./body-figure-core";

/** The figure art ships in public/body/figure; the page breaks silently if a file goes missing. */
const DIR = join(process.cwd(), "public", "body", "figure");

describe("body figure assets", () => {
  it("ships every layer the compositor loads, at a sane size", () => {
    for (const f of ["base.png", "fat.png", "lean.png", "bone.png", "regions.png"]) {
      const s = statSync(join(DIR, f));
      expect(s.size).toBeGreaterThan(1_000);
      expect(s.size).toBeLessThan(400_000);
    }
  });

  it("meta.json names all six regions with ids 1–6 and centroids inside the image", () => {
    const meta = JSON.parse(readFileSync(join(DIR, "meta.json"), "utf8")) as { width: number; height: number; regions: Record<string, { id: number; cx: number; cy: number }> };
    expect(meta.width).toBeGreaterThan(0); expect(meta.height).toBeGreaterThan(meta.width); // portrait
    const ids = new Set<number>();
    for (const r of FIGURE_REGIONS) {
      const m = meta.regions[r];
      expect(m, `region ${r} missing from meta.json`).toBeDefined();
      expect(m.cx).toBeGreaterThan(0); expect(m.cx).toBeLessThan(meta.width);
      expect(m.cy).toBeGreaterThan(0); expect(m.cy).toBeLessThan(meta.height);
      ids.add(m.id);
    }
    expect([...ids].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    // mirror convention: the subject's left arm is on the viewer's left
    expect(meta.regions.l_arm.cx).toBeLessThan(meta.regions.r_arm.cx);
    expect(meta.regions.l_leg.cx).toBeLessThan(meta.regions.r_leg.cx);
    expect(meta.regions.head.cy).toBeLessThan(meta.regions.trunk.cy);
  });
});
