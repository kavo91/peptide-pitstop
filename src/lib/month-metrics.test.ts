import { describe, it, expect } from "vitest";
import { monthMetricsByDay } from "./month-metrics";
import type { WearableDailyLike } from "./wearable-series";

// Decimal-ish stand-in (Prisma returns objects with toString()).
const dec = (s: string) => ({ toString: () => s });

describe("monthMetricsByDay", () => {
  it("returns an empty map for no rows", () => {
    expect(monthMetricsByDay([])).toEqual({});
  });

  it("keys each row by its local YYYY-MM-DD date", () => {
    const rows: WearableDailyLike[] = [{ date: new Date(2026, 5, 18), steps: 8400 }];
    const m = monthMetricsByDay(rows);
    expect(Object.keys(m)).toEqual(["2026-06-18"]);
    expect(m["2026-06-18"].steps).toBe(8400);
  });

  it("coerces Prisma Decimal fields (weightKg, hrvMs) to numbers", () => {
    const rows: WearableDailyLike[] = [
      { date: new Date(2026, 5, 18), weightKg: dec("81.9"), hrvMs: dec("58") },
    ];
    const m = monthMetricsByDay(rows)["2026-06-18"];
    expect(m.weightKg).toBe(81.9);
    expect(m.hrvMs).toBe(58);
  });

  it("maps all scalar metrics and bodyBatteryHigh → bodyBattery", () => {
    const rows: WearableDailyLike[] = [
      {
        date: new Date(2026, 5, 18),
        sleepSeconds: 26100,
        sleepScore: 80,
        restingHr: 54,
        bodyBatteryHigh: 85,
        bodyBatteryLow: 20,
        steps: 7000,
        caloriesActive: 600,
        intensityMinutes: 30,
      },
    ];
    expect(monthMetricsByDay(rows)["2026-06-18"]).toEqual({
      steps: 7000,
      sleepSeconds: 26100,
      intensityMinutes: 30,
      caloriesActive: 600,
      weightKg: null,
      restingHr: 54,
      hrvMs: null,
      bodyBattery: 85,
      sleepScore: 80,
      activities: [],
      activityCount: 0,
    });
  });

  it("parses activitiesJson into a GarminActivity[] + activityCount", () => {
    const activities = [
      { type: "running", durationSec: 1830, distanceM: 5000 },
      { type: "strength_training", durationSec: 2700 },
    ];
    const rows: WearableDailyLike[] = [
      { date: new Date(2026, 5, 18), activitiesJson: JSON.stringify(activities), activityCount: 2 },
    ];
    const m = monthMetricsByDay(rows)["2026-06-18"];
    expect(m.activities).toEqual(activities);
    expect(m.activityCount).toBe(2);
  });

  it("returns [] for malformed activitiesJson instead of throwing", () => {
    const rows: WearableDailyLike[] = [
      { date: new Date(2026, 5, 18), activitiesJson: "{not json", activityCount: 3 },
    ];
    const m = monthMetricsByDay(rows)["2026-06-18"];
    expect(m.activities).toEqual([]);
    // count still reflects the stored count even when the JSON is unparseable
    expect(m.activityCount).toBe(3);
  });

  it("treats a non-array activitiesJson value as no activities", () => {
    const rows: WearableDailyLike[] = [
      { date: new Date(2026, 5, 18), activitiesJson: JSON.stringify({ not: "an array" }) },
    ];
    const m = monthMetricsByDay(rows)["2026-06-18"];
    expect(m.activities).toEqual([]);
    expect(m.activityCount).toBe(0);
  });

  it("null activitiesJson → empty activities, count 0", () => {
    const rows: WearableDailyLike[] = [{ date: new Date(2026, 5, 18), steps: 100 }];
    const m = monthMetricsByDay(rows)["2026-06-18"];
    expect(m.activities).toEqual([]);
    expect(m.activityCount).toBe(0);
  });

  it("derives sleepSeconds from the stored total when present", () => {
    const rows: WearableDailyLike[] = [
      {
        date: new Date(2026, 5, 18),
        sleepSeconds: 27000, // stored total wins
        sleepDeepSeconds: 1,
        sleepLightSeconds: 2,
      },
    ];
    expect(monthMetricsByDay(rows)["2026-06-18"].sleepSeconds).toBe(27000);
  });

  it("falls back to summing stage seconds when no stored total", () => {
    const rows: WearableDailyLike[] = [
      {
        date: new Date(2026, 5, 18),
        sleepDeepSeconds: 5400,
        sleepLightSeconds: 16200,
        sleepRemSeconds: 4500,
        sleepAwakeSeconds: 900,
      },
    ];
    expect(monthMetricsByDay(rows)["2026-06-18"].sleepSeconds).toBe(27000);
  });

  it("sleepSeconds is null when neither total nor any stage is present", () => {
    const rows: WearableDailyLike[] = [{ date: new Date(2026, 5, 18), steps: 100 }];
    expect(monthMetricsByDay(rows)["2026-06-18"].sleepSeconds).toBeNull();
  });

  it("handles multiple days independently", () => {
    const rows: WearableDailyLike[] = [
      { date: new Date(2026, 5, 18), steps: 7000 },
      { date: new Date(2026, 5, 20), steps: 9000, sleepScore: 88 },
    ];
    const m = monthMetricsByDay(rows);
    expect(Object.keys(m).sort()).toEqual(["2026-06-18", "2026-06-20"]);
    expect(m["2026-06-18"].steps).toBe(7000);
    expect(m["2026-06-20"].steps).toBe(9000);
    expect(m["2026-06-20"].sleepScore).toBe(88);
  });
});
