import { describe, it, expect } from "vitest";
import { plasmaCurve, splitSeriesAtNow } from "./plasma";

// Helper: build a Date N hours from epoch zero for deterministic arithmetic.
const T0 = new Date("2026-01-01T00:00:00Z");
function hoursLater(h: number): Date {
  return new Date(T0.getTime() + h * 60 * 60 * 1000);
}

describe("plasmaCurve", () => {
  it("returns empty array when halfLifeHours is null", () => {
    const series = plasmaCurve({
      doses: [{ at: T0, amountMcg: 100 }],
      halfLifeHours: null,
      from: T0,
      to: hoursLater(48),
      stepHours: 6,
    });
    expect(series).toHaveLength(0);
  });

  it("returns empty array when doses array is empty", () => {
    const series = plasmaCurve({
      doses: [],
      halfLifeHours: 24,
      from: T0,
      to: hoursLater(48),
      stepHours: 6,
    });
    // Still generates time points, all with level 0.
    expect(series.every((p) => p.level === 0)).toBe(true);
  });

  it("single dose decays to ~50% at exactly one half-life", () => {
    const halfLife = 24; // hours
    const doseAmount = 200; // mcg
    const series = plasmaCurve({
      doses: [{ at: T0, amountMcg: doseAmount }],
      halfLifeHours: halfLife,
      from: T0,
      to: hoursLater(48),
      stepHours: 6,
    });

    // t=0: full dose
    const t0Point = series.find((p) => p.t.getTime() === T0.getTime());
    expect(t0Point).toBeDefined();
    expect(t0Point!.level).toBeCloseTo(doseAmount, 5);

    // t=halfLife: half remaining
    const tHalf = series.find((p) => p.t.getTime() === hoursLater(halfLife).getTime());
    expect(tHalf).toBeDefined();
    expect(tHalf!.level).toBeCloseTo(doseAmount * 0.5, 5);
  });

  it("two stacked doses superpose: level equals sum of individual decays", () => {
    const halfLife = 12;
    const dose1At = T0;
    const dose2At = hoursLater(6);
    const series = plasmaCurve({
      doses: [
        { at: dose1At, amountMcg: 100 },
        { at: dose2At, amountMcg: 80 },
      ],
      halfLifeHours: halfLife,
      from: T0,
      to: hoursLater(24),
      stepHours: 6,
    });

    // At t=12h: dose1 has decayed 12h (50%), dose2 has decayed 6h (2^(-0.5) ≈ 70.7%)
    const t12 = series.find((p) => p.t.getTime() === hoursLater(12).getTime());
    expect(t12).toBeDefined();
    const expected = 100 * Math.pow(0.5, 12 / halfLife) + 80 * Math.pow(0.5, 6 / halfLife);
    expect(t12!.level).toBeCloseTo(expected, 5);
  });

  it("future doses (projection) contribute to the series when at > series start", () => {
    const halfLife = 24;
    // Dose 12 hours into the future relative to from
    const futureAt = hoursLater(12);
    const series = plasmaCurve({
      doses: [{ at: futureAt, amountMcg: 100 }],
      halfLifeHours: halfLife,
      from: T0,
      to: hoursLater(36),
      stepHours: 6,
    });

    // Before the dose time: level should be 0
    const tBefore = series.find((p) => p.t.getTime() === T0.getTime());
    expect(tBefore!.level).toBeCloseTo(0, 10);

    // At dose time: full dose
    const tAt = series.find((p) => p.t.getTime() === futureAt.getTime());
    expect(tAt!.level).toBeCloseTo(100, 5);

    // One half-life after dose: ~50%
    const tHalf = series.find((p) => p.t.getTime() === hoursLater(12 + halfLife).getTime());
    expect(tHalf!.level).toBeCloseTo(50, 5);
  });

  it("step produces monotonically-increasing, evenly-spaced timestamps", () => {
    const series = plasmaCurve({
      doses: [{ at: T0, amountMcg: 100 }],
      halfLifeHours: 24,
      from: T0,
      to: hoursLater(24),
      stepHours: 6,
    });
    // 0, 6, 12, 18, 24 → 5 points
    expect(series).toHaveLength(5);
    const stepMs = 6 * 60 * 60 * 1000;
    for (let i = 1; i < series.length; i++) {
      expect(series[i].t.getTime() - series[i - 1].t.getTime()).toBe(stepMs);
    }
  });

  it("dose at exactly t=from contributes fully; decays to 50% one half-life later", () => {
    const series = plasmaCurve({
      doses: [{ at: T0, amountMcg: 50 }],
      halfLifeHours: 10,
      from: T0,
      to: hoursLater(10),
      stepHours: 10,
    });
    // Find by TIME, not index — the step is adaptively finer for short half-lives.
    const at0 = series.find((p) => p.t.getTime() === T0.getTime());
    const at10 = series.find((p) => p.t.getTime() === hoursLater(10).getTime());
    expect(at0!.level).toBeCloseTo(50, 5);
    expect(at10!.level).toBeCloseTo(25, 5); // one half-life later
  });

  // Spike-height fidelity: with a short half-life (e.g. Tα1 = 2h) the curve
  // collapses between coarse grid samples, so a dose's rendered peak must NOT
  // depend on how its clock time aligns to the sample grid. Equal doses → equal
  // spikes; a larger dose → a taller spike.
  const peakNear = (series: { t: Date; level: number }[], at: Date) =>
    Math.max(
      ...series
        .filter((p) => Math.abs(p.t.getTime() - at.getTime()) <= 60 * 60 * 1000)
        .map((p) => p.level),
    );

  it("renders EQUAL peaks for equal doses regardless of clock-time alignment (short half-life)", () => {
    const doses = [
      { at: new Date("2026-06-14T13:18:00"), amountMcg: 1500 }, // ~4.7h before next 6h grid point
      { at: new Date("2026-06-16T17:36:00"), amountMcg: 1500 }, // ~0.4h before next grid point
    ];
    const series = plasmaCurve({
      doses,
      halfLifeHours: 2,
      from: new Date("2026-06-14T00:00:00"),
      to: new Date("2026-06-19T00:00:00"),
      stepHours: 6,
    });
    expect(peakNear(series, doses[0].at)).toBeCloseTo(1500, 0);
    expect(peakNear(series, doses[1].at)).toBeCloseTo(1500, 0);
  });

  it("renders a proportionally TALLER spike for a larger dose", () => {
    const doses = [
      { at: new Date("2026-06-14T13:18:00"), amountMcg: 1500 },
      { at: new Date("2026-06-16T13:18:00"), amountMcg: 3000 },
    ];
    const series = plasmaCurve({
      doses,
      halfLifeHours: 2,
      from: new Date("2026-06-14T00:00:00"),
      to: new Date("2026-06-18T00:00:00"),
      stepHours: 6,
    });
    expect(peakNear(series, doses[1].at)).toBeCloseTo(2 * peakNear(series, doses[0].at), 0);
  });

  it("samples dose-anchored (bounded point count) yet still captures every peak", () => {
    // 2h half-life, only 3 doses over a 30-day window. A uniform halfLife/4 grid
    // would be ~30*24/0.5 ≈ 1440 points; dose-anchored sampling stays far smaller
    // by only refining around the (sparse) doses.
    const from = new Date("2026-05-22T00:00:00");
    const to = new Date("2026-06-21T00:00:00");
    const doses = [0, 14, 28].map((d) => ({
      at: new Date(from.getTime() + d * 24 * 60 * 60 * 1000 + 13.3 * 60 * 60 * 1000),
      amountMcg: 1500,
    }));
    const series = plasmaCurve({ doses, halfLifeHours: 2, from, to, stepHours: 6 });
    expect(series.length).toBeLessThan(500); // windowed, not ~1440 uniform-fine
    for (const dz of doses) {
      expect(peakNear(series, dz.at)).toBeCloseTo(1500, 0); // peak still full height
    }
    // timestamps strictly increasing
    for (let i = 1; i < series.length; i++) {
      expect(series[i].t.getTime()).toBeGreaterThan(series[i - 1].t.getTime());
    }
  });
});

describe("splitSeriesAtNow", () => {
  const pts = [0, 6, 12, 18, 24].map((h) => ({ t: hoursLater(h), level: 100 - h }));
  it("splits into historical (<= now) and forecast (>= now), sharing the boundary point so the lines join", () => {
    const now = hoursLater(12);
    const { historical, forecast } = splitSeriesAtNow(pts, now);
    expect(historical.at(-1)!.t.getTime()).toBe(now.getTime()); // ends at now
    expect(forecast[0]!.t.getTime()).toBe(now.getTime());        // starts at now (shared boundary)
    expect(historical.map((p) => p.t.getTime())).toEqual([0, 6, 12].map((h) => hoursLater(h).getTime()));
    expect(forecast.map((p) => p.t.getTime())).toEqual([12, 18, 24].map((h) => hoursLater(h).getTime()));
  });
  it("all-past series → empty forecast", () => {
    expect(splitSeriesAtNow(pts, hoursLater(48)).forecast).toEqual([]);
  });
  it("no exact now sample → boundary is the first point after now (lines still meet visually)", () => {
    const { historical, forecast } = splitSeriesAtNow(pts, hoursLater(9));
    expect(historical.at(-1)!.t.getTime()).toBe(hoursLater(6).getTime());
    expect(forecast[0]!.t.getTime()).toBe(hoursLater(12).getTime());
  });
});
