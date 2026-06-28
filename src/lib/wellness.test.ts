import { describe, it, expect } from "vitest";
import { wellnessTrend, type WellnessEntryLike } from "./wellness";

const NOW = new Date("2026-06-20T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("wellnessTrend", () => {
  it("returns an empty, no-data summary when there are no entries", () => {
    const t = wellnessTrend([], NOW);
    expect(t.hasData).toBe(false);
    expect(t.latestWeight).toBeNull();
    expect(t.weightDelta).toBeNull();
    expect(t.latestMood).toBeNull();
    expect(t.points).toEqual([]);
  });

  it("computes latest weight, 7-day delta, points and latest mood/energy", () => {
    const entries: WellnessEntryLike[] = [
      { date: daysAgo(6), weight: 80, weightUnit: "kg", mood: 3, energy: 2 },
      { date: daysAgo(3), weight: "79", weightUnit: "kg", mood: 4, energy: 4 },
      { date: daysAgo(0), weight: 78.2, weightUnit: "kg", mood: 5, energy: 5 },
    ];
    const t = wellnessTrend(entries, NOW);
    expect(t.hasData).toBe(true);
    expect(t.latestWeight).toBe(78.2);
    expect(t.weightUnit).toBe("kg");
    expect(t.weightDelta).toBe(-1.8); // 78.2 − 80, rounded
    expect(t.latestMood).toBe(5);
    expect(t.latestEnergy).toBe(5);
    expect(t.points.map((p) => p.weight)).toEqual([80, 79, 78.2]);
  });

  it("returns a null delta when only one weight point is in the window", () => {
    const t = wellnessTrend([{ date: daysAgo(1), weight: 81, weightUnit: "kg" }], NOW);
    expect(t.latestWeight).toBe(81);
    expect(t.weightDelta).toBeNull();
  });

  it("excludes entries outside the 7-day window (older and future)", () => {
    const entries: WellnessEntryLike[] = [
      { date: daysAgo(10), weight: 90, weightUnit: "kg" }, // too old
      { date: daysAgo(2), weight: 82, weightUnit: "kg" },
      { date: daysAgo(-1), weight: 70, weightUnit: "kg" }, // future
    ];
    const t = wellnessTrend(entries, NOW);
    expect(t.points).toHaveLength(1);
    expect(t.latestWeight).toBe(82);
    expect(t.weightDelta).toBeNull();
  });

  it("does not compute a delta across mismatched units, and reads latest mood from a sparse day", () => {
    const entries: WellnessEntryLike[] = [
      { date: daysAgo(5), weight: 80, weightUnit: "kg", mood: 2 },
      { date: daysAgo(1), weight: 176, weightUnit: "lb" }, // unit changed, no mood
    ];
    const t = wellnessTrend(entries, NOW);
    expect(t.latestWeight).toBe(176);
    expect(t.weightUnit).toBe("lb");
    expect(t.weightDelta).toBeNull(); // kg → lb, no silent conversion
    expect(t.latestMood).toBe(2); // carried from the earlier, weight-only-looking day
  });
});

// Side-effect (de)serialization + display is covered in ./side-effects.test.ts
// (the structured SideEffectEntry[] shape lives in ./side-effects).
