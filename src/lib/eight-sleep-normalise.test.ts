import { describe, it, expect } from "vitest";
import { normaliseEightSleepDay, eightSleepWakeDay } from "./eight-sleep-normalise";
import sample from "./__fixtures__/eight-sleep-sample.json";

describe("normaliseEightSleepDay", () => {
  it("maps a scored trend day into an eight_sleep WellnessDay", () => {
    const d = normaliseEightSleepDay(sample);
    // presenceEnd 20:35Z = 06:35 the next morning in Brisbane → the wake-up day,
    // not Eight Sleep's own "2026-06-19" label.
    expect(d.date).toBe("2026-06-20");
    expect(d.source).toBe("eight_sleep");
    expect(d.sleepSeconds).toBe(27600);
    expect(d.sleepDeepSeconds).toBe(6000);
    expect(d.sleepLightSeconds).toBe(15000);
    expect(d.sleepRemSeconds).toBe(6600);
    expect(d.sleepAwakeSeconds).toBe(3000); // presence − sleep
    expect(d.sleepScore).toBe(84);
    expect(d.hrvMs).toBe(61.5);
    expect(d.respirationAvg).toBe(15.3);
    expect(d.sleepHrAvg).toBe(58);
    expect(d.tossTurns).toBe(21);
    expect(d.bedTempC).toBe(30.3);
    expect(d.roomTempC).toBe(21.5);
    expect(d.activities).toEqual([]);
    expect(d.activityCount).toBe(0);
    expect(d.raw).toBe(sample);
  });

  it("never fills Garmin-only columns", () => {
    const d = normaliseEightSleepDay(sample);
    expect(d.restingHr).toBeUndefined();
    expect(d.steps).toBeUndefined();
    expect(d.weightKg).toBeUndefined();
    expect(d.bodyBatteryHigh).toBeUndefined();
  });

  it("drops the API's literal \"None\" strings", () => {
    const d = normaliseEightSleepDay({
      ...sample,
      tnt: "None",
      sleepQualityScore: { hrv: { current: "None" }, heartRate: { current: "None" } },
      sessions: [{ timeseries: { heartRate: [["t", "None"], ["t", 60]] } }],
    });
    expect(d.tossTurns).toBeUndefined();
    expect(d.hrvMs).toBeUndefined();
    expect(d.sleepHrAvg).toBe(60); // falls back to the session samples, "None" skipped
  });

  it("skips (date \"\") a night still processing", () => {
    expect(normaliseEightSleepDay({ ...sample, processing: true }).date).toBe("");
  });

  it("skips (date \"\") a day with no sleep (away side, empty night)", () => {
    expect(normaliseEightSleepDay({ day: "2026-06-19", score: 0, sessions: [{}] }).date).toBe("");
    expect(normaliseEightSleepDay({ ...sample, sleepDuration: 0 }).date).toBe("");
  });

  it("night values prefer the quality score's average over its current reading", () => {
    const d = normaliseEightSleepDay({
      ...sample,
      sleepQualityScore: {
        hrv: { current: 70, average: 63.5 },
        respiratoryRate: { current: 16.5, average: 15.75 },
        heartRate: { current: 62, average: 56.25 },
      },
    });
    expect(d.hrvMs).toBe(63.5);
    expect(d.respirationAvg).toBe(15.8);
    expect(d.sleepHrAvg).toBe(56);
  });

  it("falls back to current when average is missing or \"None\"", () => {
    const d = normaliseEightSleepDay({
      ...sample,
      sleepQualityScore: { hrv: { current: 70, average: "None" }, heartRate: { current: 62 } },
    });
    expect(d.hrvMs).toBe(70);
    expect(d.sleepHrAvg).toBe(62);
  });

  it("a zero average or current is a gap: falls through to the next source", () => {
    const d = normaliseEightSleepDay({
      ...sample,
      sleepQualityScore: { hrv: { average: 0, current: 66 }, heartRate: { average: 0, current: 0 }, tempBedC: { average: 0 } },
      sessions: [{ timeseries: { heartRate: [["t", 57]], tempBedC: [["t", 28.4]] } }],
    });
    expect(d.hrvMs).toBe(66);
    expect(d.sleepHrAvg).toBe(57); // session mean
    expect(d.bedTempC).toBe(28.4); // timeseries, not the 0 average
  });

  it("a night with no sessions key leaves temperature unset", () => {
    const { sessions: _omit, ...noSessions } = sample as Record<string, unknown>;
    const d = normaliseEightSleepDay({ ...noSessions, sleepQualityScore: {} });
    expect(d.bedTempC).toBeUndefined();
    expect(d.roomTempC).toBeUndefined();
  });

  it("bed and room temperature come from the session timeseries when the score has none", () => {
    const d = normaliseEightSleepDay({
      ...sample,
      sleepQualityScore: { hrv: { average: 50 } },
      sessions: [
        { timeseries: { tempBedC: [["t1", 28], ["t2", 29.5]], tempRoomC: [["t1", 21], ["t2", "None"]] } },
        { timeseries: { tempBedC: [["t3", 30.1], ["t4", 0]], tempRoomC: [["t3", 22.4]] } },
      ],
    });
    expect(d.bedTempC).toBe(29.2); // mean of 28, 29.5, 30.1 (the 0 is a gap)
    expect(d.roomTempC).toBe(21.7); // mean of 21, 22.4 ("None" dropped)
  });

  it("the score's temperature average wins over the timeseries when both exist", () => {
    const d = normaliseEightSleepDay({
      ...sample,
      sessions: [{ timeseries: { tempBedC: [["t", 40]], tempRoomC: [["t", 40]] } }],
    });
    expect(d.bedTempC).toBe(30.3);
    expect(d.roomTempC).toBe(21.5);
  });

  it("temperature stays unset with no score average and no timeseries", () => {
    const d = normaliseEightSleepDay({ ...sample, sleepQualityScore: {}, sessions: [{ timeseries: {} }] });
    expect(d.bedTempC).toBeUndefined();
    expect(d.roomTempC).toBeUndefined();
  });

  it("awake is Eight Sleep's wasoDuration when sent, not presence − sleep", () => {
    expect(normaliseEightSleepDay({ ...sample, wasoDuration: 1260 }).sleepAwakeSeconds).toBe(1260);
    expect(normaliseEightSleepDay({ ...sample, wasoDuration: 0 }).sleepAwakeSeconds).toBe(0);
    expect(normaliseEightSleepDay({ ...sample, wasoDuration: "None" }).sleepAwakeSeconds).toBe(3000);
    expect(normaliseEightSleepDay({ ...sample, wasoDuration: -5 }).sleepAwakeSeconds).toBe(3000);
  });

  it("leaves awake unset when presence is missing or shorter than sleep", () => {
    expect(normaliseEightSleepDay({ ...sample, presenceDuration: undefined }).sleepAwakeSeconds).toBeUndefined();
    expect(normaliseEightSleepDay({ ...sample, presenceDuration: 100 }).sleepAwakeSeconds).toBeUndefined();
  });
});

describe("eightSleepWakeDay", () => {
  it("uses the local date of presenceEnd", () => {
    expect(eightSleepWakeDay({ presenceEnd: "2026-06-19T13:59:00.000Z" })).toBe("2026-06-19"); // 23:59 local
    expect(eightSleepWakeDay({ presenceEnd: "2026-06-19T14:00:00.000Z" })).toBe("2026-06-20"); // 00:00 local
  });
  it("reads a zone-less timestamp as UTC, not local (no day shift)", () => {
    expect(eightSleepWakeDay({ presenceEnd: "2026-06-19T20:35:00.000" })).toBe("2026-06-20");
    expect(eightSleepWakeDay({ presenceEnd: "2026-06-19T20:35:00" })).toBe("2026-06-20");
    expect(eightSleepWakeDay({ presenceEnd: "2026-06-19T20:35:00+00:00" })).toBe("2026-06-20");
    expect(eightSleepWakeDay({ presenceEnd: "2026-06-20T06:35:00+10:00" })).toBe("2026-06-20");
  });
  it("falls back to the day label, then to \"\"", () => {
    expect(eightSleepWakeDay({ day: "2026-06-19" })).toBe("2026-06-19");
    expect(eightSleepWakeDay({ presenceEnd: "garbage", day: "2026-06-18" })).toBe("2026-06-18");
    expect(eightSleepWakeDay({ day: "19/06/2026" })).toBe("");
    expect(eightSleepWakeDay(null)).toBe("");
  });
});
