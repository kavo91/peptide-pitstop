import { describe, it, expect } from "vitest";
import { supplyLine, supplySuffix, supplyQualifier, type SupplyCopyInput } from "./reorder-copy";

const base: SupplyCopyInput = {
  status: "ok",
  coverageBasis: "depletion",
  reorderByDate: "2026-08-29",
  courseEndDate: null,
  coverageDays: 40,
  phaseToday: "on",
  notStarted: false,
};

describe("supply copy", () => {
  it("keeps the existing urgent and ok wording", () => {
    expect(supplyLine({ ...base, status: "reorder_now" })).toBe("Reorder now");
    expect(supplyLine(base)).toBe("Reorder by 29 Aug");
  });

  // R10: dates are formatted, never raw ISO.
  it("never renders a raw ISO date", () => {
    expect(supplyLine(base)).not.toContain("2026-");
  });

  // R4: a well-supplied peptide must NOT read as "Coverage unknown".
  it("distinguishes covered from unknown", () => {
    const covered: SupplyCopyInput = {
      ...base,
      status: "covered",
      coverageBasis: "course_end",
      reorderByDate: null,
      courseEndDate: "2026-08-20",
    };
    expect(supplyLine(covered)).toBe("Covers doses to 20 Aug");
    expect(supplyLine({ ...covered, status: "unknown" })).toBe("Coverage unknown");
  });

  // R23: a repeating course is covered "to the end of THIS cycle" — never a
  // claim about a cycle the user has not started yet.
  it("scopes a repeating course to the current cycle", () => {
    const line = supplyLine({
      ...base,
      status: "covered",
      coverageBasis: "cycle_end",
      reorderByDate: null,
      courseEndDate: "2026-11-22",
    });
    expect(line).toBe("Covers this cycle, to 22 Nov");
  });

  it("falls back to the horizon phrasing with no end date", () => {
    expect(
      supplyLine({ ...base, status: "covered", coverageBasis: "horizon", reorderByDate: null }),
    ).toBe("Covers doses beyond 12 months");
  });

  // R6/product: a big number for a protocol that is not consuming today is
  // misleading without a qualifier.
  it("qualifies an off week and a future start", () => {
    expect(supplyQualifier({ ...base, phaseToday: "off" })).toBe("off week");
    expect(supplyLine({ ...base, phaseToday: "off" })).toBe("Reorder by 29 Aug · off week");
    expect(
      supplyLine({ ...base, notStarted: true, firstDoseDate: "2026-09-28" }),
    ).toBe("Reorder by 29 Aug · starts 28 Sep");
  });

  it("drops 'soonest' once nothing is queued", () => {
    expect(supplySuffix({ ...base, status: "reorder_now" })).toBe("soonest");
    expect(
      supplySuffix({ ...base, status: "covered", coverageBasis: "course_end", courseEndDate: "2026-08-20" }),
    ).toBe("covered to 20 Aug");
  });

  it("says nothing advisory", () => {
    const all = [
      supplyLine({ ...base, status: "reorder_now" }),
      supplyLine(base),
      supplyLine({ ...base, status: "covered", coverageBasis: "horizon", reorderByDate: null }),
      supplyLine({ ...base, status: "unknown" }),
    ].join(" ").toLowerCase();
    for (const banned of ["should", "recommend", "safe", "increase", "reduce", "stop taking"]) {
      expect(all).not.toContain(banned);
    }
  });
});

describe("supply copy — review findings", () => {
  // A dense schedule is truncated by the slot cap, so it is simulated for LESS
  // than a year; claiming "beyond 12 months" beside a 266-day number lies.
  it("does not claim 12 months for a walk that never reached it", () => {
    const truncated: SupplyCopyInput = {
      ...base,
      status: "covered",
      coverageBasis: "horizon",
      reorderByDate: null,
      coverageDays: 266,
      courseEndDate: "2027-05-08",
    };
    expect(supplyLine(truncated)).toBe("Covers doses to 8 May");
    expect(supplyLine({ ...truncated, coverageDays: 364, courseEndDate: null }))
      .toBe("Covers doses beyond 12 months");
  });

  // The two design packs must say the same thing about the same item.
  it("keeps the coverage claim when a qualifier applies", () => {
    const offWeek: SupplyCopyInput = {
      ...base,
      status: "covered",
      coverageBasis: "course_end",
      reorderByDate: null,
      courseEndDate: "2026-11-22",
      phaseToday: "off",
    };
    expect(supplyLine(offWeek)).toBe("Covers doses to 22 Nov · off week");
    expect(supplySuffix(offWeek)).toBe("covered to 22 Nov · off week");
  });
});
