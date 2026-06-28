import { describe, it, expect } from "vitest";
import { recomputeReconEdit, reconcileDoseEditRemaining } from "./recompute";

describe("recomputeReconEdit", () => {
  it("recomputes each dose mass from new concentration (volume fixed) and remaining = total − Σdrawn", () => {
    // 2 mg in 2 mL = 1000 mcg/mL; two 0.5 mL draws → 500 mcg each; remaining 1.0 mL
    const r = recomputeReconEdit({
      newConcentrationMcgPerMl: "1000", newTotalMl: "2",
      doses: [{ id: "a", volumeMl: "0.5" }, { id: "b", volumeMl: "0.5" }],
    });
    expect(r.doses).toEqual([{ id: "a", doseMcg: "500" }, { id: "b", doseMcg: "500" }]);
    expect(r.remainingMl).toBe("1");
    expect(r.remainingClamped).toBe(false);
  });
  it("correcting BAC water 2→3 mL drops concentration and lifts remaining; masses fall", () => {
    // same 2 mg, now in 3 mL = 666.67 mcg/mL; one 0.5 mL draw → ~333.33 mcg; remaining 2.5 mL
    const r = recomputeReconEdit({
      newConcentrationMcgPerMl: "666.6666666666666667", newTotalMl: "3",
      doses: [{ id: "a", volumeMl: "0.5" }],
    });
    expect(Number(r.doses[0].doseMcg)).toBeCloseTo(333.33, 2);
    expect(r.remainingMl).toBe("2.5");
  });
  it("clamps remaining to 0 (and flags) when draws exceed the corrected volume", () => {
    const r = recomputeReconEdit({ newConcentrationMcgPerMl: "1000", newTotalMl: "1", doses: [{ id: "a", volumeMl: "1.5" }] });
    expect(r.remainingMl).toBe("0");
    expect(r.remainingClamped).toBe(true);
  });
});

describe("reconcileDoseEditRemaining", () => {
  it("adds back the old draw, subtracts the new draw, clamped to [0, cap]", () => {
    // remaining 1.0, was 0.5, now 0.3 → 1.0 + 0.5 − 0.3 = 1.2 (cap 2)
    expect(reconcileDoseEditRemaining({ remainingMl: "1", oldVolumeMl: "0.5", newVolumeMl: "0.3", fillCapMl: "2" }))
      .toEqual({ remainingMl: "1.2", clamped: false });
  });
  it("editing back to the same volume is a no-op round-trip", () => {
    const once = reconcileDoseEditRemaining({ remainingMl: "1", oldVolumeMl: "0.5", newVolumeMl: "0.8", fillCapMl: "2" });
    const back = reconcileDoseEditRemaining({ remainingMl: once.remainingMl, oldVolumeMl: "0.8", newVolumeMl: "0.5", fillCapMl: "2" });
    expect(back.remainingMl).toBe("1");
  });
  it("clamps at the fill cap when a draw shrinks below zero usage", () => {
    expect(reconcileDoseEditRemaining({ remainingMl: "1.9", oldVolumeMl: "0.5", newVolumeMl: "0", fillCapMl: "2" }))
      .toEqual({ remainingMl: "2", clamped: true });
  });
});
