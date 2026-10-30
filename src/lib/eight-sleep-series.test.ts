import { describe, it, expect } from "vitest";
import { buildEightSleepSeries } from "./eight-sleep-series";

const d = (s: string) => {
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day);
};

describe("buildEightSleepSeries", () => {
  it("sorts by date and maps sleep + bed metrics, coercing Decimal-ish values", () => {
    const s = buildEightSleepSeries([
      { date: d("2026-06-21"), sleepSeconds: 25000, sleepScore: 80, hrvMs: "59.5", bedTempC: { toString: () => "30.3" } },
      {
        date: d("2026-06-20"),
        sleepSeconds: 27600,
        sleepDeepSeconds: 6000,
        sleepLightSeconds: 15000,
        sleepRemSeconds: 6600,
        sleepAwakeSeconds: 3000,
        sleepScore: 84,
        hrvMs: 61.5,
        respirationAvg: "15.3",
        sleepHrAvg: 54,
        tossTurns: 21,
        roomTempC: 21.5,
      },
    ]);
    expect(s.sleep.map((p) => p.date)).toEqual(["2026-06-20", "2026-06-21"]);
    expect(s.sleep[0]).toEqual({
      date: "2026-06-20",
      total: 27600,
      deep: 6000,
      light: 15000,
      rem: 6600,
      awake: 3000,
      score: 84,
    });
    expect(s.nights[0]).toEqual({
      date: "2026-06-20",
      hrvMs: 61.5,
      sleepHrAvg: 54,
      respirationAvg: 15.3,
      tossTurns: 21,
      bedTempC: null,
      roomTempC: 21.5,
    });
    expect(s.nights[1].hrvMs).toBe(59.5);
    expect(s.nights[1].bedTempC).toBe(30.3);
    expect(s.nights[1].sleepHrAvg).toBeNull();
  });

  it("is empty for no rows", () => {
    expect(buildEightSleepSeries([])).toEqual({ sleep: [], nights: [] });
  });
});
