import { describe, it, expect } from "vitest";
import { computeAdvance } from "./advance-suggest";

// A real-world-shaped MOTS-c titration plan: 200→400→600→800→1000 mcg, 14 days each, daily.
const MOTSC_STEPS = [
  { stepIndex: 0, dose: "200", doseInputUnit: "mcg", durationDays: 14 },
  { stepIndex: 1, dose: "400", doseInputUnit: "mcg", durationDays: 14 },
  { stepIndex: 2, dose: "600", doseInputUnit: "mcg", durationDays: 14 },
  { stepIndex: 3, dose: "800", doseInputUnit: "mcg", durationDays: 14 },
  { stepIndex: 4, dose: "1000", doseInputUnit: "mcg", durationDays: null },
];
const base = { steps: MOTSC_STEPS, doseBasis: "per_injection" as const, injectionsPerWeek: 7 };

describe("computeAdvance", () => {
  it("offers the advance when the logged dose matches the NEXT step", () => {
    // 6 doses of 200 delivered in phase 1, then a 400 logged.
    const r = computeAdvance({ ...base, deliveredBeforeCount: 6, loggedDoseMcg: "400" });
    expect(r).toMatchObject({ stepIndex: 0, newDurationDays: 6, fromPhase: 1, toPhase: 2, phaseCount: 5 });
    expect(`${r!.nextDoseValue} ${r!.nextDoseUnit}`).toBe("400 mcg");
  });
  it("no prompt when the logged dose is the current phase's own dose", () => {
    expect(computeAdvance({ ...base, deliveredBeforeCount: 6, loggedDoseMcg: "200" })).toBeNull();
  });
  it("no prompt for a dose that matches neither step", () => {
    expect(computeAdvance({ ...base, deliveredBeforeCount: 6, loggedDoseMcg: "300" })).toBeNull();
  });
  it("no prompt on the final phase", () => {
    // 14×4 = 56 delivered → phase 5 (1000, indefinite); nothing to advance to.
    expect(computeAdvance({ ...base, deliveredBeforeCount: 56, loggedDoseMcg: "1200" })).toBeNull();
  });
  it("matches within 0.5% (unit-conversion rounding) but not beyond", () => {
    expect(computeAdvance({ ...base, deliveredBeforeCount: 6, loggedDoseMcg: "401" })).not.toBeNull();
    expect(computeAdvance({ ...base, deliveredBeforeCount: 6, loggedDoseMcg: "410" })).toBeNull();
  });
  it("counts mid-plan phases cumulatively (advance from phase 2 to 3)", () => {
    // Phase 1 complete (14) + 3 doses into phase 2, then a 600 logged.
    const r = computeAdvance({ ...base, deliveredBeforeCount: 17, loggedDoseMcg: "600" });
    expect(r).toMatchObject({ stepIndex: 1, newDurationDays: 3, fromPhase: 2, toPhase: 3 });
  });
  it("handles mg steps via canonical mcg", () => {
    const mg = [
      { stepIndex: 0, dose: "1", doseInputUnit: "mg", durationDays: 14 },
      { stepIndex: 1, dose: "2", doseInputUnit: "mg", durationDays: null },
    ];
    const r = computeAdvance({ steps: mg, doseBasis: "per_injection", injectionsPerWeek: 7, deliveredBeforeCount: 5, loggedDoseMcg: "2000" });
    expect(r).toMatchObject({ stepIndex: 0, newDurationDays: 5, toPhase: 2 });
  });
  it("per_week basis compares the derived per-injection dose", () => {
    const wk = [
      { stepIndex: 0, dose: "8", doseInputUnit: "mg", durationDays: 14 }, // ÷2 = 4mg
      { stepIndex: 1, dose: "12", doseInputUnit: "mg", durationDays: null }, // ÷2 = 6mg
    ];
    const r = computeAdvance({ steps: wk, doseBasis: "per_week", injectionsPerWeek: 2, deliveredBeforeCount: 2, loggedDoseMcg: "6000" });
    expect(r).toMatchObject({ stepIndex: 0, toPhase: 2 });
    // 2 delivered in phase at 2/wk → minimal duration whose target is 2:
    // round(6/7×2) = 2 → 6 days (the count target is what matters, not the label).
    expect(r!.newDurationDays).toBe(6);
  });
  it("returns null when not titrating or schedule is unknown", () => {
    expect(computeAdvance({ steps: [MOTSC_STEPS[0]], doseBasis: "per_injection", injectionsPerWeek: 7, deliveredBeforeCount: 3, loggedDoseMcg: "400" })).toBeNull();
    expect(computeAdvance({ ...base, injectionsPerWeek: null, deliveredBeforeCount: 3, loggedDoseMcg: "400" })).toBeNull();
  });
});
