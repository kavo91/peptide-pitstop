import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { resolveTitration } from "./titration/resolve";
import { buildResolveInput } from "./titration/from-protocol";

// getInventory is DB-bound; this guards the resolver contract its forecast
// relies on: a per_week dose MUST be divided to per-injection before the volume
// math, or remainingDoses/daysLeft under-forecast by the injections/week factor
// (a 7× error for a weekly dose taken twice-weekly etc.).
const d = (s: string) => new Date(s + "T00:00:00");
const wk = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "TH"] }, times: [] }]);

describe("inventory per_week forecast", () => {
  it("per_week dose is divided before volume math (8mg/wk @ 2/wk → 4mg per injection)", () => {
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
  });

  it("non-titration per_injection passes the target dose through unchanged", () => {
    const now = d("2026-06-15");
    const r = resolveTitration(
      buildResolveInput({
        protocol: {
          doseBasis: "per_injection",
          targetDose: new Decimal("250"),
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
    expect(r.slots[0].perInjectionValue).toBe("250");
    expect(r.slots[0].perInjectionUnit).toBe("mcg");
  });
});
