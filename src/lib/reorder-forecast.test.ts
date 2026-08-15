/**
 * Forecast core contract. Every case here traces to a ruling in
 * docs/reorder-forecast-rulings.md — the
 * ruling id is cited so a future reader can find out WHY, not just what.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { forecastCoverage, type ForecastContainer, type ForecastSlot } from "./reorder-forecast";
import type { Syringe } from "./dosing/types";

const U100: Syringe = {
  name: "U-100 1mL",
  graduationType: "units",
  unitsPerMl: 100,
  capacityMl: 1,
  capacityUnits: 100,
  increment: 1,
};

const TODAY = new Date(2026, 7, 15); // 15 Aug 2026, local
const day = (n: number) => new Date(2026, 7, 15 + n);

/** Daily slots from tomorrow, all at the same dose. */
function dailySlots(count: number, value = "1000", unit: "mcg" | "mg" | "ml" = "mcg"): ForecastSlot[] {
  return Array.from({ length: count }, (_, i) => ({
    date: day(i + 1),
    perInjectionValue: value,
    perInjectionUnit: unit,
  }));
}

function prep(remainingMl: string, conc: string, usableUntil: Date | null = null): ForecastContainer {
  return {
    kind: "prep",
    poolMl: new Decimal(remainingMl),
    concentrationMcgPerMl: new Decimal(conc),
    poolMcg: null,
    usableUntil,
  };
}

function sealed(labelStrengthMg: string): ForecastContainer {
  return {
    kind: "sealed",
    poolMl: null,
    concentrationMcgPerMl: null,
    poolMcg: new Decimal(labelStrengthMg).times(1000),
    usableUntil: null,
  };
}

const base = {
  syringe: U100,
  scheduleEvaluable: true,
  stopReason: "horizon" as const,
  courseEndDate: null,
  leadTimeDays: 14,
  bufferDays: 3,
  today: TODAY,
  budDaysForSealed: 28,
};

describe("forecastCoverage", () => {
  // 1 — regression guard against the old flat-rate arithmetic.
  it("depletes on the slot that cannot be served (6 doses, daily)", () => {
    const r = forecastCoverage({ ...base, slots: dailySlots(60), containers: [prep("1.2", "5000")] });
    expect(r.status).toBe("reorder_now");
    expect(r.coverageDays).toBe(6);
    expect(r.coverageBasis).toBe("depletion");
  });

  // 2 — R2/R23: the Epithalon shape. The course outlives the stock by nothing.
  it("reports covered when the course ends before the stock does", () => {
    const r = forecastCoverage({
      ...base,
      slots: dailySlots(5), // course ends day +5
      containers: [prep("1.2", "5000")], // 6 doses
      stopReason: "course_end",
      courseEndDate: day(5),
    });
    expect(r.status).toBe("covered");
    expect(r.coverageBasis).toBe("course_end");
    expect(r.depletionDate).toBeNull();
    expect(r.reorderByDate).toBeNull();
  });

  // 2b — the exact-fit boundary (KLOW: 21 needed, 21 held). Off-by-one flips it.
  it("treats an exact fit as covered, not depleted", () => {
    const r = forecastCoverage({
      ...base,
      slots: dailySlots(21, "3200"), // 3200 mcg @ 26666.67 = 0.12 mL exactly
      containers: [prep("2.52", "26666.666666666701")], // 2.52 / 0.12 => exactly 21
      stopReason: "course_end",
      courseEndDate: day(21),
    });
    expect(r.status).toBe("covered");
  });

  // 3 — R23 REVERSAL: off-cycle slots are NOT skipped. today.ts still renders
  // them as due, so the forecast must cost them. Conservative is correct.
  it("costs every slot the grid emits, including planned off-weeks", () => {
    const r = forecastCoverage({ ...base, slots: dailySlots(30), containers: [prep("2.0", "5000")] });
    expect(r.coverageDays).toBe(10); // 10 doses, no cycle-based discount
    expect(r.status).toBe("reorder_now");
  });

  // 4 — R26/R3: a schedule that cannot be evaluated is a data gap, never comfort.
  it("returns unknown when the schedule cannot be evaluated", () => {
    const r = forecastCoverage({ ...base, slots: [], containers: [prep("1.2", "5000")], scheduleEvaluable: false });
    expect(r.status).toBe("unknown");
  });

  it("returns unknown when there are no slots at all", () => {
    const r = forecastCoverage({ ...base, slots: [], containers: [prep("1.2", "5000")] });
    expect(r.status).toBe("unknown");
  });

  // 5 — a future start consumes nothing before it; depletion shifts out by the gap.
  it("consumes nothing before the first slot", () => {
    const slots: ForecastSlot[] = Array.from({ length: 10 }, (_, i) => ({
      date: day(44 + i), // starts 44 days out
      perInjectionValue: "1000",
      perInjectionUnit: "mcg" as const,
    }));
    const r = forecastCoverage({ ...base, slots, containers: [prep("1.2", "5000")] });
    expect(r.coverageDays).toBe(49); // 44 dead days, last of 6 doses on day 49
    expect(r.status).toBe("ok"); // 49 > lead(14)+buffer(3)
  });

  // 6 — titration: escalating doses drain faster than the opening dose implies.
  it("charges each slot its own dose when titrating", () => {
    const slots: ForecastSlot[] = [
      { date: day(1), perInjectionValue: "250", perInjectionUnit: "mcg" },
      { date: day(2), perInjectionValue: "250", perInjectionUnit: "mcg" },
      ...Array.from({ length: 20 }, (_, i) => ({
        date: day(3 + i),
        perInjectionValue: "2000",
        perInjectionUnit: "mcg" as const,
      })),
    ];
    // 1.0 mL @ 5000. 0.05+0.05 then 0.4s => 2 small + 2 large served; slot 5 strands.
    const r = forecastCoverage({ ...base, slots, containers: [prep("1.0", "5000")] });
    expect(r.coverageDays).toBe(4);
  });

  // 7 — R14: consumption must match the LOGGER, which decrements the rounded draw.
  it("costs a dose at the syringe-rounded volume, not the nominal volume", () => {
    // 2.0 mL @ 7500 mcg/mL, 500 mcg => nominal 30 doses, rounded 28.
    const r = forecastCoverage({ ...base, slots: dailySlots(60, "500"), containers: [prep("2.0", "7500")] });
    expect(r.coverageDays).toBe(28);
  });

  // 8 — R16: float subtraction loses a dose here. Decimal must not.
  it("does not lose a dose to floating-point drift", () => {
    // 0.3 mL @ 5000, 500 mcg = 0.1 mL/dose => exactly 3.
    const r = forecastCoverage({ ...base, slots: dailySlots(10, "500"), containers: [prep("0.3", "5000")] });
    expect(r.coverageDays).toBe(3);
  });

  // 9 — R11: the BUD gate. This is the ruling that reverses the error direction.
  it("stops drawing from a prep at its beyond-use date", () => {
    // 40 doses of stock, but the prep expires after 8 days.
    const r = forecastCoverage({
      ...base,
      slots: dailySlots(60, "250"),
      containers: [prep("2.0", "5000", day(8))],
    });
    expect(r.coverageDays).toBe(8); // last usable slot is the BUD day itself
    expect(r.status).toBe("reorder_now");
  });

  it("moves to the next container when the open prep expires", () => {
    const r = forecastCoverage({
      ...base,
      slots: dailySlots(60, "1000"),
      containers: [prep("2.0", "5000", day(3)), sealed("10")],
    });
    // 3 doses from the prep, then 10 from the sealed vial = 13.
    expect(r.coverageDays).toBe(13);
  });

  // 10 — R12: the resolver's deliberate "" fail-safe must not reach Decimal.
  it("returns unknown on the empty-string dose sentinel", () => {
    const r = forecastCoverage({ ...base, slots: dailySlots(10, ""), containers: [prep("1.2", "5000")] });
    expect(r.status).toBe("unknown");
  });

  // 11 — R29: an IU peptide (HCG, Somatropin) forecasts like any other. Its
  // numbers live on their own consistent scale, and `substanceClass` drives no
  // arithmetic anywhere in the app. Refusing it made the tile the only surface
  // that could not answer while the inventory page counted the same doses.
  it("forecasts an IU peptide instead of refusing it", () => {
    // 5000 IU vial reconstituted to 1 mL, 500 IU per dose => 10 doses.
    const r = forecastCoverage({ ...base, slots: dailySlots(30, "500"), containers: [prep("1.0", "5000")] });
    expect(r.status).toBe("reorder_now");
    expect(r.coverageDays).toBe(10);
  });

  // 12 — D5: an ml dose cannot be sized against a sealed vial (no concentration).
  it("returns unknown for an ml dose with only sealed stock", () => {
    const r = forecastCoverage({ ...base, slots: dailySlots(10, "0.2", "ml"), containers: [sealed("10")] });
    expect(r.status).toBe("unknown");
  });

  it("sizes an ml dose against an open prep", () => {
    const r = forecastCoverage({ ...base, slots: dailySlots(10, "0.2", "ml"), containers: [prep("1.2", "5000")] });
    expect(r.coverageDays).toBe(6);
  });

  // 13 — a stranded remainder is not usable by the next dose.
  it("strands a remainder too small to serve the next dose", () => {
    // 0.25 mL @ 5000 with a 0.1 mL dose => 2 doses, 0.05 mL stranded.
    const r = forecastCoverage({ ...base, slots: dailySlots(10, "500"), containers: [prep("0.25", "5000")] });
    expect(r.coverageDays).toBe(2); // 2 served, 0.05 mL stranded
  });

  // 14 — R2: surviving the horizon is `covered`, never a null-shaped `ok`.
  it("reports covered/horizon when stock outlives the horizon", () => {
    const r = forecastCoverage({ ...base, budDaysForSealed: 3650, slots: dailySlots(400, "10"), containers: [sealed("50")] });
    expect(r.status).toBe("covered");
    expect(r.coverageBasis).toBe("horizon");
  });

  // 15 — `ok` keeps its old invariant: every date field populated.
  it("keeps ok fully populated so no consumer meets a new shape", () => {
    const r = forecastCoverage({ ...base, budDaysForSealed: 3650, slots: dailySlots(200, "1000"), containers: [sealed("50")] });
    expect(r.status).toBe("ok");
    expect(r.coverageDays).toBe(50);
    expect(r.depletionDate).not.toBeNull();
    expect(r.reorderByDate).not.toBeNull();
  });
});

describe("forecastCoverage — sealed vial beyond-use date (R11)", () => {
  // The extension I made beyond the reviewer's ask: a sealed vial opened
  // mid-walk starts its own BUD clock at the simulated open date. Without this,
  // a large sealed vial reads as months of cover that a 28-day BUD forbids.
  it("caps a sealed vial at its BUD from the simulated open date", () => {
    // 50 mg at 500 mcg = 100 doses by mass, but the BUD cuts it far shorter.
    // 29, not 28: bud.ts's rule is that the BUD day itself is still usable
    // ("use by the 11th" includes the 11th), so opening on day 1 with a 28-day
    // window covers day 1 through day 29 inclusive.
    const r = forecastCoverage({ ...base, slots: dailySlots(200, "500"), containers: [sealed("50")] });
    expect(r.coverageDays).toBe(29);
    expect(r.coverageBasis).toBe("depletion");
  });

  it("prefers a stamped expiry when it falls before the BUD", () => {
    const r = forecastCoverage({
      ...base,
      slots: dailySlots(200, "500"),
      containers: [{ ...sealed("50"), usableUntil: day(5) }],
    });
    expect(r.coverageDays).toBe(5);
  });
});

describe("forecastCoverage — review findings (must not regress)", () => {
  // A protocol whose end fell earlier THIS week still contributes a past
  // `pending` slot (status.ts returns pending for the final slot forever), so
  // the covered branch could report negative days in a 132px display font.
  it("never reports negative coverage", () => {
    const past: ForecastSlot[] = [
      { date: day(-4), perInjectionValue: "1000", perInjectionUnit: "mcg" },
      { date: day(-2), perInjectionValue: "1000", perInjectionUnit: "mcg" },
    ];
    const r = forecastCoverage({
      ...base,
      slots: past,
      containers: [prep("1.2", "5000")],
      stopReason: "course_end",
      courseEndDate: day(-2),
    });
    expect(r.status).toBe("covered");
    expect(r.coverageDays).toBe(0);
  });

  // A past depletion must not advertise a reorder-by date already behind us.
  it("clamps depletion dates to today", () => {
    const r = forecastCoverage({
      ...base,
      slots: [
        { date: day(-6), perInjectionValue: "1000", perInjectionUnit: "mcg" },
        { date: day(-5), perInjectionValue: "1000", perInjectionUnit: "mcg" },
      ],
      containers: [prep("0.2", "5000")], // 1 dose
    });
    expect(r.coverageDays).toBe(0);
    expect(r.depletionDate).toBe("2026-08-15");
    expect(r.reorderByDate).toBe("2026-08-15");
  });

  // One awkward container must not veto stock sitting behind it.
  it("skips a container it cannot size instead of failing the peptide", () => {
    // An ml dose cannot be sized against sealed stock, but the prep behind it
    // can serve every slot.
    const r = forecastCoverage({
      ...base,
      slots: dailySlots(10, "0.2", "ml"),
      containers: [sealed("10"), prep("1.2", "5000")],
    });
    expect(r.status).toBe("reorder_now");
    expect(r.coverageDays).toBe(6);
  });

  it("still reports unknown when NO container can size the dose", () => {
    const r = forecastCoverage({ ...base, slots: dailySlots(10, "0.2", "ml"), containers: [sealed("10")] });
    expect(r.status).toBe("unknown");
  });

  // Expired stock is understood stock — an empty shelf, not a data gap.
  it("reports depletion, not unknown, when the only vial has expired", () => {
    const r = forecastCoverage({
      ...base,
      slots: dailySlots(10),
      containers: [prep("2.0", "5000", day(-1))],
    });
    expect(r.status).toBe("reorder_now");
    expect(r.coverageDays).toBe(0);
  });

  // A vial too small for the current dose must not burn shelf life it never used.
  it("starts a sealed vial's BUD clock on the first real draw", () => {
    const slots: ForecastSlot[] = [
      { date: day(1), perInjectionValue: "5000", perInjectionUnit: "mcg" }, // too big for vial A
      { date: day(2), perInjectionValue: "1000", perInjectionUnit: "mcg" },
      { date: day(3), perInjectionValue: "1000", perInjectionUnit: "mcg" },
    ];
    // A holds 2000 mcg: it cannot serve slot 1, so its clock must not start there.
    const r = forecastCoverage({
      ...base,
      budDaysForSealed: 1,
      slots,
      containers: [sealed("2"), sealed("50")],
    });
    // Slot 1 is served by the big vial; slots 2 and 3 still find stock.
    expect(r.status).toBe("covered");
  });
});
