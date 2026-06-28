import { describe, it, expect } from "vitest";
import { decayFraction, assessTiming } from "./halflife";

describe("decayFraction", () => {
  it("returns 1 at t=0", () => {
    expect(decayFraction(0, 24)).toBeCloseTo(1, 10);
  });

  it("decays to 0.5 at exactly one half-life", () => {
    expect(decayFraction(24, 24)).toBeCloseTo(0.5, 10);
  });

  it("decays to 0.25 at two half-lives", () => {
    expect(decayFraction(48, 24)).toBeCloseTo(0.25, 10);
  });

  it("decays to 0.5 with a different half-life", () => {
    expect(decayFraction(12, 12)).toBeCloseTo(0.5, 10);
  });

  it("returns a value between 0 and 1 for any positive inputs", () => {
    const f = decayFraction(7, 36);
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
  });
});

describe("assessTiming", () => {
  it("tooSoon true when hoursSinceLast < minIntervalHours", () => {
    const r = assessTiming({ halfLifeHours: 24, minIntervalHours: 24, hoursSinceLast: 3 });
    expect(r.tooSoon).toBe(true);
  });

  it("tooSoon false when hoursSinceLast >= minIntervalHours", () => {
    const r = assessTiming({ halfLifeHours: 24, minIntervalHours: 24, hoursSinceLast: 24 });
    expect(r.tooSoon).toBe(false);
  });

  it("tooSoon false when minIntervalHours is null", () => {
    const r = assessTiming({ halfLifeHours: 24, minIntervalHours: null, hoursSinceLast: 1 });
    expect(r.tooSoon).toBe(false);
  });

  it("activePct null when halfLifeHours is null", () => {
    const r = assessTiming({ halfLifeHours: null, minIntervalHours: 24, hoursSinceLast: 3 });
    expect(r.activePct).toBeNull();
  });

  it("activePct is ~50 at one half-life elapsed", () => {
    const r = assessTiming({ halfLifeHours: 24, minIntervalHours: 24, hoursSinceLast: 24 });
    expect(r.activePct).not.toBeNull();
    expect(r.activePct!).toBeCloseTo(50, 5);
  });

  it("activePct is ~70.7 at half of one half-life elapsed", () => {
    // At t = halfLife/2: fraction = 0.5^0.5 = sqrt(0.5) ≈ 0.7071
    const r = assessTiming({ halfLifeHours: 24, minIntervalHours: null, hoursSinceLast: 12 });
    expect(r.activePct!).toBeCloseTo(70.71067811865476, 5);
  });

  it("message contains hours and minInterval when tooSoon", () => {
    const r = assessTiming({ halfLifeHours: 24, minIntervalHours: 24, hoursSinceLast: 3 });
    expect(r.message).toContain("3");
    expect(r.message).toContain("24");
  });

  it("message contains activePct when halfLifeHours is set", () => {
    const r = assessTiming({ halfLifeHours: 24, minIntervalHours: null, hoursSinceLast: 24 });
    expect(r.message).toContain("50%");
  });

  it("message is empty string when nothing to warn about", () => {
    const r = assessTiming({ halfLifeHours: null, minIntervalHours: null, hoursSinceLast: 48 });
    expect(r.message).toBe("");
  });
});
