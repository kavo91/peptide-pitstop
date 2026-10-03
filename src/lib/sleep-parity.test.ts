import { describe, it, expect } from "vitest";
import { buildWearableSeries, type WearableDailyLike } from "./wearable-series";
import { mergeWellnessLog } from "./wellness-log";
import { monthMetricsByDay } from "./month-metrics";
import { fmtSleepDuration } from "./garmin-activity";

// /journal and /doses must print the same sleep total.
const row = {
  date: new Date(2027, 2, 30),
  sleepSeconds: 25200, // stored total: 7h 00m
  sleepDeepSeconds: 5400, sleepLightSeconds: 14400, sleepRemSeconds: 5400, sleepAwakeSeconds: 1800, // stages: 27000
} as WearableDailyLike;

describe("sleep total parity", () => {
  it("/journal uses the stored total, same as /doses", () => {
    const journal = mergeWellnessLog([], buildWearableSeries([row]));
    const doses = monthMetricsByDay([row]);
    expect(doses["2027-03-30"].sleepSeconds).toBe(25200);
    expect(journal[0].garmin?.sleepSeconds).toBe(25200);
  });
  it("no stored total → falls back to the stage sum on both", () => {
    const r = { ...row, sleepSeconds: null } as WearableDailyLike;
    expect(mergeWellnessLog([], buildWearableSeries([r]))[0].garmin?.sleepSeconds).toBe(27000);
    expect(monthMetricsByDay([r])["2027-03-30"].sleepSeconds).toBe(27000);
  });
});

describe("fmtSleepDuration", () => {
  it("floors minutes: 28771 s → 7h 59m, never 7h 60m", () => {
    expect(fmtSleepDuration(28771)).toBe("7h 59m");
  });
  it("always shows hours", () => {
    expect(fmtSleepDuration(25200)).toBe("7h 0m");
    expect(fmtSleepDuration(1800)).toBe("0h 30m");
  });
});
