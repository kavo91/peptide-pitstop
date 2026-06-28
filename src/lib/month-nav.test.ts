import { describe, it, expect } from "vitest";
import { parseMonthParam, shiftMonth, monthKey } from "./month-nav";

describe("parseMonthParam", () => {
  it("parses YYYY-MM to the 1st of that month (local)", () => {
    expect(monthKey(parseMonthParam("2026-03", new Date("2026-06-21T00:00:00")))).toBe("2026-03");
  });
  it("falls back to the reference month on invalid input", () => {
    const ref = new Date("2026-06-21T00:00:00");
    expect(monthKey(parseMonthParam("garbage", ref))).toBe("2026-06");
    expect(monthKey(parseMonthParam(undefined, ref))).toBe("2026-06");
    expect(monthKey(parseMonthParam("2026-13", ref))).toBe("2026-06");
  });
});

describe("shiftMonth", () => {
  it("steps forward across a year boundary", () => {
    expect(monthKey(shiftMonth(new Date("2026-12-15T00:00:00"), 1))).toBe("2027-01");
  });
  it("steps backward across a year boundary", () => {
    expect(monthKey(shiftMonth(new Date("2026-01-15T00:00:00"), -1))).toBe("2025-12");
  });
});
