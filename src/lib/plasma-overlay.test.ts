import { describe, it, expect } from "vitest";
import { normalizeToPeak } from "./plasma-overlay";
import type { PlasmaPoint } from "./plasma";

const T0 = new Date("2026-01-01T00:00:00Z");
function hoursLater(h: number): Date {
  return new Date(T0.getTime() + h * 60 * 60 * 1000);
}
const pt = (h: number, level: number): PlasmaPoint => ({ t: hoursLater(h), level });

describe("normalizeToPeak", () => {
  it("scales the peak sample to 1 and others proportionally", () => {
    const out = normalizeToPeak([pt(0, 50), pt(6, 200), pt(12, 100)]);
    expect(out.map((p) => p.level)).toEqual([0.25, 1, 0.5]);
  });

  it("returns all-zero levels for an all-zero series (no NaN from /0)", () => {
    const out = normalizeToPeak([pt(0, 0), pt(6, 0), pt(12, 0)]);
    expect(out.map((p) => p.level)).toEqual([0, 0, 0]);
    expect(out.every((p) => Number.isFinite(p.level))).toBe(true);
  });

  it("returns an empty array for an empty series", () => {
    expect(normalizeToPeak([])).toEqual([]);
  });

  it("preserves timestamps", () => {
    const out = normalizeToPeak([pt(0, 10), pt(6, 20)]);
    expect(out.map((p) => p.t.getTime())).toEqual([
      hoursLater(0).getTime(),
      hoursLater(6).getTime(),
    ]);
  });

  it("handles a non-positive peak without producing NaN", () => {
    const out = normalizeToPeak([pt(0, -5), pt(6, 0)]);
    expect(out.map((p) => p.level)).toEqual([0, 0]);
    expect(out.every((p) => Number.isFinite(p.level))).toBe(true);
  });

  it("does not mutate the input series", () => {
    const input = [pt(0, 50), pt(6, 100)];
    const snapshot = input.map((p) => p.level);
    normalizeToPeak(input);
    expect(input.map((p) => p.level)).toEqual(snapshot);
  });
});
