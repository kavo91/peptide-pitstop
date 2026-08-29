import { describe, it, expect } from "vitest";
import {
  NEGATIVE_DURATION_ERROR,
  isNegativeDuration,
  parseStepDuration,
  validateStepDurations,
} from "./step-duration";
import { phaseTargets } from "./phase";

describe("step duration parsing", () => {
  it("accepts calendar days — 14 means two weeks, not fourteen doses", () => {
    expect(parseStepDuration("14")).toEqual({ ok: true, value: 14 });
    // The resolver turns that into a dose-count target; at 3 injections/week a
    // 14-day step is 6 doses. This pins the units so a future 'fix' can't
    // reinterpret the field as a dose count.
    expect(phaseTargets([{ stepIndex: 0, dose: "25", doseInputUnit: "mg", durationDays: 14 }], 3)).toEqual([6]);
  });

  it("treats blank as the indefinite final step", () => {
    expect(parseStepDuration("")).toEqual({ ok: true, value: null });
    expect(parseStepDuration(undefined)).toEqual({ ok: true, value: null });
  });

  it("REFUSES a negative rather than clamping it", () => {
    expect(parseStepDuration("-7")).toEqual({ ok: false, error: NEGATIVE_DURATION_ERROR });
    expect(parseStepDuration(" -1 ")).toEqual({ ok: false, error: NEGATIVE_DURATION_ERROR });
  });

  it("refuses what the read path would throw on — the two must agree", () => {
    // This is the whole point of the guard: phaseTargets throws on a negative,
    // so anything the writer accepts must be something the reader can resolve.
    expect(() => phaseTargets([{ stepIndex: 0, dose: "25", doseInputUnit: "mg", durationDays: -7 }], 3)).toThrow();
    expect(parseStepDuration("-7").ok).toBe(false);
  });

  it("isNegativeDuration mirrors the parser for the client-side pre-check", () => {
    expect(isNegativeDuration("-7")).toBe(true);
    expect(isNegativeDuration("7")).toBe(false);
    expect(isNegativeDuration("")).toBe(false);
    expect(isNegativeDuration("abc")).toBe(false);
  });

  it("names the offending step 1-based so the message points at a visible row", () => {
    const res = validateStepDurations([
      { durationDays: "14" },
      { durationDays: "14" },
      { durationDays: "-3" },
    ]);
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toBe(`Step 3: ${NEGATIVE_DURATION_ERROR}`);
  });

  it("returns parsed values in order for a valid ladder", () => {
    const res = validateStepDurations([{ durationDays: "14" }, { durationDays: "14" }, { durationDays: "" }]);
    expect(res).toEqual({ ok: true, values: [14, 14, null] });
  });
});
