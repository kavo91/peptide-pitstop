import { describe, it, expect } from "vitest";
import { planEndCycle, planNextCycle } from "./cycle/actions-plan";
import { homeStartBound, startsOnOrBefore, hasStartedBy } from "./protocol-day-bounds";

/**
 * v1.25.9, pinned to Australia/Brisbane (the suite default): the exact values the
 * follow-ups change. Brisbane is UTC+10 with no DST, so a server-local
 * midnight is 14:00Z of the day before and a 00:00Z value is 10:00 local.
 */

const D = (key: string) => new Date(`${key}T00:00:00.000Z`);
const L = (key: string, h = 0, min = 0) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, h, min);
};
type Bound = { lt?: Date; lte?: Date };
const passes = (b: Bound, v: Date) => (b.lt === undefined || v < b.lt) && (b.lte === undefined || v <= b.lte);

describe("date-only follow-ups in Brisbane", () => {
  it("runs in Brisbane", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Australia/Brisbane");
  });

  it("startNextCycle at 08:00 on 2 Oct writes 2027-10-02T00:00Z, not 2027-10-01T14:00Z", () => {
    const next = planNextCycle({ startDate: null, cycleOnWeeks: 4 }, L("2027-10-02", 8));
    expect(next.data.cycleAnchor.toISOString()).toBe("2027-10-02T00:00:00.000Z");
    expect(next.data.startDate?.toISOString()).toBe("2027-10-02T00:00:00.000Z");
    expect(next.data.endDate?.toISOString()).toBe("2027-10-29T00:00:00.000Z");
    expect(next.audit).toBe("next cycle started 2027-10-02");
  });

  it("endCycle writes 2027-10-10T00:00Z and logs the 10th, not the 9th", () => {
    const r = planEndCycle({ startDate: D("2027-09-13"), endDate: null, cycleAnchor: null, cycleOnWeeks: 4 });
    expect(r.endDate?.toISOString()).toBe("2027-10-10T00:00:00.000Z");
    expect(r.audit).toBe("cycle ended (endDate 2027-10-10)");
  });

  it("home tiles show a protocol starting today from 00:01, not from 10:00", () => {
    expect(passes(homeStartBound(L("2027-10-02", 0, 1)), D("2027-10-02"))).toBe(true);
    expect(passes(homeStartBound(L("2027-10-02", 9, 59)), D("2027-10-02"))).toBe(true);
    // Tomorrow's start, in either form, stays out all day.
    expect(passes(homeStartBound(L("2027-10-02", 23, 59)), D("2027-10-03"))).toBe(false);
    expect(passes(homeStartBound(L("2027-10-02", 23, 59)), L("2027-10-03"))).toBe(false);
  });

  it("a completed protocol starting on the range's last day is in the range", () => {
    expect(passes(startsOnOrBefore(L("2027-10-10")), D("2027-10-10"))).toBe(true);
    expect(passes(startsOnOrBefore(L("2027-10-10")), D("2027-10-11"))).toBe(false);
  });

  it("analytics counts a protocol starting today as started at 08:00", () => {
    expect(hasStartedBy(D("2027-10-02"), L("2027-10-02", 8))).toBe(true);
    expect(hasStartedBy(D("2027-10-03"), L("2027-10-02", 23, 59))).toBe(false);
  });
});
