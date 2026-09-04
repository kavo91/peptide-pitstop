import { describe, it, expect } from "vitest";
import { normaliseGarminDay } from "./wearable-normalise";
import sample from "./__fixtures__/garmin-sample.json";

describe("normaliseGarminDay", () => {
  it("maps the assembled Garmin day fixture into a WellnessDay", () => {
    const d = normaliseGarminDay(sample);

    expect(d.date).toBe("2026-06-20");
    expect(d.source).toBe("garmin");

    // sleep (seconds, passed through)
    expect(d.sleepSeconds).toBe(27000);
    expect(d.sleepDeepSeconds).toBe(5400);
    expect(d.sleepLightSeconds).toBe(16200);
    expect(d.sleepRemSeconds).toBe(4500);
    expect(d.sleepAwakeSeconds).toBe(900);
    expect(d.sleepScore).toBe(82);

    // recovery
    expect(d.restingHr).toBe(52);
    expect(d.hrvMs).toBe(62);
    expect(d.hrvStatus).toBe("balanced");
    expect(d.bodyBatteryHigh).toBe(88);
    expect(d.bodyBatteryLow).toBe(19);
    expect(d.stressAvg).toBe(33);

    // body composition (grams → kg)
    expect(d.weightKg).toBeCloseTo(81.7, 5);
    expect(d.bmi).toBeCloseTo(24.1, 5);
    expect(d.bodyFatPct).toBeCloseTo(18.4, 5);

    // activity
    expect(d.steps).toBe(8423);
    expect(d.caloriesActive).toBe(640);
    expect(d.vo2max).toBeCloseTo(48.0, 5);
    // Garmin weighting: moderate + 2 × vigorous = 25 + 20
    expect(d.intensityMinutes).toBe(45);

    // misc — summary values preferred over sleep DTO
    expect(d.spo2Avg).toBe(95);
    expect(d.respirationAvg).toBeCloseTo(13.8, 5);

    // raw payload preserved verbatim
    expect(d.raw).toBe(sample);
  });

  it("returns undefined for every metric when the day is empty (only a date)", () => {
    const d = normaliseGarminDay({ date: "2026-06-01" });
    expect(d.date).toBe("2026-06-01");
    expect(d.source).toBe("garmin");
    expect(d.sleepSeconds).toBeUndefined();
    expect(d.restingHr).toBeUndefined();
    expect(d.hrvMs).toBeUndefined();
    expect(d.weightKg).toBeUndefined();
    expect(d.steps).toBeUndefined();
    expect(d.vo2max).toBeUndefined();
    expect(d.intensityMinutes).toBeUndefined();
    expect(d.spo2Avg).toBeUndefined();
    // no activities → empty array + zero count
    expect(d.activities).toEqual([]);
    expect(d.activityCount).toBe(0);
  });

  it("normalises raw.activities into a GarminActivity[] + activityCount", () => {
    const d = normaliseGarminDay({
      date: "2026-06-20",
      activities: [
        { activityType: { typeKey: "running" }, duration: 1830, distance: 5000, activityName: "AM Run" },
        { activityType: { typeKey: "strength_training" }, duration: 2700 },
      ],
    });
    expect(d.activityCount).toBe(2);
    expect(d.activities).toHaveLength(2);
    expect(d.activities[0]).toMatchObject({ type: "running", durationSec: 1830, distanceM: 5000, name: "AM Run" });
    expect(d.activities[1]).toMatchObject({ type: "strength_training", durationSec: 2700 });
    expect(d.activities[1].distanceM).toBeUndefined();
  });

  it("treats a non-array activities value as no activities", () => {
    const d = normaliseGarminDay({ date: "2026-06-21", activities: "nope" });
    expect(d.activities).toEqual([]);
    expect(d.activityCount).toBe(0);
  });

  it("does not throw on null/garbage sub-objects (defensive optional chaining)", () => {
    const d = normaliseGarminDay({
      date: "2026-06-02",
      sleep: null,
      summary: { totalSteps: null, restingHeartRate: undefined },
      hrv: { hrvSummary: null },
      weight: {},
      vo2max: "not-a-number",
    });
    expect(d.steps).toBeUndefined();
    expect(d.restingHr).toBeUndefined();
    expect(d.hrvMs).toBeUndefined();
    expect(d.weightKg).toBeUndefined();
    expect(d.vo2max).toBeUndefined();
  });

  it("converts sleep stage minutes → seconds when only minute fields are present", () => {
    const d = normaliseGarminDay({
      date: "2026-06-03",
      sleep: {
        dailySleepDTO: {
          sleepTimeMinutes: 450,
          deepSleepMinutes: 90,
          lightSleepMinutes: 270,
          remSleepMinutes: 75,
          awakeSleepMinutes: 15,
        },
      },
    });
    expect(d.sleepSeconds).toBe(27000);
    expect(d.sleepDeepSeconds).toBe(5400);
    expect(d.sleepLightSeconds).toBe(16200);
    expect(d.sleepRemSeconds).toBe(4500);
    expect(d.sleepAwakeSeconds).toBe(900);
  });

  it("accepts a bare numeric vo2max and an already-kg weight", () => {
    const d = normaliseGarminDay({
      date: "2026-06-04",
      vo2max: 47.5,
      weight: { totalAverage: { weightKg: 80.2 } },
    });
    expect(d.vo2max).toBeCloseTo(47.5, 5);
    expect(d.weightKg).toBeCloseTo(80.2, 5);
  });

  it("falls back to sleep-DTO spo2/respiration when the summary lacks them", () => {
    const d = normaliseGarminDay({
      date: "2026-06-05",
      sleep: { dailySleepDTO: { averageSpO2Value: 93, averageRespirationValue: 15.1 } },
      summary: {},
    });
    expect(d.spo2Avg).toBe(93);
    expect(d.respirationAvg).toBeCloseTo(15.1, 5);
  });
});

// ── Training metrics (Fenix 9 Pro era endpoints; shapes verified 2026-09-03) ──
import trainingSample from "./__fixtures__/garmin-training-sample.json";
import { normaliseTraining, LT_SPEED_TO_MS } from "./wearable-normalise";
import { paceFromSpeed } from "./wearable-chart";

describe("normaliseTraining", () => {
  const t = normaliseTraining(trainingSample);

  it("prefers the primary tracker's readiness entry and the primary device's training status", () => {
    expect(t.trainingReadiness).toBe(61);
    expect(t.trainingReadinessLevel).toBe("MODERATE");
    expect(t.acuteLoad).toBe(420);
    expect(t.chronicLoad).toBe(300);
    expect(t.acwr).toBeCloseTo(1.4, 9);
    expect(t.acwrStatus).toBe("HIGH");
    expect(t.trainingStatus).toBe("PRODUCTIVE");
  });

  it("converts Garmin's tenth-of-m/s threshold speed to the pace Garmin Connect displays", () => {
    // Garmin Connect → Performance Stats → Lactate Threshold displays the pace
    // for a raw speed value that is tenths of m/s (0.35 → 3.5 m/s → 4:46 /km).
    expect(LT_SPEED_TO_MS).toBe(10);
    const ms = t.ltSpeedMs!;
    expect(ms).toBeCloseTo(3.5, 9);
    expect(paceFromSpeed(ms)).toBe("4:46 /km");
  });

  it("reads the scores, fitness age and lactate threshold as printed", () => {
    expect(t.enduranceScore).toBe(5400);
    expect(t.hillScore).toBe(35);
    expect(t.fitnessAge).toBeCloseTo(34.5, 9);
    expect(t.ltHr).toBe(162);
    expect(t.ltSpeedMs).toBeCloseTo(3.5, 9); // raw 0.35 x10 = m/s (4:46 /km)
  });

  it("sums floors ascended by the descriptor index and averages the 7-day resting HR", () => {
    expect(t.floorsClimbed).toBe(12); // 3 + 4.2 + 5 → 12.2 → 12
    expect(t.restingHr7d).toBe(57); // mean of 55,56,58,57,59,56,58 = 57
  });

  it("falls back to the VO2max block's fitness age and leaves everything undefined on an old-style day", () => {
    const noAge = normaliseTraining({ ...trainingSample, fitnessAge: undefined });
    expect(noAge.fitnessAge).toBe(36);
    const bare = normaliseTraining(sample);
    for (const v of Object.values(bare)) expect(v).toBeUndefined();
  });

  it("flows into normaliseGarminDay", () => {
    const d = normaliseGarminDay(trainingSample);
    expect(d.trainingReadiness).toBe(61);
    expect(d.restingHr7d).toBe(57);
    expect(d.steps).toBe(8200);
  });
});
