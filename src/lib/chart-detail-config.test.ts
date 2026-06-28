import { describe, it, expect } from "vitest";
import { isChartId, sleepHours, buildChartSeries } from "./chart-detail-config";
import type { WearableSeries } from "@/lib/wearable-series";

describe("isChartId", () => {
  it("accepts known ids, rejects others", () => {
    expect(isChartId("sleep")).toBe(true);
    expect(isChartId("activity")).toBe(true);
    expect(isChartId("bogus")).toBe(false);
  });
});

describe("sleepHours", () => {
  it("sums deep+light+rem seconds into hours (excludes awake)", () => {
    expect(sleepHours({ deep: 3600, light: 7200, rem: 1800 })).toBe(3.5);
  });
  it("is null when no stage data is present", () => {
    expect(sleepHours({ deep: null, light: null, rem: null })).toBeNull();
  });
  it("treats a present-but-partial night as the sum of what's there", () => {
    expect(sleepHours({ deep: 3600, light: null, rem: null })).toBe(1);
  });
});

describe("buildChartSeries", () => {
  const series = {
    sleep: [{ date: "2026-06-20", deep: 3600, light: 7200, rem: 1800, awake: 600, score: 80 }],
    recovery: [{ date: "2026-06-20", restingHr: 51, hrvMs: 36, bodyBatteryHigh: 90, bodyBatteryLow: 20, stressAvg: 26 }],
    weight: [{ date: "2026-06-20", weightKg: 78.5 }],
    activity: [{ date: "2026-06-20", steps: 16848, caloriesActive: 700, vo2max: 58, intensityMinutes: 40 }],
    latestSnapshot: null,
  } as unknown as WearableSeries;

  it("projects the sleep score + derived hours", () => {
    const out = buildChartSeries("sleep", series);
    expect(out.score[0].value).toBe(80);
    expect(out.hours[0].value).toBe(3.5);
  });
  it("projects recovery and activity keys", () => {
    expect(buildChartSeries("recovery", series).restingHr[0].value).toBe(51);
    expect(buildChartSeries("activity", series).steps[0].value).toBe(16848);
    expect(buildChartSeries("body", series).weightKg[0].value).toBe(78.5);
  });
});
