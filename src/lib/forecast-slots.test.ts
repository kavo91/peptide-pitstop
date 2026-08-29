/**
 * The shared slot/stop derivation. This was previously inlined in reorder.ts and
 * untested; it is now the single source both the reorder tile and the per-vial
 * inventory figure walk, so a regression here silently moves two numbers.
 */
import { describe, it, expect } from "vitest";
import { buildForecastPlan, conv1ToLocalDay, type ProtocolForForecast } from "./forecast-slots";

const daily = JSON.stringify([{ dayPattern: { kind: "daily" }, times: ["09:00"] }]);
const NOW = new Date(2026, 7, 15, 12, 0); // Sat 15 Aug 2026, midday
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
/** Convention-1: UTC midnight of a calendar day. */
const utc = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

function proto(over: Partial<ProtocolForForecast> = {}): ProtocolForForecast {
  return {
    doseBasis: "per_injection",
    targetDose: "1000",
    doseInputUnit: "mcg",
    scheduleRule: daily,
    rebaseMode: "fixed_anchor",
    startDate: d(2026, 8, 1),
    endDate: null,
    adherenceWindowMin: 120,
    steps: [],
    cycleAnchor: null,
    cycleOnWeeks: null,
    cycleOffWeeks: null,
    ...over,
  };
}

const plan = (over: Partial<ProtocolForForecast> = {}) =>
  buildForecastPlan({ protocol: proto(over), deliveredLogs: [], now: NOW });

describe("buildForecastPlan", () => {
  it("emits future slots and no past ones", () => {
    const p = plan();
    expect(p.slots.length).toBeGreaterThan(300);
    expect(p.slots.every((s) => s.date >= new Date(2026, 7, 15))).toBe(true);
  });

  it("reports horizon when the course has no end", () => {
    expect(plan().stopReason).toBe("horizon");
    expect(plan().courseEndDate).toBeNull();
  });

  it("reports course_end for a plain end date", () => {
    const p = plan({ endDate: utc(2026, 8, 20) });
    expect(p.stopReason).toBe("course_end");
    expect(p.courseEndDate).toEqual(d(2026, 8, 20));
    expect(p.slots[p.slots.length - 1].date).toEqual(d(2026, 8, 20));
  });

  // R30: a repeating course's endDate is the CURRENT cycle's stop, not the
  // course's — so the walk no longer stops there. The next on-cycles are
  // projected as provisional demand and the basis reflects the walk's true
  // extent (horizon), never a cycle end it walked straight past.
  it("no longer stops at a plan-derived end on a repeating course", () => {
    const p = plan({
      startDate: d(2026, 8, 1),
      cycleAnchor: d(2026, 8, 1),
      cycleOnWeeks: 4,
      cycleOffWeeks: 4,
      endDate: utc(2026, 8, 28), // 1 Aug + 28 days - 1 = 28 Aug
    });
    expect(p.stopReason).toBe("horizon");
    expect(p.projectionStartsOn).toEqual(d(2026, 9, 26));
  });

  // "ended" only becomes true AFTER the stop passes, so gating on it would walk
  // a still-running terminal course for a phantom year.
  it("stops a terminal course still running toward its planned end", () => {
    const p = plan({ cycleAnchor: d(2026, 8, 1), cycleOnWeeks: 4, cycleOffWeeks: null });
    const last = p.slots[p.slots.length - 1].date;
    expect(last).toEqual(d(2026, 8, 28)); // 1 Aug + 4 weeks - 1 day
    expect(p.stopReason).toBe("course_end");
  });

  it("does not gate a repeating course on its cycle", () => {
    const p = plan({ cycleAnchor: d(2026, 8, 1), cycleOnWeeks: 4, cycleOffWeeks: 4 });
    expect(p.slots.length).toBeGreaterThan(300); // walks past the on-cycle end
  });

  // R30 — a repeating course whose endDate carries the current cycle's stop
  // used to go blind past the break: the walk stopped at the endDate, the tile
  // stayed green all break, and the reorder flip came only when the user
  // clicked restart — after the shipping window had closed.
  describe("next-cycle projection (R30)", () => {
    // anchor 1 Aug, 4 on / 4 off: on 1–28 Aug, off 29 Aug – 25 Sep,
    // cycle 2 on 26 Sep – 23 Oct, off 24 Oct – 20 Nov, cycle 3 from 21 Nov.
    const repeating: Partial<ProtocolForForecast> = {
      startDate: d(2026, 8, 1),
      cycleAnchor: d(2026, 8, 1),
      cycleOnWeeks: 4,
      cycleOffWeeks: 4,
      endDate: utc(2026, 8, 28), // = cyclePlanEnd → endsOnPlan
    };

    it("projects future on-cycles and skips the breaks", () => {
      const p = plan(repeating);
      // committed cycle still walked to its stop
      expect(p.slots.some((s) => s.date.getTime() === d(2026, 8, 28).getTime())).toBe(true);
      // the break emits nothing — these slots will never exist unless the user
      // doses off-plan, and costing them would misstate demand
      expect(p.slots.filter((s) => s.date > d(2026, 8, 28) && s.date < d(2026, 9, 26))).toHaveLength(0);
      // cycle 2 resumes on the plan's restart day
      expect(p.slots.some((s) => s.date.getTime() === d(2026, 9, 26).getTime())).toBe(true);
      // the SECOND break is skipped too — the pattern repeats to the horizon
      expect(p.slots.filter((s) => s.date > d(2026, 10, 23) && s.date < d(2026, 11, 21))).toHaveLength(0);
      expect(p.slots.some((s) => s.date.getTime() === d(2026, 11, 21).getTime())).toBe(true);
    });

    it("reports the first projected day", () => {
      expect(plan(repeating).projectionStartsOn).toEqual(d(2026, 9, 26));
    });

    it("projects the restart even when today is already inside the break", () => {
      // anchor 1 Jul: on 1–28 Jul, off 29 Jul – 25 Aug (today = 15 Aug), cycle 2 from 26 Aug.
      const p = plan({
        startDate: d(2026, 7, 1),
        cycleAnchor: d(2026, 7, 1),
        cycleOnWeeks: 4,
        cycleOffWeeks: 4,
        endDate: utc(2026, 7, 28),
      });
      expect(p.slots.length).toBeGreaterThan(0);
      expect(p.slots[0].date).toEqual(d(2026, 8, 26));
      expect(p.projectionStartsOn).toEqual(d(2026, 8, 26));
      expect(p.phaseToday).toBe("off");
    });

    it("does not project when the endDate is not the plan's stop", () => {
      // The user chose to finish early — that is a course end, not a cycle stop.
      const p = plan({ ...repeating, endDate: utc(2026, 8, 20) });
      expect(p.stopReason).toBe("course_end");
      expect(p.projectionStartsOn).toBeNull();
      expect(p.slots.every((s) => s.date <= d(2026, 8, 20))).toBe(true);
    });

    it("does not project a terminal course", () => {
      const p = plan({ cycleAnchor: d(2026, 8, 1), cycleOnWeeks: 4, cycleOffWeeks: null });
      expect(p.projectionStartsOn).toBeNull();
    });

    it("leaves an endDate-less repeating course alone (R23)", () => {
      // Without a committed stop the app still shows break doses as due, so
      // they still cost stock — projection applies only past a committed end.
      const p = plan({ cycleAnchor: d(2026, 8, 1), cycleOnWeeks: 1, cycleOffWeeks: 1 });
      const inBreak = p.slots.filter((s) => s.date >= d(2026, 8, 22) && s.date <= d(2026, 8, 28));
      expect(inBreak.length).toBe(7);
      expect(p.projectionStartsOn).toBeNull();
    });
  });

  // R23: off-weeks are not discounted, so a slot inside the planned break is
  // still emitted and still costs stock.
  it("keeps slots that fall inside a planned off week", () => {
    // anchor 1 Aug, 1 on / 1 off => on 1-7, off 8-14, on 15-21, off 22-28.
    // The first break in the FUTURE (today is 15 Aug) is 22-28 Aug.
    const p = plan({ cycleAnchor: d(2026, 8, 1), cycleOnWeeks: 1, cycleOffWeeks: 1 });
    const inBreak = p.slots.filter((s) => s.date >= d(2026, 8, 22) && s.date <= d(2026, 8, 28));
    expect(inBreak.length).toBe(7); // daily schedule, every break day still costs
  });

  it("never claims a course end beyond the simulated horizon", () => {
    const p = plan({ endDate: utc(2029, 1, 31) });
    expect(p.stopReason).toBe("horizon");
    expect(p.courseEndDate).toBeNull();
  });

  it("marks an unparseable schedule as not evaluable", () => {
    expect(plan({ scheduleRule: null }).scheduleEvaluable).toBe(false);
    expect(plan({ scheduleRule: "[]" }).scheduleEvaluable).toBe(false);
    expect(plan().scheduleEvaluable).toBe(true);
  });

  it("reports today's cycle phase as metadata", () => {
    expect(plan().phaseToday).toBeNull();
    expect(plan({ cycleAnchor: d(2026, 8, 1), cycleOnWeeks: 4, cycleOffWeeks: 4 }).phaseToday).toBe("on");
    expect(plan({ cycleAnchor: d(2026, 8, 1), cycleOnWeeks: 1, cycleOffWeeks: 4 }).phaseToday).toBe("off");
  });
});

describe("conv1ToLocalDay", () => {
  // A UTC-midnight column read with local getters lands on the previous day west
  // of UTC, firing every expiry a day early.
  it("reads a UTC-midnight date as its own calendar day", () => {
    expect(conv1ToLocalDay(utc(2026, 9, 8))).toEqual(d(2026, 9, 8));
    expect(conv1ToLocalDay(null)).toBeNull();
  });
});
