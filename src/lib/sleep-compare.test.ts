import { describe, it, expect } from "vitest";
import { compareSleep, formatDuration, formatSignedDiff, PATTERN_MIN_N } from "./sleep-compare";
import type { SleepPair, GarminNight, EightSleepNightFull } from "./sleep-pairs";

const g = (o: Partial<GarminNight> = {}): GarminNight => ({
  device: "garmin", asleep: null, deep: null, light: null, rem: null, awake: null, score: null, hrvMs: null, ...o,
});
const e = (o: Partial<EightSleepNightFull> = {}): EightSleepNightFull => ({
  device: "eight_sleep", asleep: null, deep: null, light: null, rem: null, awake: null, score: null, hrvMs: null,
  tossTurns: null, sleepHrAvg: null, respirationAvg: null, bedTempC: null, roomTempC: null, ...o,
});
const day = (i: number) => `2026-06-${String(i + 1).padStart(2, "0")}`;

// No advice, no judgement, no causal claim beyond the "Pattern, not cause" label.
const NOT_NEUTRAL = /\b(should|recommend\w*|improv\w*|better|worse|good|bad|because|causes?|caused|leads? to|due to|try)\b/i;

describe("compareSleep — coverage and differences", () => {
  it("counts nights per device and averages only nights both recorded", () => {
    const pairs: SleepPair[] = [
      { date: day(0), garmin: g({ asleep: 25200, deep: 3600, score: 80 }), eightSleep: e({ asleep: 27000, deep: 4200, score: 84 }) },
      { date: day(1), garmin: g({ asleep: 21600, deep: 3000, score: 70 }), eightSleep: e({ asleep: 22800, deep: 3000, score: 72 }) },
      { date: day(2), garmin: g({ asleep: 1, score: 1 }), eightSleep: null }, // Garmin only — excluded
      { date: day(3), garmin: null, eightSleep: e({ asleep: 1, score: 1 }) }, // Eight Sleep only — excluded
    ];
    const c = compareSleep(pairs);
    expect(c.coverage).toEqual({ both: 2, garminOnly: 1, eightSleepOnly: 1 });
    const asleep = c.differences.find((d) => d.key === "asleep")!;
    expect(asleep).toMatchObject({ n: 2, garminAvg: 23400, eightSleepAvg: 24900, diff: 1500 });
    expect(formatSignedDiff(asleep)).toBe("+25 m");
    const score = c.differences.find((d) => d.key === "score")!;
    expect(score).toMatchObject({ n: 2, garminAvg: 75, eightSleepAvg: 78, diff: 3 });
    const rem = c.differences.find((d) => d.key === "rem")!;
    expect(rem).toMatchObject({ n: 0, garminAvg: null, eightSleepAvg: null, diff: null });
    expect(formatSignedDiff(rem)).toBe("—");
  });

  it("Awake is side by side only: different definitions, no difference", () => {
    const c = compareSleep([{ date: day(0), garmin: g({ awake: 600 }), eightSleep: e({ awake: 3000 }) }]);
    const awake = c.differences.find((d) => d.key === "awake")!;
    expect(awake).toMatchObject({ n: 1, garminAvg: 600, eightSleepAvg: 3000, diff: null, comparable: false });
  });

  it("an Apple-Health-only watch night is not a Garmin night in the comparison", () => {
    const c = compareSleep([
      { date: day(0), garmin: g({ asleep: 25000, source: "healthkit" }), eightSleep: e({ asleep: 26000 }) },
      { date: day(1), garmin: g({ asleep: 25000, source: "mixed" }), eightSleep: e({ asleep: 26000 }) },
    ]);
    expect(c.coverage).toEqual({ both: 1, garminOnly: 0, eightSleepOnly: 1 });
  });

  it("HRV is side by side only: two averages over shared nights, no difference field", () => {
    const c = compareSleep([
      { date: day(0), garmin: g({ hrvMs: 60 }), eightSleep: e({ hrvMs: 40 }) },
      { date: day(1), garmin: g({ hrvMs: 50 }), eightSleep: e({ hrvMs: null }) },
    ]);
    expect(c.hrv).toEqual({ n: 1, garminAvg: 60, eightSleepAvg: 40 });
    expect("diff" in c.hrv).toBe(false);
  });

  it("works with one device only (nothing to compare, no crash)", () => {
    const garminOnly = compareSleep([{ date: day(0), garmin: g({ asleep: 25000 }), eightSleep: null }]);
    expect(garminOnly.coverage).toEqual({ both: 0, garminOnly: 1, eightSleepOnly: 0 });
    expect(garminOnly.differences.every((d) => d.n === 0)).toBe(true);
    expect(garminOnly.patterns).toEqual([]);
    const eightOnly = compareSleep([{ date: day(0), garmin: null, eightSleep: e({ asleep: 25000, tossTurns: 10 }) }]);
    expect(eightOnly.coverage).toEqual({ both: 0, garminOnly: 0, eightSleepOnly: 1 });
    expect(eightOnly.patterns).toEqual([]);
    expect(compareSleep([]).coverage).toEqual({ both: 0, garminOnly: 0, eightSleepOnly: 0 });
  });

  it("formats durations and never prints a minus zero", () => {
    expect(formatDuration(25500)).toBe("7 h 05 m");
    expect(formatDuration(2880)).toBe("48 m");
    expect(formatSignedDiff({ key: "score", label: "", unit: "score", n: 1, garminAvg: 80, eightSleepAvg: 79.7, diff: -0.3, comparable: true })).toBe("±0");
    expect(formatSignedDiff({ key: "deep", label: "", unit: "duration", n: 1, garminAvg: 1, eightSleepAvg: 1, diff: -600, comparable: true })).toBe("−10 m");
    const d = (unit: "score" | "duration", diff: number) =>
      formatSignedDiff({ key: "score", label: "", unit, n: 2, garminAvg: 0, eightSleepAvg: 0, diff, comparable: true });
    expect(d("score", -0.5)).toBe("−1");
    expect(d("score", 0.5)).toBe("+1");
    expect(d("duration", -30)).toBe("−1 m");
    expect(d("duration", -29)).toBe("±0 m");
    expect(d("duration", 5430)).toBe("+1 h 31 m");
  });
});

describe("compareSleep — patterns (n ≥ 5 per group, neutral)", () => {
  /** n shared nights; toss & turns 10..; the fixture gives higher-count nights less Garmin deep sleep. */
  const nights = (n: number, o: (i: number) => Partial<EightSleepNightFull> = () => ({})): SleepPair[] =>
    Array.from({ length: n }, (_, i) => ({
      date: day(i),
      garmin: g({ deep: i < n / 2 ? 5400 : 3600, score: 70 + i }),
      eightSleep: e({ tossTurns: 10 + i, sleepHrAvg: 50 + i, score: 60 + i, ...o(i) }),
    }));

  it(`below ${PATTERN_MIN_N} nights in a group: no pattern, a waiting entry with the count`, () => {
    const c = compareSleep(nights(9)); // median split 5 / 4
    expect(c.patterns).toEqual([]);
    const tnt = c.waiting.find((w) => w.id === "tnt-garmin-deep")!;
    expect(tnt).toEqual({
      id: "tnt-garmin-deep",
      label: "Eight Sleep toss & turns vs Garmin deep sleep",
      have: 4,
      need: 5,
      reason: "few-nights",
    });
  });

  it("at 5 + 5 nights the pattern shows, with both n printed and the averages per group", () => {
    const c = compareSleep(nights(10));
    const tnt = c.patterns.find((p) => p.id === "tnt-garmin-deep")!;
    expect(tnt).toMatchObject({ nLow: 5, nHigh: 5 });
    expect(tnt.text).toBe(
      "Pattern, not cause: on nights with more toss & turns on Eight Sleep (n=5), Garmin deep sleep averaged 1 h 00 m; " +
        "on nights with fewer toss & turns (n=5) it averaged 1 h 30 m (a gap of 30 m).",
    );
    expect(c.patterns.map((p) => p.id).sort()).toEqual(["bedhr-garmin-score", "garmin-score-eight-score", "tnt-garmin-deep"]);
  });

  it("a field the device never reports (bed temperature on some Pods) gives no pattern and no waiting entry", () => {
    const c = compareSleep(nights(10));
    expect(c.patterns.find((p) => p.id === "bedtemp-garmin-deep")).toBeUndefined();
    expect(c.waiting.find((w) => w.id === "bedtemp-garmin-deep")).toBeUndefined();
    const withTemp = compareSleep(nights(10, (i) => ({ bedTempC: 25 + i })));
    expect(withTemp.patterns.find((p) => p.id === "bedtemp-garmin-deep")).toBeDefined();
  });

  it("a night with the split value but no measure is left out of both groups", () => {
    const base = nights(10);
    const withHole: SleepPair[] = [...base, { date: day(20), garmin: g({ deep: null }), eightSleep: e({ tossTurns: 99 }) }];
    const tnt = compareSleep(withHole).patterns.find((p) => p.id === "tnt-garmin-deep")!;
    expect(tnt.nLow + tnt.nHigh).toBe(10);
  });

  it("one value on every night is 'no spread', not 'not enough nights'", () => {
    const c = compareSleep(nights(12, () => ({ tossTurns: 20 })));
    expect(c.waiting.find((w) => w.id === "tnt-garmin-deep")).toMatchObject({ have: 0, reason: "no-spread" });
    expect(compareSleep(nights(4, () => ({ tossTurns: 20 }))).waiting.find((w) => w.id === "tnt-garmin-deep")?.reason).toBe(
      "few-nights",
    );
  });

  it("ties at the median go to the low group, so uneven groups still need 5 each", () => {
    const c = compareSleep(nights(12, (i) => ({ tossTurns: i < 8 ? 10 : 20 })));
    const tnt = c.waiting.find((w) => w.id === "tnt-garmin-deep")!;
    expect(tnt.have).toBe(4); // 8 low (tied), 4 high
  });

  it("every pattern is worded neutrally and starts with the label", () => {
    const c = compareSleep(nights(14, (i) => ({ bedTempC: 25 + i })));
    expect(c.patterns.length).toBe(4);
    for (const p of c.patterns) {
      expect(p.text.startsWith("Pattern, not cause: ")).toBe(true);
      expect(p.text.slice("Pattern, not cause: ".length)).not.toMatch(NOT_NEUTRAL);
      expect(p.text).toMatch(/\(n=\d+\).*\(n=\d+\)/);
    }
  });
});
