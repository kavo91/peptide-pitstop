import { describe, it, expect } from "vitest";
import { entryDueOn, slotsOn, slotsInRange, legacyToEntry, parseSchedule, scheduleSummary, weeklyDays, cyclePosition } from "./entries";
import type { ScheduleEntry } from "./entries";

const d = (s: string) => new Date(s + "T09:00:00");

describe("entryDueOn", () => {
  it("daily is always due", () => {
    const e: ScheduleEntry = { dayPattern: { kind: "daily" }, times: [] };
    expect(entryDueOn(e, d("2026-06-16"))).toBe(true);
  });
  it("weekly matches listed weekdays only", () => {
    const e: ScheduleEntry = { dayPattern: { kind: "weekly", byDays: ["MO", "WE", "FR"] }, times: [] };
    expect(entryDueOn(e, d("2026-06-15"))).toBe(true);  // Mon
    expect(entryDueOn(e, d("2026-06-16"))).toBe(false); // Tue
    expect(entryDueOn(e, d("2026-06-17"))).toBe(true);  // Wed
  });
  it("weekly with empty byDays is never due", () => {
    const e: ScheduleEntry = { dayPattern: { kind: "weekly", byDays: [] }, times: [] };
    expect(entryDueOn(e, d("2026-06-15"))).toBe(false);
  });
  it("interval is due every N days from startDate, not between", () => {
    const e: ScheduleEntry = { dayPattern: { kind: "interval", everyDays: 3 }, times: [] };
    const start = d("2026-06-15");
    expect(entryDueOn(e, d("2026-06-15"), start)).toBe(true);  // day 0
    expect(entryDueOn(e, d("2026-06-16"), start)).toBe(false); // day 1
    expect(entryDueOn(e, d("2026-06-18"), start)).toBe(true);  // day 3
    expect(entryDueOn(e, d("2026-06-21"), start)).toBe(true);  // day 6
  });
  it("interval without startDate is not due", () => {
    const e: ScheduleEntry = { dayPattern: { kind: "interval", everyDays: 3 }, times: [] };
    expect(entryDueOn(e, d("2026-06-18"))).toBe(false);
  });
  it("interval is not due before startDate", () => {
    const e: ScheduleEntry = { dayPattern: { kind: "interval", everyDays: 3 }, times: [] };
    expect(entryDueOn(e, d("2026-06-12"), d("2026-06-15"))).toBe(false);
  });
  it("cycle: 5 on / 2 off repeats from startDate", () => {
    const e: ScheduleEntry = { dayPattern: { kind: "cycle", onDays: 5, offDays: 2 }, times: [] };
    const start = d("2026-06-15"); // Mon
    expect(entryDueOn(e, d("2026-06-15"), start)).toBe(true);  // day 0 on
    expect(entryDueOn(e, d("2026-06-19"), start)).toBe(true);  // day 4 on
    expect(entryDueOn(e, d("2026-06-20"), start)).toBe(false); // day 5 off
    expect(entryDueOn(e, d("2026-06-21"), start)).toBe(false); // day 6 off
    expect(entryDueOn(e, d("2026-06-22"), start)).toBe(true);  // day 7 on (next cycle)
  });
  it("cycle without startDate is not due", () => {
    const e: ScheduleEntry = { dayPattern: { kind: "cycle", onDays: 5, offDays: 2 }, times: [] };
    expect(entryDueOn(e, d("2026-06-22"))).toBe(false);
  });
});

import type { Schedule } from "./entries";

describe("slotsOn", () => {
  it("untimed entry yields a single null slot", () => {
    const s: Schedule = [{ dayPattern: { kind: "daily" }, times: [] }];
    expect(slotsOn(s, d("2026-06-16"))).toEqual([{ time: null }]);
  });
  it("returns sorted distinct times for a due day", () => {
    const s: Schedule = [{ dayPattern: { kind: "daily" }, times: ["20:00", "08:00"] }];
    expect(slotsOn(s, d("2026-06-16"))).toEqual([{ time: "08:00" }, { time: "20:00" }]);
  });
  it("unions entries and de-duplicates identical times", () => {
    const s: Schedule = [
      { dayPattern: { kind: "weekly", byDays: ["MO"] }, times: ["08:00"] },
      { dayPattern: { kind: "daily" }, times: ["08:00", "20:00"] },
    ];
    // Monday: both entries due; 08:00 dedups
    expect(slotsOn(s, d("2026-06-15"))).toEqual([{ time: "08:00" }, { time: "20:00" }]);
  });
  it("returns [] when no entry is due", () => {
    const s: Schedule = [{ dayPattern: { kind: "weekly", byDays: ["TU"] }, times: ["08:00"] }];
    expect(slotsOn(s, d("2026-06-15"))).toEqual([]); // Mon, not Tue
  });
  it("untimed slot sorts before timed slots", () => {
    const s: Schedule = [
      { dayPattern: { kind: "daily" }, times: [] },
      { dayPattern: { kind: "daily" }, times: ["08:00"] },
    ];
    expect(slotsOn(s, d("2026-06-16"))).toEqual([{ time: null }, { time: "08:00" }]);
  });
  it("respects start/end window", () => {
    const s: Schedule = [{ dayPattern: { kind: "daily" }, times: [] }];
    expect(slotsOn(s, d("2026-06-10"), d("2026-06-15"))).toEqual([]); // before start
    expect(slotsOn(s, d("2026-07-01"), null, d("2026-06-30"))).toEqual([]); // after end
  });
  it("sorts times numerically, not lexically (9:00 before 20:00)", () => {
    const s: Schedule = [{ dayPattern: { kind: "daily" }, times: ["20:00", "9:00"] }];
    expect(slotsOn(s, d("2026-06-16"))).toEqual([{ time: "9:00" }, { time: "20:00" }]);
  });
});

describe("slotsInRange", () => {
  const k = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  it("expands weekly-by-day across a window with times", () => {
    const s: Schedule = [{ dayPattern: { kind: "weekly", byDays: ["MO", "WE", "FR"] }, times: ["08:00", "20:00"] }];
    const got = slotsInRange(s, d("2026-06-14"), d("2026-06-20")).map((x) => ({ date: k(x.date), time: x.time }));
    expect(got).toEqual([
      { date: "2026-06-15", time: "08:00" }, { date: "2026-06-15", time: "20:00" },
      { date: "2026-06-17", time: "08:00" }, { date: "2026-06-17", time: "20:00" },
      { date: "2026-06-19", time: "08:00" }, { date: "2026-06-19", time: "20:00" },
    ]);
  });
  it("honours endDate", () => {
    const s: Schedule = [{ dayPattern: { kind: "daily" }, times: [] }];
    const got = slotsInRange(s, d("2026-06-14"), d("2026-06-18"), d("2026-06-15"), d("2026-06-16")).map((x) => k(x.date));
    expect(got).toEqual(["2026-06-15", "2026-06-16"]);
  });
});

describe("legacyToEntry", () => {
  it("FREQ=DAILY → one untimed daily entry", () => {
    expect(legacyToEntry("FREQ=DAILY")).toEqual([{ dayPattern: { kind: "daily" }, times: [] }]);
  });
  it("FREQ=WEEKLY;BYDAY=MO,WE,FR → weekly by those days", () => {
    expect(legacyToEntry("FREQ=WEEKLY;BYDAY=MO,WE,FR")).toEqual([
      { dayPattern: { kind: "weekly", byDays: ["MO", "WE", "FR"] }, times: [] },
    ]);
  });
  it("bare FREQ=WEEKLY → interval every 7 days (anchored to start weekday)", () => {
    expect(legacyToEntry("FREQ=WEEKLY")).toEqual([{ dayPattern: { kind: "interval", everyDays: 7 }, times: [] }]);
  });
});

describe("parseSchedule", () => {
  it("null/empty → []", () => {
    expect(parseSchedule(null)).toEqual([]);
    expect(parseSchedule("")).toEqual([]);
  });
  it("legacy RRULE string → converted entries", () => {
    expect(parseSchedule("FREQ=DAILY")).toEqual([{ dayPattern: { kind: "daily" }, times: [] }]);
  });
  it("JSON array → parsed Schedule", () => {
    const s = [{ dayPattern: { kind: "cycle", onDays: 5, offDays: 2 }, times: ["08:00"] }];
    expect(parseSchedule(JSON.stringify(s))).toEqual(s);
  });
  it("malformed JSON falls back to []", () => {
    expect(parseSchedule("[not json")).toEqual([]);
  });
  it("array of non-entries → []", () => {
    expect(parseSchedule("[1,2]")).toEqual([]);
  });
});

describe("scheduleSummary", () => {
  it("empty → No schedule", () => expect(scheduleSummary([])).toBe("No schedule"));
  it("daily untimed", () => expect(scheduleSummary([{ dayPattern: { kind: "daily" }, times: [] }])).toBe("Daily"));
  it("daily with times", () =>
    expect(scheduleSummary([{ dayPattern: { kind: "daily" }, times: ["08:00", "20:00"] }])).toBe("Daily · 08:00, 20:00"));
  it("weekly days", () =>
    expect(scheduleSummary([{ dayPattern: { kind: "weekly", byDays: ["MO", "WE", "FR"] }, times: [] }])).toBe("Mon, Wed, Fri"));
  it("interval", () =>
    expect(scheduleSummary([{ dayPattern: { kind: "interval", everyDays: 3 }, times: [] }])).toBe("Every 3 days"));
  it("interval every 1 day", () =>
    expect(scheduleSummary([{ dayPattern: { kind: "interval", everyDays: 1 }, times: [] }])).toBe("Every day"));
  it("cycle", () =>
    expect(scheduleSummary([{ dayPattern: { kind: "cycle", onDays: 5, offDays: 2 }, times: [] }])).toBe("5 on / 2 off"));
  it("multiple entries joined with +", () =>
    expect(scheduleSummary([
      { dayPattern: { kind: "weekly", byDays: ["MO", "TU", "WE", "TH", "FR"] }, times: ["08:00", "20:00"] },
      { dayPattern: { kind: "weekly", byDays: ["SA", "SU"] }, times: ["10:00"] },
    ])).toBe("Mon, Tue, Wed, Thu, Fri · 08:00, 20:00 + Sat, Sun · 10:00"));
  it("sorts times numerically, not lexically", () =>
    expect(scheduleSummary([{ dayPattern: { kind: "daily" }, times: ["20:00", "9:00"] }])).toBe("Daily · 9:00, 20:00"));
});

describe("weeklyDays", () => {
  it("unions byDays across weekly entries", () => {
    expect(weeklyDays([
      { dayPattern: { kind: "weekly", byDays: ["MO", "WE"] }, times: [] },
      { dayPattern: { kind: "weekly", byDays: ["WE", "FR"] }, times: ["08:00"] },
    ])).toEqual(["MO", "WE", "FR"]);
  });
  it("empty when no weekly entry", () => {
    expect(weeklyDays([{ dayPattern: { kind: "interval", everyDays: 3 }, times: [] }])).toEqual([]);
    expect(weeklyDays([{ dayPattern: { kind: "daily" }, times: [] }])).toEqual([]);
  });
});

describe("cyclePosition", () => {
  const d = (s: string) => new Date(s + "T09:00:00");

  it("day 0 of an on-period returns 1", () => {
    // startDate = 2026-06-15, onDays=5, offDays=2, today=2026-06-15 → day 0 of on → position 1
    expect(cyclePosition(d("2026-06-15"), 5, 2, d("2026-06-15"))).toEqual({
      phase: "on",
      dayOfPhase: 1,
      phaseDays: 5,
    });
  });

  it("day 4 of an on-period returns 5", () => {
    // elapsed=4, period=7, 4 < 5 → still on, dayOfPhase=5
    expect(cyclePosition(d("2026-06-15"), 5, 2, d("2026-06-19"))).toEqual({
      phase: "on",
      dayOfPhase: 5,
      phaseDays: 5,
    });
  });

  it("first off day returns phase=off dayOfPhase=1", () => {
    // elapsed=5, 5 >= 5 → off, dayOfPhase = (5-5)+1 = 1
    expect(cyclePosition(d("2026-06-15"), 5, 2, d("2026-06-20"))).toEqual({
      phase: "off",
      dayOfPhase: 1,
      phaseDays: 2,
    });
  });

  it("second off day returns phase=off dayOfPhase=2", () => {
    // elapsed=6, 6 >= 5 → off, dayOfPhase = (6-5)+1 = 2
    expect(cyclePosition(d("2026-06-15"), 5, 2, d("2026-06-21"))).toEqual({
      phase: "off",
      dayOfPhase: 2,
      phaseDays: 2,
    });
  });

  it("first day of second cycle wraps back to on/1", () => {
    // elapsed=7, 7 % 7 = 0 → on, dayOfPhase=1
    expect(cyclePosition(d("2026-06-15"), 5, 2, d("2026-06-22"))).toEqual({
      phase: "on",
      dayOfPhase: 1,
      phaseDays: 5,
    });
  });

  it("before startDate returns null", () => {
    expect(cyclePosition(d("2026-06-15"), 5, 2, d("2026-06-14"))).toBeNull();
  });

  it("returns null when onDays <= 0", () => {
    expect(cyclePosition(d("2026-06-15"), 0, 2, d("2026-06-15"))).toBeNull();
  });

  it("returns null when offDays <= 0", () => {
    expect(cyclePosition(d("2026-06-15"), 5, 0, d("2026-06-15"))).toBeNull();
  });

  it("1 on / 1 off alternates correctly", () => {
    // elapsed=0 → on/1; elapsed=1 → off/1; elapsed=2 → on/1
    expect(cyclePosition(d("2026-06-15"), 1, 1, d("2026-06-15"))).toEqual({ phase: "on", dayOfPhase: 1, phaseDays: 1 });
    expect(cyclePosition(d("2026-06-15"), 1, 1, d("2026-06-16"))).toEqual({ phase: "off", dayOfPhase: 1, phaseDays: 1 });
    expect(cyclePosition(d("2026-06-15"), 1, 1, d("2026-06-17"))).toEqual({ phase: "on", dayOfPhase: 1, phaseDays: 1 });
  });
});
