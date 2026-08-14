import { describe, it, expect } from "vitest";
import { cycleState, cyclePlanEnd } from "./state";

const d = (iso: string) => new Date(`${iso}T00:00:00`);
/** The anchor used by most cases: a Sunday, so week boundaries are easy to read. */
const ANCHOR = d("2026-07-05");

describe("cycleState — no plan", () => {
  it("returns null when no on-cycle length is set", () => {
    expect(cycleState({ anchor: ANCHOR, onWeeks: null, offWeeks: 4, today: d("2026-07-10") })).toBeNull();
  });

  it("returns null when there is no anchor to count from", () => {
    expect(cycleState({ anchor: null, onWeeks: 8, offWeeks: null, today: d("2026-07-10") })).toBeNull();
  });

  it("returns null for a non-positive on-cycle", () => {
    expect(cycleState({ anchor: ANCHOR, onWeeks: 0, offWeeks: null, today: d("2026-07-10") })).toBeNull();
  });

  it("returns null before the cycle has started", () => {
    expect(cycleState({ anchor: d("2026-08-01"), onWeeks: 8, offWeeks: null, today: d("2026-07-10") })).toBeNull();
  });
});

describe("cycleState — the ON phase", () => {
  const on = (today: string, offWeeks: number | null = null) =>
    cycleState({ anchor: ANCHOR, onWeeks: 8, offWeeks, today: d(today) })!;

  it("counts the anchor day as day 1", () => {
    const s = on("2026-07-05");
    expect(s.phase).toBe("on");
    expect(s.dayOfPhase).toBe(1);
    expect(s.phaseDays).toBe(56);
    expect(s.daysRemaining).toBe(56);
    expect(s.cycleNumber).toBe(1);
  });

  it("puts the last dosing day at daysRemaining 1", () => {
    // 8 weeks from Sun 5 Jul = 56 days → last day Sat 29 Aug.
    const s = on("2026-08-29");
    expect(s.phase).toBe("on");
    expect(s.dayOfPhase).toBe(56);
    expect(s.daysRemaining).toBe(1);
    expect(s.onCycleEndsOn).toEqual(d("2026-08-29"));
  });

  it("reports the correct remaining count mid-cycle", () => {
    // 14 Aug is day 41 of 56.
    const s = on("2026-08-14");
    expect(s.dayOfPhase).toBe(41);
    expect(s.daysRemaining).toBe(16);
    expect(s.progress).toBeCloseTo(41 / 56, 5);
  });

  it("points nextPhaseStartsOn at the first non-dosing day", () => {
    expect(on("2026-08-14").nextPhaseStartsOn).toEqual(d("2026-08-30"));
  });
});

describe("cycleState — stopping for good (no break length)", () => {
  it("switches to 'ended' the day after the last dose", () => {
    const s = cycleState({ anchor: ANCHOR, onWeeks: 8, offWeeks: null, today: d("2026-08-30") })!;
    expect(s.phase).toBe("ended");
    expect(s.daysRemaining).toBe(0);
    expect(s.nextPhaseStartsOn).toBeNull();
    expect(s.onCycleEndsOn).toEqual(d("2026-08-29"));
    expect(s.dayOfPhase).toBe(1); // first day off
  });

  it("keeps counting days since the stop", () => {
    // Last dose 29 Aug → 30 Aug is day 1 off, so 5 Sep is day 7.
    const s = cycleState({ anchor: ANCHOR, onWeeks: 8, offWeeks: null, today: d("2026-09-05") })!;
    expect(s.phase).toBe("ended");
    expect(s.dayOfPhase).toBe(7);
    expect(s.progress).toBe(1);
  });

  it("treats a non-positive break length as no break", () => {
    const s = cycleState({ anchor: ANCHOR, onWeeks: 8, offWeeks: 0, today: d("2026-08-30") })!;
    expect(s.phase).toBe("ended");
  });
});

describe("cycleState — the OFF phase and restart", () => {
  const s = (today: string) => cycleState({ anchor: ANCHOR, onWeeks: 8, offWeeks: 4, today: d(today) })!;

  it("enters the break the day after the last dose", () => {
    const r = s("2026-08-30");
    expect(r.phase).toBe("off");
    expect(r.dayOfPhase).toBe(1);
    expect(r.phaseDays).toBe(28);
    expect(r.daysRemaining).toBe(28);
    expect(r.cycleNumber).toBe(1);
  });

  it("puts the last off day at daysRemaining 1 and names the restart date", () => {
    // Break runs 30 Aug – 26 Sep (28 days); restart Sun 27 Sep.
    const r = s("2026-09-26");
    expect(r.phase).toBe("off");
    expect(r.daysRemaining).toBe(1);
    expect(r.nextPhaseStartsOn).toEqual(d("2026-09-27"));
  });

  it("starts cycle 2 on the restart date", () => {
    const r = s("2026-09-27");
    expect(r.phase).toBe("on");
    expect(r.dayOfPhase).toBe(1);
    expect(r.cycleNumber).toBe(2);
    expect(r.onCycleEndsOn).toEqual(d("2026-11-21")); // 56 days from 27 Sep
  });

  it("keeps repeating cleanly into later cycles", () => {
    const r = s("2027-01-17"); // deep into cycle 3
    expect(r.cycleNumber).toBe(3);
    expect(["on", "off"]).toContain(r.phase);
  });

  it("never reports a phase day outside its phase length", () => {
    for (let i = 0; i < 400; i++) {
      const day = new Date(ANCHOR);
      day.setDate(day.getDate() + i);
      const r = cycleState({ anchor: ANCHOR, onWeeks: 8, offWeeks: 4, today: day })!;
      expect(r.dayOfPhase).toBeGreaterThanOrEqual(1);
      expect(r.dayOfPhase).toBeLessThanOrEqual(r.phaseDays);
      expect(r.daysRemaining).toBe(r.phaseDays - r.dayOfPhase + 1);
    }
  });
});

describe("cycleState — time-of-day independence", () => {
  it("ignores the clock time on both anchor and today", () => {
    const a = cycleState({
      anchor: new Date("2026-07-05T23:30:00"),
      onWeeks: 8,
      offWeeks: null,
      today: new Date("2026-08-14T00:05:00"),
    })!;
    const b = cycleState({
      anchor: new Date("2026-07-05T06:00:00"),
      onWeeks: 8,
      offWeeks: null,
      today: new Date("2026-08-14T22:45:00"),
    })!;
    expect(a.dayOfPhase).toBe(b.dayOfPhase);
    expect(a.dayOfPhase).toBe(41);
  });
});

describe("cyclePlanEnd — the planned stop date for a fresh plan", () => {
  it("is the last dosing day, not the day after", () => {
    expect(cyclePlanEnd(ANCHOR, 8)).toEqual(d("2026-08-29"));
  });

  it("handles a one-week cycle", () => {
    expect(cyclePlanEnd(ANCHOR, 1)).toEqual(d("2026-07-11"));
  });

  it("returns null without a usable anchor or length", () => {
    expect(cyclePlanEnd(null, 8)).toBeNull();
    expect(cyclePlanEnd(ANCHOR, null)).toBeNull();
    expect(cyclePlanEnd(ANCHOR, 0)).toBeNull();
  });
});
