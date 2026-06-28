import { describe, it, expect } from "vitest";
import { mergeWellnessLog, type ManualDay } from "./wellness-log";
import type { WearableSeries } from "./wearable-series";

/** Build a WearableSeries from partial arrays (latestSnapshot is irrelevant to the merge). */
function series(parts: Partial<WearableSeries>): WearableSeries {
  return {
    sleep: parts.sleep ?? [],
    recovery: parts.recovery ?? [],
    weight: parts.weight ?? [],
    activity: parts.activity ?? [],
    latestSnapshot: parts.latestSnapshot ?? null,
  };
}

const EMPTY = series({});

const manualDay = (date: string, over: Partial<ManualDay> = {}): ManualDay => ({
  date,
  weight: null,
  weightUnit: null,
  mood: null,
  energy: null,
  sleep: null,
  calories: null,
  proteinG: null,
  waterMl: null,
  sideEffects: null,
  sideEffectEntries: [],
  notes: null,
  ...over,
});

describe("mergeWellnessLog", () => {
  it("returns an empty array when there is no manual or wearable data", () => {
    expect(mergeWellnessLog([], EMPTY)).toEqual([]);
  });

  it("keeps a manual-only day (garmin null)", () => {
    const m = manualDay("2026-06-10", {
      weight: 80,
      weightUnit: "kg",
      mood: 4,
      energy: 3,
      sleep: 7,
      sideEffects: "nausea",
      notes: "felt ok",
    });
    const out = mergeWellnessLog([m], EMPTY);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-06-10");
    expect(out[0].manual).toEqual(m);
    expect(out[0].garmin).toBeNull();
  });

  it("assembles a garmin-only day, summing sleep stage seconds", () => {
    const s = series({
      sleep: [{ date: "2026-06-11", deep: 3600, light: 7200, rem: 1800, awake: 600, score: 82 }],
      recovery: [
        { date: "2026-06-11", restingHr: 52, hrvMs: 45, bodyBatteryHigh: 88, bodyBatteryLow: 20, stressAvg: 30 },
      ],
      weight: [{ date: "2026-06-11", weightKg: 79.5 }],
      activity: [{ date: "2026-06-11", steps: 9000, caloriesActive: 500, vo2max: 48, intensityMinutes: 45, activities: [] }],
    });
    const out = mergeWellnessLog([], s);
    expect(out).toHaveLength(1);
    expect(out[0].manual).toBeNull();
    expect(out[0].garmin).toEqual({
      sleepSeconds: 3600 + 7200 + 1800 + 600, // 13200
      sleepScore: 82,
      weightKg: 79.5,
      steps: 9000,
      caloriesActive: 500,
      intensityMinutes: 45,
      restingHr: 52,
      hrvMs: 45,
      bodyBattery: 88,
      activities: [],
    });
  });

  it("threads logged activities through to the garmin block", () => {
    const acts = [
      { type: "running", durationSec: 1830, distanceM: 5000 },
      { type: "strength_training", durationSec: 2700 },
    ];
    const s = series({
      activity: [
        { date: "2026-06-14", steps: 8000, caloriesActive: 400, vo2max: null, intensityMinutes: 20, activities: acts },
      ],
    });
    const out = mergeWellnessLog([], s);
    expect(out).toHaveLength(1);
    expect(out[0].garmin?.activities).toEqual(acts);
  });

  it("a day with ONLY logged activities (no scalar metric) still counts as garmin", () => {
    const s = series({
      activity: [
        {
          date: "2026-06-15",
          steps: null,
          caloriesActive: null,
          vo2max: null,
          intensityMinutes: null,
          activities: [{ type: "cycling", durationSec: 3600 }],
        },
      ],
    });
    const out = mergeWellnessLog([], s);
    expect(out).toHaveLength(1);
    expect(out[0].garmin).not.toBeNull();
    expect(out[0].garmin?.activities).toHaveLength(1);
  });

  it("an EMPTY activities array alone does NOT make a day count as garmin", () => {
    const s = series({
      activity: [
        { date: "2026-06-16", steps: null, caloriesActive: null, vo2max: null, intensityMinutes: null, activities: [] },
      ],
    });
    expect(mergeWellnessLog([], s)).toEqual([]);
  });

  it("merges manual and garmin for the same date into one row", () => {
    const m = manualDay("2026-06-11", { weight: 79, weightUnit: "kg", mood: 5 });
    const s = series({
      sleep: [{ date: "2026-06-11", deep: 3600, light: 3600, rem: null, awake: null, score: 70 }],
      activity: [{ date: "2026-06-11", steps: 5000, caloriesActive: null, vo2max: null, intensityMinutes: 12, activities: [] }],
    });
    const out = mergeWellnessLog([m], s);
    expect(out).toHaveLength(1);
    expect(out[0].manual).toEqual(m);
    expect(out[0].garmin?.sleepSeconds).toBe(7200); // only the two non-null stages
    expect(out[0].garmin?.sleepScore).toBe(70);
    expect(out[0].garmin?.steps).toBe(5000);
    expect(out[0].garmin?.intensityMinutes).toBe(12);
    expect(out[0].garmin?.weightKg).toBeNull();
  });

  it("orders the union of dates reverse-chronologically (newest first)", () => {
    const manual = [manualDay("2026-06-09"), manualDay("2026-06-10", { mood: 3 })];
    const s = series({
      sleep: [
        { date: "2026-06-11", deep: 3600, light: null, rem: null, awake: null, score: null },
        { date: "2026-06-10", deep: 1800, light: null, rem: null, awake: null, score: null },
      ],
    });
    const out = mergeWellnessLog(manual, s);
    expect(out.map((d) => d.date)).toEqual(["2026-06-11", "2026-06-10", "2026-06-09"]);
    // 06-10 has both manual and garmin; 06-11 garmin-only; 06-09 manual-only.
    expect(out[1].manual?.mood).toBe(3);
    expect(out[1].garmin?.sleepSeconds).toBe(1800);
    expect(out[0].manual).toBeNull();
    expect(out[2].garmin).toBeNull();
  });

  it("drops a date that has a wearable row but no non-null metric and no manual entry", () => {
    const s = series({
      sleep: [{ date: "2026-06-12", deep: null, light: null, rem: null, awake: null, score: null }],
      recovery: [
        { date: "2026-06-12", restingHr: null, hrvMs: null, bodyBatteryHigh: null, bodyBatteryLow: null, stressAvg: null },
      ],
      activity: [{ date: "2026-06-12", steps: null, caloriesActive: null, vo2max: null, intensityMinutes: null, activities: [] }],
    });
    expect(mergeWellnessLog([], s)).toEqual([]);
  });

  it("keeps a garmin day with a score but no stage data (sleepSeconds null)", () => {
    const s = series({
      sleep: [{ date: "2026-06-13", deep: null, light: null, rem: null, awake: null, score: 65 }],
    });
    const out = mergeWellnessLog([], s);
    expect(out).toHaveLength(1);
    expect(out[0].garmin?.sleepSeconds).toBeNull();
    expect(out[0].garmin?.sleepScore).toBe(65);
  });
});
