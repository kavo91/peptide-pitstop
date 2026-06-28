import { describe, it, expect } from "vitest";
import {
  computeInsights,
  MIN_SAMPLE,
  type InsightInput,
  type InsightWearableRow,
  type InsightJournalEntry,
} from "./insights";

/** Build a local-midnight Date `n` days before `2026-06-01`. */
const BASE = new Date(2026, 5, 1, 0, 0, 0, 0); // 2026-06-01 local
function day(offset: number): Date {
  return new Date(2026, 5, 1 + offset, 0, 0, 0, 0);
}
/** Wearable row helper. */
function wear(offset: number, p: Partial<InsightWearableRow>): InsightWearableRow {
  return {
    date: day(offset),
    sleepSeconds: null,
    restingHr: null,
    bodyBatteryHigh: null,
    ...p,
  };
}
/** Journal entry helper. */
function entry(offset: number, p: Partial<InsightJournalEntry>): InsightJournalEntry {
  return {
    date: day(offset),
    weight: null,
    weightUnit: null,
    calories: null,
    proteinG: null,
    waterMl: null,
    sideEffects: [],
    ...p,
  };
}

const WINDOW = { from: day(-100), to: day(60) };

function baseInput(over: Partial<InsightInput> = {}): InsightInput {
  return {
    doseDates: [],
    wearable: [],
    journal: [],
    window: WINDOW,
    adherencePct: null,
    now: day(50),
    ...over,
  };
}

describe("computeInsights — sleep on dose days vs non-dose days", () => {
  it("computes the right averages + counts (h on dose vs other days)", () => {
    // 6 dose days @ 8h sleep, 6 non-dose days @ 7h sleep.
    const doseOffsets = [0, 1, 2, 3, 4, 5];
    const nonDoseOffsets = [10, 11, 12, 13, 14, 15];
    const wearable: InsightWearableRow[] = [
      ...doseOffsets.map((o) => wear(o, { sleepSeconds: 8 * 3600 })),
      ...nonDoseOffsets.map((o) => wear(o, { sleepSeconds: 7 * 3600 })),
    ];
    const doseDates = doseOffsets.map((o) => day(o));

    const insights = computeInsights(baseInput({ wearable, doseDates }));
    const sleep = insights.find((i) => i.kind === "sleep_dose");
    expect(sleep).toBeDefined();
    expect(sleep!.samples).toEqual({ a: 6, b: 6 });
    expect(sleep!.detail).toContain("8h on dose days");
    expect(sleep!.detail).toContain("7h on other days");
  });

  it("averages mixed values correctly (7.4 dose vs 7.0 other)", () => {
    // dose: 7,7,7,8,8,8 -> mean 7.5; round1 -> 7.5
    const doseSleep = [7, 7, 7, 8, 8, 8];
    const otherSleep = [7, 7, 7, 7, 7, 7];
    const wearable: InsightWearableRow[] = [
      ...doseSleep.map((h, i) => wear(i, { sleepSeconds: h * 3600 })),
      ...otherSleep.map((h, i) => wear(20 + i, { sleepSeconds: h * 3600 })),
    ];
    const doseDates = doseSleep.map((_, i) => day(i));
    const insights = computeInsights(baseInput({ wearable, doseDates }));
    const sleep = insights.find((i) => i.kind === "sleep_dose")!;
    expect(sleep.detail).toContain("7.5h on dose days");
    expect(sleep.detail).toContain("7h on other days");
  });
});

describe("computeInsights — min-sample guard", () => {
  it("SKIPS the sleep insight when one side is below MIN_SAMPLE", () => {
    // Only 4 dose-day sleep rows (< MIN_SAMPLE=5) but plenty of non-dose rows.
    const doseOffsets = [0, 1, 2, 3]; // 4 < 5
    const nonDoseOffsets = [10, 11, 12, 13, 14, 15];
    const wearable: InsightWearableRow[] = [
      ...doseOffsets.map((o) => wear(o, { sleepSeconds: 8 * 3600 })),
      ...nonDoseOffsets.map((o) => wear(o, { sleepSeconds: 7 * 3600 })),
    ];
    const doseDates = doseOffsets.map((o) => day(o));
    const insights = computeInsights(baseInput({ wearable, doseDates }));
    expect(insights.find((i) => i.kind === "sleep_dose")).toBeUndefined();
    expect(MIN_SAMPLE).toBe(5);
  });

  it("SKIPS resting-HR when the metric is absent on rows", () => {
    // dose + non-dose rows present, but no restingHr anywhere.
    const wearable: InsightWearableRow[] = [
      ...[0, 1, 2, 3, 4, 5].map((o) => wear(o, { sleepSeconds: 8 * 3600 })),
      ...[10, 11, 12, 13, 14, 15].map((o) => wear(o, { sleepSeconds: 7 * 3600 })),
    ];
    const doseDates = [0, 1, 2, 3, 4, 5].map((o) => day(o));
    const insights = computeInsights(baseInput({ wearable, doseDates }));
    expect(insights.find((i) => i.kind === "resting_hr_dose")).toBeUndefined();
  });
});

describe("computeInsights — weight trend direction/sign", () => {
  it("reports a DOWN trend with the right unit when weight falls", () => {
    // 6 same-unit (kg) points across the last 30 days, falling 90 -> 87.5.
    const weights = [90, 89.5, 89, 88.5, 88, 87.5];
    const now = day(50);
    const journal: InsightJournalEntry[] = weights.map((w, i) =>
      // dates within the 30-day window ending at `now` (day 50): days 45..50
      entry(45 + i, { weight: w, weightUnit: "kg" }),
    );
    const insights = computeInsights(baseInput({ journal, now }));
    const wt = insights.find((i) => i.kind === "weight_trend")!;
    expect(wt).toBeDefined();
    expect(wt.detail).toContain("30d: down 2.5 kg");
    expect(wt.detail).toContain("(n=6)");
  });

  it("reports an UP trend when weight rises", () => {
    const weights = [80, 80.5, 81, 81.5, 82, 82.5];
    const now = day(50);
    const journal: InsightJournalEntry[] = weights.map((w, i) =>
      entry(45 + i, { weight: w, weightUnit: "lb" }),
    );
    const insights = computeInsights(baseInput({ journal, now }));
    const wt = insights.find((i) => i.kind === "weight_trend")!;
    expect(wt.detail).toContain("30d: up 2.5 lb");
  });

  it("does NOT mix units — only same-unit-as-latest points count", () => {
    const now = day(50);
    // 5 kg points + the latest in lb; only the lone lb point remains -> < MIN_SAMPLE -> skipped.
    const journal: InsightJournalEntry[] = [
      entry(45, { weight: 90, weightUnit: "kg" }),
      entry(46, { weight: 89, weightUnit: "kg" }),
      entry(47, { weight: 88, weightUnit: "kg" }),
      entry(48, { weight: 87, weightUnit: "kg" }),
      entry(49, { weight: 86, weightUnit: "kg" }),
      entry(50, { weight: 189, weightUnit: "lb" }), // latest unit = lb, only 1 lb point
    ];
    const insights = computeInsights(baseInput({ journal, now }));
    expect(insights.find((i) => i.kind === "weight_trend")).toBeUndefined();
  });
});

describe("computeInsights — side-effect frequency ranking", () => {
  it("ranks symptoms by count and surfaces the most common severity", () => {
    const journal: InsightJournalEntry[] = [
      entry(0, { sideEffects: [{ symptom: "Nausea", severity: "moderate" }] }),
      entry(1, { sideEffects: [{ symptom: "Nausea", severity: "moderate" }] }),
      entry(2, { sideEffects: [{ symptom: "Nausea", severity: "mild" }] }),
      entry(3, { sideEffects: [{ symptom: "Headache", severity: "mild" }] }),
      entry(4, { sideEffects: [{ symptom: "Headache", severity: null }] }),
      entry(5, { sideEffects: [{ symptom: "Fatigue", severity: "severe" }] }),
    ];
    const insights = computeInsights(baseInput({ journal }));
    const freq = insights.find((i) => i.kind === "side_effect_frequency")!;
    expect(freq).toBeDefined();
    // Nausea (3) ranked before Headache (2) before Fatigue (1).
    const nIdx = freq.detail.indexOf("Nausea");
    const hIdx = freq.detail.indexOf("Headache");
    const fIdx = freq.detail.indexOf("Fatigue");
    expect(nIdx).toBeGreaterThanOrEqual(0);
    expect(nIdx).toBeLessThan(hIdx);
    expect(hIdx).toBeLessThan(fIdx);
    // Nausea's most-common severity is moderate (2 of 3).
    expect(freq.detail).toContain("Nausea — 3 days (mostly moderate)");
  });

  it("is case-insensitive when counting the same symptom", () => {
    const journal: InsightJournalEntry[] = [
      entry(0, { sideEffects: [{ symptom: "nausea", severity: "mild" }] }),
      entry(1, { sideEffects: [{ symptom: "Nausea", severity: "mild" }] }),
    ];
    const insights = computeInsights(baseInput({ journal }));
    const freq = insights.find((i) => i.kind === "side_effect_frequency")!;
    expect(freq.detail).toContain("2 days");
  });
});

describe("computeInsights — side-effect timing buckets", () => {
  it("buckets side-effect days by hours since the most recent prior dose", () => {
    // Dose on day 0; side-effects on days 0 (0h), 2 (48h), 5 (120h), plus enough
    // to clear MIN_SAMPLE.
    const doseDates = [day(0)];
    const seOffsets = [0, 1, 2, 3, 4]; // hours-since-dose: 0,24,48,72,96
    const journal: InsightJournalEntry[] = seOffsets.map((o) =>
      entry(o, { sideEffects: [{ symptom: "Nausea", severity: "mild" }] }),
    );
    const insights = computeInsights(baseInput({ doseDates, journal }));
    const timing = insights.find((i) => i.kind === "side_effect_timing")!;
    expect(timing).toBeDefined();
    expect(timing.detail).toContain("Of 5 side-effect days");
  });

  it("SKIPS timing when below MIN_SAMPLE timed days", () => {
    const doseDates = [day(0)];
    const journal: InsightJournalEntry[] = [0, 1].map((o) =>
      entry(o, { sideEffects: [{ symptom: "Nausea", severity: "mild" }] }),
    );
    const insights = computeInsights(baseInput({ doseDates, journal }));
    expect(insights.find((i) => i.kind === "side_effect_timing")).toBeUndefined();
  });
});

describe("computeInsights — adherence vs weight pairing", () => {
  it("pairs adherence with the longest weight window, neutrally", () => {
    const weights = [90, 89.5, 89, 88.5, 88, 87.5];
    const now = day(50);
    const journal: InsightJournalEntry[] = weights.map((w, i) =>
      entry(45 + i, { weight: w, weightUnit: "kg" }),
    );
    const insights = computeInsights(baseInput({ journal, now, adherencePct: 92 }));
    const pair = insights.find((i) => i.kind === "adherence_weight")!;
    expect(pair).toBeDefined();
    expect(pair.detail).toContain("Adherence 92%");
    expect(pair.detail.toLowerCase()).toContain("not a cause");
  });

  it("does not appear without both adherence and a weight trend", () => {
    const insights = computeInsights(baseInput({ adherencePct: 92 }));
    expect(insights.find((i) => i.kind === "adherence_weight")).toBeUndefined();
  });
});

describe("computeInsights — empty input", () => {
  it("returns [] when there is no data", () => {
    expect(computeInsights(baseInput())).toEqual([]);
  });
  it("BASE sanity (keeps tsc happy about the unused import)", () => {
    expect(BASE.getFullYear()).toBe(2026);
  });
});
