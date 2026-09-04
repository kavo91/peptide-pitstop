import { describe, expect, it } from "vitest";
import { BACK_LINES, BODY_OUTLINE, FRONT_LINES, HEAD_ELLIPSE, SILHOUETTE_VIEWBOX } from "./body-silhouette";

describe("body-silhouette geometry (shared by the injection-site BodyMap)", () => {
  it("keeps the seven closed outline paths BodyMap draws", () => {
    expect(BODY_OUTLINE).toHaveLength(7);
    for (const d of BODY_OUTLINE) {
      expect(d.startsWith("M")).toBe(true);
      expect(d.trim().endsWith("Z")).toBe(true);
    }
    expect(FRONT_LINES.length).toBeGreaterThan(0);
    expect(BACK_LINES.length).toBeGreaterThan(0);
    expect(SILHOUETTE_VIEWBOX).toBe("0 0 180 320");
    expect(HEAD_ELLIPSE).toEqual({ cx: 90, cy: 26, rx: 15, ry: 18 });
  });
});
