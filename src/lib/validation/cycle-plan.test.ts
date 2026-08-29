import { describe, expect, it } from "vitest";

import { validateCyclePlan, MAX_CYCLE_WEEKS } from "./cycle-plan";

describe("validateCyclePlan", () => {
  it("accepts a full plan and a continuous (all-null) plan", () => {
    expect(validateCyclePlan(8, 4)).toEqual({ ok: true, onWeeks: 8, offWeeks: 4 });
    expect(validateCyclePlan(null, null)).toEqual({ ok: true, onWeeks: null, offWeeks: null });
    expect(validateCyclePlan(2, null)).toEqual({ ok: true, onWeeks: 2, offWeeks: null });
  });

  it("rejects weeks outside the plausible band", () => {
    expect(validateCyclePlan(0, null).ok).toBe(false);
    expect(validateCyclePlan(MAX_CYCLE_WEEKS + 1, null).ok).toBe(false);
    expect(validateCyclePlan(8, 0).ok).toBe(false);
    expect(validateCyclePlan(2.5, null).ok).toBe(false);
  });

  it("rejects a break with no on-cycle", () => {
    const r = validateCyclePlan(null, 4);
    expect(r).toEqual({ ok: false, error: "Set an on-cycle length before a break length." });
  });

  it("clearing the on-cycle clears the break with it", () => {
    expect(validateCyclePlan(null, null)).toEqual({ ok: true, onWeeks: null, offWeeks: null });
  });
});
