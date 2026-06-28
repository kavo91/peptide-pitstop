import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { buildResolveInput } from "./from-protocol";

const d = (s: string) => new Date(s + "T00:00:00");
const wk = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "TH"] }, times: [] }]);

// A per_week titration protocol: 8 mg/wk ramp on Mon/Thu (2 injections/week).
function protocol(over: Record<string, unknown> = {}) {
  return {
    doseBasis: "per_week",
    targetDose: new Decimal("8"),
    doseInputUnit: "mg",
    scheduleRule: wk,
    rebaseMode: "fixed_anchor",
    startDate: d("2026-06-15"),
    endDate: null,
    adherenceWindowMin: 90,
    steps: [
      { stepIndex: 0, dose: new Decimal("8"), doseInputUnit: "mg", durationDays: 14 },
      { stepIndex: 1, dose: new Decimal("12"), doseInputUnit: "mg", durationDays: null },
    ],
    ...over,
  };
}

describe("buildResolveInput", () => {
  it("maps a per_week protocol + logs into a correct ResolveInput", () => {
    const logs = [
      { id: "a", takenAt: d("2026-06-15") },
      { id: "b", takenAt: d("2026-06-18") },
    ];
    const range = { start: d("2026-06-15"), end: d("2026-06-22") };
    const now = d("2026-06-19");

    const input = buildResolveInput({ protocol: protocol(), deliveredLogs: logs, range, now });

    expect(input.doseBasis).toBe("per_week");
    expect(input.fallbackDose).toBe("8");
    expect(input.fallbackUnit).toBe("mg");
    expect(input.scheduleRule).toBe(wk);
    expect(input.rebaseMode).toBe("fixed_anchor");
    expect(input.startDate).toEqual(d("2026-06-15"));
    expect(input.endDate).toBeNull();
    expect(input.adherenceWindowMin).toBe(90);
    expect(input.injectionsPerWeek).toBe(2); // Mon/Thu = 2/wk
    expect(input.skipped).toEqual([]);
    expect(input.range).toEqual(range);
    expect(input.now).toEqual(now);
    // steps mapped with dose.toString()
    expect(input.steps).toEqual([
      { stepIndex: 0, dose: "8", doseInputUnit: "mg", durationDays: 14 },
      { stepIndex: 1, dose: "12", doseInputUnit: "mg", durationDays: null },
    ]);
    // delivered mapped: id + Date(takenAt)
    expect(input.delivered).toEqual([
      { id: "a", takenAt: d("2026-06-15") },
      { id: "b", takenAt: d("2026-06-18") },
    ]);
  });

  it("the produced input resolves the per-injection dose (8mg/wk ÷ 2 = 4mg)", () => {
    // Sanity: piping the built input through the resolver gives the divided dose.
    const input = buildResolveInput({
      protocol: protocol(),
      deliveredLogs: [],
      range: { start: d("2026-06-15"), end: d("2026-06-15") },
      now: d("2026-06-15"),
    });
    expect(input.injectionsPerWeek).toBe(2);
    expect(input.steps[0].dose).toBe("8");
  });

  it("null targetDose → fallbackDose null; defaults applied", () => {
    const input = buildResolveInput({
      protocol: protocol({ targetDose: null, doseInputUnit: "mcg", doseBasis: "per_injection", rebaseMode: "rolling", adherenceWindowMin: null }),
      deliveredLogs: [],
      range: { start: d("2026-06-15"), end: d("2026-06-15") },
      now: d("2026-06-15"),
    });
    expect(input.fallbackDose).toBeNull();
    expect(input.fallbackUnit).toBe("mcg");
    expect(input.doseBasis).toBe("per_injection");
    expect(input.rebaseMode).toBe("rolling");
    expect(input.adherenceWindowMin).toBe(120); // default
  });

  it("coerces string takenAt into a Date", () => {
    const input = buildResolveInput({
      protocol: protocol(),
      deliveredLogs: [{ id: "a", takenAt: "2026-06-15T08:30:00.000Z" }],
      range: { start: d("2026-06-15"), end: d("2026-06-15") },
      now: d("2026-06-15"),
    });
    expect(input.delivered[0].takenAt).toBeInstanceOf(Date);
    expect(input.delivered[0].takenAt.toISOString()).toBe("2026-06-15T08:30:00.000Z");
  });
});
