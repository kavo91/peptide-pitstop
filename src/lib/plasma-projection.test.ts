import { describe, it, expect } from "vitest";
import { forwardDosePoints } from "./plasma-projection";
import type { ResolvedSlot } from "./titration/types";

const slot = (over: Partial<ResolvedSlot>): ResolvedSlot => ({
  date: new Date("2026-06-22T00:00:00"), time: null, phaseIndex: 0,
  perInjectionValue: "4", perInjectionUnit: "mg", status: "projected", isProjected: true,
  matchedLogId: null, rebased: false, ...over,
});

// mcg converter mirrors analytics.projectionDoseMcg: mcg/mg → mass, ml/units → null
const toMcg = (v: string, u: string): number | null => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (u === "mcg") return n;
  if (u === "mg") return n * 1000;
  return null;
};

describe("forwardDosePoints", () => {
  it("maps projected slots to mcg DosePoints (per_week already divided upstream)", () => {
    const out = forwardDosePoints([slot({})], toMcg);
    expect(out).toEqual([{ at: new Date("2026-06-22T00:00:00"), amountMcg: 4000 }]);
  });
  it("uses slot time when present", () => {
    const out = forwardDosePoints([slot({ time: "20:00" })], toMcg);
    expect(out[0].at.getHours()).toBe(20);
  });
  it("skips non-projected slots (past/today are real DoseLogs)", () => {
    expect(forwardDosePoints([slot({ isProjected: false })], toMcg)).toEqual([]);
  });
  it("skips unconvertible units (ml/units → decay-only, never fabricated)", () => {
    expect(forwardDosePoints([slot({ perInjectionUnit: "units" })], toMcg)).toEqual([]);
  });
  it("skips empty per-injection value (per_week unresolved)", () => {
    expect(forwardDosePoints([slot({ perInjectionValue: "" })], toMcg)).toEqual([]);
  });
});
