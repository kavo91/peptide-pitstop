import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DayWellness, dayDeviceHasSleep } from "./DayDetail";
import { buildEightSleepSeries, eightSleepDaysByKey, eightSleepHasSleep, type EightSleepDay } from "@/lib/eight-sleep-series";
import type { DayMetric } from "@/lib/month-metrics";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");

const garmin = (over: Partial<DayMetric> = {}): DayMetric => ({
  steps: 8000, sleepSeconds: 25200, intensityMinutes: null, caloriesActive: null, weightKg: null,
  restingHr: 52, hrvMs: 60, bodyBattery: null, sleepScore: 80, activities: [], activityCount: 0, ...over,
});
const eight = (over: Partial<EightSleepDay> = {}): EightSleepDay => ({
  sleepSeconds: 26700, score: 84, sleepHrAvg: 54, hrvMs: 47.5, respirationAvg: 15.25, tossTurns: 21,
  bedTempC: null, roomTempC: null, ...over,
});

describe("month calendar day pop-up — Eight Sleep beside Garmin", () => {
  it("Garmin only: Garmin's Wellness section, no Eight Sleep block", () => {
    const h = html(createElement(DayWellness, { metric: garmin() }));
    expect(h).toContain(">Wellness</p>");
    expect(h).not.toContain("Eight Sleep");
  });

  it("Eight Sleep only: its own block, no Garmin section", () => {
    const h = html(createElement(DayWellness, { eightSleep: eight() }));
    expect(h).toContain(">Eight Sleep</span>");
    expect(h).toContain("HRV (bed sensor)");
    expect(h).not.toContain(">Wellness</p>");
  });

  it("both: two separate blocks, each with its own numbers (never mixed)", () => {
    const h = html(createElement(DayWellness, { metric: garmin(), eightSleep: eight() }));
    const garminAt = h.indexOf(">Wellness</p>");
    const eightAt = h.indexOf(">Eight Sleep</span>");
    expect(garminAt).toBeGreaterThan(-1);
    expect(eightAt).toBeGreaterThan(garminAt);
    // Garmin's HRV stays in Garmin's section; Eight Sleep's bed-sensor HRV stays in its block.
    expect(h.slice(garminAt, eightAt)).toContain("60 ms");
    expect(h.slice(garminAt, eightAt)).not.toContain("48 ms");
    expect(h.slice(eightAt)).toContain("48 ms");
    expect(h.slice(eightAt)).not.toContain("60 ms");
  });

  it("neither: renders nothing", () => {
    expect(html(createElement(DayWellness, {}))).toBe("");
  });
});

describe("manual sleep box rule in the day pop-up", () => {
  it("hidden when Garmin has the night", () => {
    expect(dayDeviceHasSleep(garmin(), undefined)).toBe(true);
  });
  it("hidden when only Eight Sleep has the night", () => {
    expect(dayDeviceHasSleep(undefined, eight())).toBe(true);
    expect(dayDeviceHasSleep(garmin({ sleepSeconds: null, sleepScore: null }), eight())).toBe(true);
  });
  it("shown when no device has sleep (Eight Sleep row without duration or score counts as no sleep)", () => {
    expect(dayDeviceHasSleep(undefined, undefined)).toBe(false);
    expect(dayDeviceHasSleep(garmin({ sleepSeconds: null, sleepScore: null }), eight({ sleepSeconds: null, score: null }))).toBe(false);
  });
});

describe("eightSleepDaysByKey", () => {
  it("keys each Eight Sleep night by its day with that night's own values", () => {
    const series = buildEightSleepSeries([
      { date: new Date(2027, 9, 26), sleepSeconds: 26000, sleepScore: 81, hrvMs: "40.5", sleepHrAvg: 55, tossTurns: 18, respirationAvg: 14 },
      { date: new Date(2027, 9, 27), sleepSeconds: null, sleepScore: 77 },
    ]);
    const days = eightSleepDaysByKey(series);
    expect(Object.keys(days)).toEqual(["2027-10-26", "2027-10-27"]);
    expect(days["2027-10-26"]).toEqual({
      sleepSeconds: 26000, score: 81, sleepHrAvg: 55, hrvMs: 40.5, respirationAvg: 14, tossTurns: 18, bedTempC: null, roomTempC: null,
    });
    expect(days["2027-10-27"].sleepSeconds).toBeNull();
    expect(eightSleepHasSleep(days["2027-10-27"])).toBe(true);
    expect(eightSleepHasSleep(undefined)).toBe(false);
  });
});
