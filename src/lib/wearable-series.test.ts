import { describe, it, expect } from "vitest";
import { buildWearableSeries, type WearableDailyLike } from "./wearable-series";

// Decimal-ish stand-in (Prisma returns objects with toString()).
const dec = (s: string) => ({ toString: () => s });

const rows: WearableDailyLike[] = [
  {
    date: new Date(2026, 5, 18), // 2026-06-18 local
    sleepDeepSeconds: 5400,
    sleepLightSeconds: 16200,
    sleepRemSeconds: 4500,
    sleepAwakeSeconds: 900,
    sleepScore: 80,
    restingHr: 54,
    hrvMs: dec("58"),
    bodyBatteryHigh: 85,
    bodyBatteryLow: 20,
    stressAvg: 35,
    weightKg: dec("81.9"),
    steps: 7000,
    caloriesActive: 600,
    vo2max: dec("47"),
    intensityMinutes: 30,
    activitiesJson: JSON.stringify([{ type: "running", durationSec: 1830, distanceM: 5000 }]),
    activityCount: 1,
  },
  {
    date: new Date(2026, 5, 20), // 2026-06-20 local (out of order on purpose)
    sleepDeepSeconds: 6000,
    sleepLightSeconds: 15000,
    sleepRemSeconds: 5000,
    sleepAwakeSeconds: 600,
    sleepScore: 88,
    restingHr: 51,
    hrvMs: dec("63"),
    bodyBatteryHigh: 90,
    bodyBatteryLow: 25,
    stressAvg: 30,
    weightKg: null, // missing weight today
    steps: 9000,
    caloriesActive: 720,
    vo2max: null,
    intensityMinutes: null,
  },
];

describe("buildWearableSeries", () => {
  it("returns empty series and a null snapshot for no rows", () => {
    const s = buildWearableSeries([]);
    expect(s.sleep).toEqual([]);
    expect(s.recovery).toEqual([]);
    expect(s.weight).toEqual([]);
    expect(s.activity).toEqual([]);
    expect(s.latestSnapshot).toBeNull();
  });

  it("builds typed series sorted ascending by date with Decimals coerced to numbers", () => {
    const s = buildWearableSeries(rows);

    expect(s.sleep.map((p) => p.date)).toEqual(["2026-06-18", "2026-06-20"]);
    expect(s.sleep[1]).toEqual({
      date: "2026-06-20",
      deep: 6000,
      light: 15000,
      rem: 5000,
      awake: 600,
      score: 88,
    });

    expect(s.recovery[0]).toEqual({
      date: "2026-06-18",
      restingHr: 54,
      hrvMs: 58,
      bodyBatteryHigh: 85,
      bodyBatteryLow: 20,
      stressAvg: 35,
    });

    expect(s.activity[1]).toEqual({
      date: "2026-06-20",
      steps: 9000,
      caloriesActive: 720,
      vo2max: null,
      intensityMinutes: null,
      activities: [], // no logged workouts on the 20th
    });
    expect(s.activity[0].intensityMinutes).toBe(30); // carries through from the row
    // logged activities thread through from activitiesJson
    expect(s.activity[0].activities).toEqual([{ type: "running", durationSec: 1830, distanceM: 5000 }]);
  });

  it("omits weight points whose weightKg is null", () => {
    const s = buildWearableSeries(rows);
    expect(s.weight).toEqual([{ date: "2026-06-18", weightKg: 81.9 }]);
  });

  it("latestSnapshot takes the most recent non-null value per metric", () => {
    const s = buildWearableSeries(rows);
    expect(s.latestSnapshot).toEqual({
      asOf: "2026-06-20",
      restingHr: 51,
      hrvMs: 63,
      bodyBattery: 90,
      sleepScore: 88,
      // weight today was null → carried forward from 2026-06-18
      weightKg: 81.9,
      // no workout on the 20th → latest-available workout carried from 2026-06-18
      activities: [{ type: "running", durationSec: 1830, distanceM: 5000 }],
      // ...and activitiesAsOf records the workout's REAL day (06-18), NOT asOf
      // (06-20) — so the dashboard can label it "Yesterday", not as today's.
      activitiesAsOf: "2026-06-18",
    });
  });

  it("activitiesAsOf is the workout's own day even when asOf is a later activity-less day", () => {
    const s = buildWearableSeries(rows);
    // asOf advances to the latest row (06-20, which had no workout) but the
    // carried-forward workout keeps its source day so the UI never mislabels it.
    expect(s.latestSnapshot?.asOf).toBe("2026-06-20");
    expect(s.latestSnapshot?.activitiesAsOf).toBe("2026-06-18");
    expect(s.latestSnapshot?.activitiesAsOf).not.toBe(s.latestSnapshot?.asOf);
  });

  it("activitiesAsOf is null when no day in the window had a workout", () => {
    const noWorkouts = rows.map((r) => ({ ...r, activitiesJson: null }));
    const s = buildWearableSeries(noWorkouts);
    expect(s.latestSnapshot?.activities).toEqual([]);
    expect(s.latestSnapshot?.activitiesAsOf).toBeNull();
  });
});

// ── Training series (added 2026-09-03) ──
describe("buildWearableSeries — training", () => {
  it("emits one training point per day, in date order, with Decimal-ish numbers converted", () => {
    const s = buildWearableSeries([
      { date: new Date(2026, 5, 20), trainingReadiness: 61, trainingReadinessLevel: "MODERATE", acwr: dec("1.4"), acwrStatus: "HIGH", acuteLoad: 420, chronicLoad: 300, trainingStatus: "PRODUCTIVE", enduranceScore: 6800, hillScore: 40, fitnessAge: dec("31.5"), ltHr: 168, ltSpeedMs: dec("3.2"), floorsClimbed: 12, restingHr7d: 52 },
      { date: new Date(2026, 5, 19) },
    ]);
    expect(s.training.map((t) => t.date)).toEqual(["2026-06-19", "2026-06-20"]);
    const t = s.training[1];
    expect(t.readiness).toBe(61); expect(t.readinessLevel).toBe("MODERATE");
    expect(t.acwr).toBeCloseTo(1.4, 9); expect(t.acwrStatus).toBe("HIGH");
    expect(t.fitnessAge).toBeCloseTo(31.5, 9); expect(t.ltSpeedMs).toBeCloseTo(3.2, 9);
    expect(t.floorsClimbed).toBe(12); expect(t.restingHr7d).toBe(52);
    const empty = s.training[0];
    expect(empty.readiness).toBeNull(); expect(empty.acwr).toBeNull(); expect(empty.trainingStatus).toBeNull();
  });
});
