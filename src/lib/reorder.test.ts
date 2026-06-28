import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { resolveTitration } from "./titration/resolve";
import { buildResolveInput } from "./titration/from-protocol";

// getReorderStatus is DB-bound; this guards the resolver contract its dose
// sizing relies on. The SAME per-injection {value,unit} feeds BOTH the in-use
// prep path (canonicaliseDose) and the sealed-vial path (doseToMcg) — a per_week
// dose must be divided once, before either, or the sealed-vial mass estimate
// and the prep volume estimate both under-count doses-per-vial.
const d = (s: string) => new Date(s + "T00:00:00");
const wk = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "TH"] }, times: [] }]);

describe("reorder per_week dose sizing", () => {
  it("per_week dose divided before both vial paths (8mg/wk @ 2/wk → 4mg)", () => {
    const now = d("2026-06-15");
    const r = resolveTitration(
      buildResolveInput({
        protocol: {
          doseBasis: "per_week",
          targetDose: new Decimal("8"),
          doseInputUnit: "mg",
          scheduleRule: wk,
          rebaseMode: "fixed_anchor",
          startDate: now,
          endDate: null,
          adherenceWindowMin: 120,
          steps: [{ stepIndex: 0, dose: new Decimal("8"), doseInputUnit: "mg", durationDays: null }],
        },
        deliveredLogs: [],
        range: { start: now, end: now },
        now,
      }),
    );
    expect(r.slots[0].perInjectionValue).toBe("4");
    expect(r.slots[0].perInjectionUnit).toBe("mg");

    // The sealed-vial path multiplies mg→mcg: 4mg → 4000mcg (NOT 8000).
    const mcg = new Decimal(r.slots[0].perInjectionValue).times(1000);
    expect(mcg.toString()).toBe("4000");
  });

  it("non-titration per_injection target passes through unchanged", () => {
    const now = d("2026-06-15");
    const r = resolveTitration(
      buildResolveInput({
        protocol: {
          doseBasis: "per_injection",
          targetDose: new Decimal("500"),
          doseInputUnit: "mcg",
          scheduleRule: wk,
          rebaseMode: "fixed_anchor",
          startDate: now,
          endDate: null,
          adherenceWindowMin: 120,
          steps: [],
        },
        deliveredLogs: [],
        range: { start: now, end: now },
        now,
      }),
    );
    expect(r.slots[0].perInjectionValue).toBe("500");
    expect(r.slots[0].perInjectionUnit).toBe("mcg");
  });
});
