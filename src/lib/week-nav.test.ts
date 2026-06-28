import { describe, it, expect } from "vitest";
import { parseWeekParam, shiftWeek, weekKey } from "./week-nav";

describe("weekKey", () => {
  it("zero-pads month and day", () => {
    expect(weekKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(weekKey(new Date(2026, 8, 9))).toBe("2026-09-09");
  });
});

describe("parseWeekParam", () => {
  it("snaps a valid YYYY-MM-DD to the Monday of that week", () => {
    // 2026-06-10 is a Wednesday → Monday is 2026-06-08.
    const ref = new Date("2026-06-21T00:00:00");
    expect(weekKey(parseWeekParam("2026-06-10", ref))).toBe("2026-06-08");
  });
  it("returns the same date when the param is already a Monday", () => {
    const ref = new Date("2026-06-21T00:00:00");
    expect(weekKey(parseWeekParam("2026-06-08", ref))).toBe("2026-06-08");
  });
  it("falls back to the Monday of the reference week on invalid input", () => {
    // 2026-06-21 is a Sunday → Monday of that week is 2026-06-15.
    const ref = new Date("2026-06-21T00:00:00");
    expect(weekKey(parseWeekParam("garbage", ref))).toBe("2026-06-15");
    expect(weekKey(parseWeekParam(undefined, ref))).toBe("2026-06-15");
    expect(weekKey(parseWeekParam("2026-13-40", ref))).toBe("2026-06-15");
  });
});

describe("shiftWeek", () => {
  it("steps forward seven days", () => {
    expect(weekKey(shiftWeek(new Date(2026, 5, 8), 1))).toBe("2026-06-15");
  });
  it("steps backward seven days", () => {
    expect(weekKey(shiftWeek(new Date(2026, 5, 8), -1))).toBe("2026-06-01");
  });
  it("crosses a year boundary forward", () => {
    // 2026-12-28 is a Monday → +1 week = 2027-01-04.
    expect(weekKey(shiftWeek(new Date(2026, 11, 28), 1))).toBe("2027-01-04");
  });
});
