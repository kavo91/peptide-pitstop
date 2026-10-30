import { describe, it, expect } from "vitest";
import { pairSleepNights, sleepCoverage } from "./sleep-pairs";
import type { RecoveryPoint, SleepPoint } from "./wearable-series";
import type { EightSleepNight } from "./eight-sleep-series";

const sp = (date: string, o: Partial<SleepPoint> = {}): SleepPoint => ({
  date, total: null, deep: null, light: null, rem: null, awake: null, score: null, ...o,
});
const rp = (date: string, hrvMs: number | null): RecoveryPoint => ({
  date, restingHr: null, hrvMs, bodyBatteryHigh: null, bodyBatteryLow: null, stressAvg: null,
});
const en = (date: string, o: Partial<EightSleepNight> = {}): EightSleepNight => ({
  date, hrvMs: null, sleepHrAvg: null, respirationAvg: null, tossTurns: null, bedTempC: null, roomTempC: null, ...o,
});
const none = { sleep: [], nights: [] };

describe("pairSleepNights", () => {
  it("Garmin only: every recorded night gets a garmin side and no Eight Sleep side", () => {
    const pairs = pairSleepNights(
      { sleep: [sp("2026-06-20", { total: 25000, score: 80 }), sp("2026-06-21", { deep: 3600 })], recovery: [rp("2026-06-20", 60)] },
      none,
    );
    expect(pairs.map((p) => p.date)).toEqual(["2026-06-20", "2026-06-21"]);
    expect(pairs.every((p) => p.eightSleep === null)).toBe(true);
    expect(pairs[0].garmin).toMatchObject({ asleep: 25000, score: 80, hrvMs: 60 });
    expect(pairs[1].garmin).toMatchObject({ asleep: 3600, hrvMs: null }); // stage sum when no stored total
    expect(sleepCoverage(pairs)).toEqual({ garmin: true, eightSleep: false });
  });

  it("Eight Sleep only: every night gets an eightSleep side with its bed extras", () => {
    const pairs = pairSleepNights(
      { sleep: [], recovery: [] },
      { sleep: [sp("2026-06-20", { total: 27000, score: 84 })], nights: [en("2026-06-20", { hrvMs: 55, tossTurns: 20, sleepHrAvg: 54 })] },
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].garmin).toBeNull();
    expect(pairs[0].eightSleep).toMatchObject({ asleep: 27000, score: 84, hrvMs: 55, tossTurns: 20, sleepHrAvg: 54, bedTempC: null });
    expect(sleepCoverage(pairs)).toEqual({ garmin: false, eightSleep: true });
  });

  it("both on the same night: each side keeps only its own device's numbers", () => {
    const pairs = pairSleepNights(
      { sleep: [sp("2026-06-20", { total: 25000, score: 80 })], recovery: [rp("2026-06-20", 60)] },
      { sleep: [sp("2026-06-20", { total: 27000, score: 84 })], nights: [en("2026-06-20", { hrvMs: 45 })] },
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].garmin).toMatchObject({ device: "garmin", asleep: 25000, score: 80, hrvMs: 60 });
    expect(pairs[0].eightSleep).toMatchObject({ device: "eight_sleep", asleep: 27000, score: 84, hrvMs: 45 });
  });

  it("mixed nights: dates merge and sort; empty watch days are not nights", () => {
    const pairs = pairSleepNights(
      {
        sleep: [sp("2026-06-22", { total: 25000 }), sp("2026-06-20", { score: 70 }), sp("2026-06-21")],
        recovery: [rp("2026-06-21", 50)],
      },
      { sleep: [sp("2026-06-21", { total: 26000 }), sp("2026-06-22", { total: 27000 })], nights: [] },
    );
    expect(pairs.map((p) => [p.date, !!p.garmin, !!p.eightSleep])).toEqual([
      ["2026-06-20", true, false],
      ["2026-06-21", false, true], // the empty watch day (HRV only) is not a sleep night
      ["2026-06-22", true, true],
    ]);
  });

  it("keeps the watch source tag (HealthKit gap-fill stays attributed)", () => {
    const pairs = pairSleepNights({ sleep: [sp("2026-06-20", { total: 1, source: "healthkit" })], recovery: [] }, none);
    expect(pairs[0].garmin?.source).toBe("healthkit");
  });

  it("no data → no pairs", () => {
    expect(pairSleepNights({ sleep: [], recovery: [] }, none)).toEqual([]);
  });
});
