import { describe, it, expect } from "vitest";
import {
  allocateOverhead,
  vialCost,
  attributeDoseCosts,
  vialWaste,
  summariseConsumables,
  rollUpByPeptide,
  spendByMonth,
  costPerDose,
  usageMonths,
  resolveVialUnitCost,
  fmtMoney,
  fmtRate,
  type CostLineInput,
} from "@/lib/costs-core";

const line = (id: string, quantity: number, unitCost: string, kind: "peptide" | "consumable" = "peptide"): CostLineInput => ({
  id,
  kind,
  quantity,
  unitCost,
});

describe("allocateOverhead", () => {
  it("spreads shipping pro-rata on value across a multi-vial invoice", () => {
    // $200 of BPC + $100 of Tesa, $30 shipping → 2:1 split.
    const r = allocateOverhead({
      lines: [line("a", 2, "100"), line("b", 1, "100")],
      shippingCost: "30",
      method: "value",
    });
    expect(r.lines[0].allocated).toBe("20.00");
    expect(r.lines[1].allocated).toBe("10.00");
    expect(r.lines[0].landed).toBe("220.00");
    // Two vials on line a → each vial carries half its line's landed cost.
    expect(r.lines[0].landedUnit).toBe("110");
    expect(r.total).toBe("330.00");
    expect(r.unallocated).toBe("0.00");
    expect(r.effectiveMethod).toBe("value");
  });

  it("spreads equally per UNIT under the quantity method, not per line", () => {
    // 3 vials on one line, 1 on another, $20 shipping → $5/unit.
    const r = allocateOverhead({
      lines: [line("a", 3, "40"), line("b", 1, "90")],
      shippingCost: "20",
      method: "quantity",
    });
    expect(r.lines[0].allocated).toBe("15.00");
    expect(r.lines[1].allocated).toBe("5.00");
    expect(r.lines[0].landedUnit).toBe("45");
    expect(r.lines[1].landedUnit).toBe("95");
  });

  it("allocates EXACTLY — the rounding residual lands on the biggest line", () => {
    // $10 over three equal lines: 3.33 + 3.33 + 3.33 = 9.99. The lost cent must
    // not vanish, or the invoice stops reconciling.
    const r = allocateOverhead({
      lines: [line("a", 1, "10"), line("b", 1, "10"), line("c", 1, "10")],
      shippingCost: "10",
      method: "value",
    });
    const sum = r.lines.reduce((t, l) => t + Number(l.allocated), 0);
    expect(sum.toFixed(2)).toBe("10.00");
    expect(r.total).toBe("40.00");
  });

  it("folds tax and fees in, and nets the discount off", () => {
    const r = allocateOverhead({
      lines: [line("a", 1, "100")],
      shippingCost: "10",
      taxCost: "5",
      otherFees: "2.50",
      discount: "7.50",
      method: "value",
    });
    expect(r.overhead).toBe("10.00");
    expect(r.lines[0].landed).toBe("110.00");
  });

  it("handles a discount larger than the shipping (negative overhead)", () => {
    const r = allocateOverhead({
      lines: [line("a", 1, "100"), line("b", 1, "100")],
      shippingCost: "10",
      discount: "50",
      method: "value",
    });
    expect(r.overhead).toBe("-40.00");
    expect(r.lines[0].allocated).toBe("-20.00");
    expect(r.total).toBe("160.00");
  });

  it("method 'none' leaves overhead unallocated but still in the invoice total", () => {
    const r = allocateOverhead({
      lines: [line("a", 1, "100")],
      shippingCost: "25",
      method: "none",
    });
    expect(r.lines[0].allocated).toBe("0.00");
    expect(r.lines[0].landed).toBe("100.00");
    expect(r.unallocated).toBe("25.00");
    expect(r.total).toBe("125.00");
  });

  it("falls back to unit count when value allocation has no value to spread on", () => {
    // A free-sample order that only cost shipping.
    const r = allocateOverhead({
      lines: [line("a", 2, "0"), line("b", 2, "0")],
      shippingCost: "20",
      method: "value",
    });
    expect(r.effectiveMethod).toBe("quantity-fallback");
    expect(r.lines[0].allocated).toBe("10.00");
    expect(r.lines[1].allocated).toBe("10.00");
  });

  it("leaves overhead unallocated when there is no basis at all", () => {
    const r = allocateOverhead({ lines: [line("a", 0, "0")], shippingCost: "9", method: "value" });
    expect(r.unallocated).toBe("9.00");
    expect(r.total).toBe("9.00");
  });

  it("returns a null landedUnit rather than dividing by zero quantity", () => {
    const r = allocateOverhead({ lines: [line("a", 0, "50")], shippingCost: "0", method: "value" });
    expect(r.lines[0].landedUnit).toBeNull();
  });

  it("reports zero overhead as fully allocated, not as unallocated", () => {
    const r = allocateOverhead({ lines: [line("a", 1, "10")], method: "value" });
    expect(r.unallocated).toBe("0.00");
    expect(r.total).toBe("10.00");
  });

  it("mixes peptide and consumable lines in one invoice", () => {
    // Shipping is shared by the vials AND the needles that shipped with them.
    const r = allocateOverhead({
      lines: [line("vials", 1, "150"), line("needles", 1, "50", "consumable")],
      shippingCost: "20",
      method: "value",
    });
    expect(r.lines[0].allocated).toBe("15.00");
    expect(r.lines[1].allocated).toBe("5.00");
  });
});

describe("vialCost", () => {
  it("derives the per-mcg rate from the landed unit cost", () => {
    const v = vialCost({
      vialId: "v1",
      peptideId: "p1",
      peptideName: "BPC-157",
      labelStrengthMg: "10",
      status: "in_use",
      landedUnitCost: "40",
    });
    expect(v.costPerMg).toBe("4");
    expect(v.costPerMcg).toBe("0.004");
    expect(v.labelMcg).toBe("10000");
  });

  it("stays null for an uncosted vial — never assumes free", () => {
    const v = vialCost({
      vialId: "v1",
      peptideId: "p1",
      peptideName: "BPC-157",
      labelStrengthMg: "10",
      status: "sealed",
      landedUnitCost: null,
    });
    expect(v.costPerMcg).toBeNull();
    expect(v.landedCost).toBeNull();
  });

  it("returns null rates for a zero-strength vial instead of dividing by zero", () => {
    const v = vialCost({
      vialId: "v1",
      peptideId: "p1",
      peptideName: "X",
      labelStrengthMg: "0",
      status: "in_use",
      landedUnitCost: "40",
    });
    expect(v.costPerMcg).toBeNull();
  });
});

describe("resolveVialUnitCost — invoice wins, prescription fills gaps", () => {
  it("uses the invoice when one is matched", () => {
    // The same money is routinely entered twice — the script when it is
    // written, the invoice when the order arrives. Taking the invoice makes
    // double counting impossible by construction.
    const r = resolveVialUnitCost({ invoiceLandedUnit: "399", prescriptionCost: "399" });
    expect(r).toEqual({ value: "399", source: "invoice" });
  });

  it("prefers the invoice even when the two disagree", () => {
    const r = resolveVialUnitCost({ invoiceLandedUnit: "106", prescriptionCost: "278" });
    expect(r.value).toBe("106");
    expect(r.source).toBe("invoice");
  });

  it("falls back to the prescription when no invoice line is matched", () => {
    const r = resolveVialUnitCost({ invoiceLandedUnit: null, prescriptionCost: "278" });
    expect(r).toEqual({ value: "278", source: "prescription" });
  });

  it("reads Prescription.cost as the cost of ONE vial, not the script total", () => {
    // A script covering a two-cartridge order records 278 with quantity 2
    // against a 556 invoice — 278 IS the per-cartridge price. Dividing by
    // quantity would halve it.
    const r = resolveVialUnitCost({ invoiceLandedUnit: null, prescriptionCost: "278" });
    expect(r.value).toBe("278");
  });

  it("stays uncosted when neither source has a figure", () => {
    expect(resolveVialUnitCost({ invoiceLandedUnit: null, prescriptionCost: null })).toEqual({
      value: null,
      source: null,
    });
  });

  it("ignores a zero or unparseable prescription cost rather than pricing a vial at nothing", () => {
    expect(resolveVialUnitCost({ invoiceLandedUnit: null, prescriptionCost: "0" }).value).toBeNull();
    expect(resolveVialUnitCost({ invoiceLandedUnit: null, prescriptionCost: "abc" }).value).toBeNull();
    expect(resolveVialUnitCost({ invoiceLandedUnit: null, prescriptionCost: "" }).value).toBeNull();
  });

  it("keeps a genuinely free invoiced vial at zero — an invoice of 0 is data, not absence", () => {
    const r = resolveVialUnitCost({ invoiceLandedUnit: "0", prescriptionCost: "278" });
    expect(r).toEqual({ value: "0", source: "invoice" });
  });
});

describe("vialCost cost source", () => {
  it("tags a prescription-derived cost so it can be shown as an estimate", () => {
    const v = vialCost({
      vialId: "v1", peptideId: "p1", peptideName: "Tesamorelin", labelStrengthMg: "10",
      status: "in_use", landedUnitCost: "278", costSource: "prescription",
    });
    expect(v.costSource).toBe("prescription");
    expect(v.costPerMg).toBe("27.8");
  });

  it("defaults to invoice when a cost is given without a source", () => {
    const v = vialCost({
      vialId: "v1", peptideId: "p1", peptideName: "X", labelStrengthMg: "10",
      status: "in_use", landedUnitCost: "40",
    });
    expect(v.costSource).toBe("invoice");
  });

  it("leaves the source null when the vial is uncosted", () => {
    const v = vialCost({
      vialId: "v1", peptideId: "p1", peptideName: "X", labelStrengthMg: "10",
      status: "sealed", landedUnitCost: null,
    });
    expect(v.costSource).toBeNull();
  });
});

describe("attributeDoseCosts", () => {
  const vials = [
    vialCost({ vialId: "v1", peptideId: "p1", peptideName: "BPC-157", labelStrengthMg: "10", status: "in_use", landedUnitCost: "40" }),
    vialCost({ vialId: "v2", peptideId: "p2", peptideName: "Tesa", labelStrengthMg: "10", status: "in_use", landedUnitCost: null }),
  ];

  it("charges each dose at its own vial's rate, by delivered mass", () => {
    const out = attributeDoseCosts(
      [
        { doseLogId: "d1", peptideId: "p1", vialId: "v1", dayKey: "2026-08-01", doseMcg: "250" },
        { doseLogId: "d2", peptideId: "p1", vialId: "v1", dayKey: "2026-08-02", doseMcg: "500" },
      ],
      vials,
    );
    expect(out[0].cost).toBe("1");
    expect(out[1].cost).toBe("2");
  });

  it("leaves doses from uncosted or unknown vials null", () => {
    const out = attributeDoseCosts(
      [
        { doseLogId: "d1", peptideId: "p2", vialId: "v2", dayKey: "2026-08-01", doseMcg: "250" },
        { doseLogId: "d2", peptideId: "p1", vialId: null, dayKey: "2026-08-01", doseMcg: "250" },
        { doseLogId: "d3", peptideId: "p1", vialId: "gone", dayKey: "2026-08-01", doseMcg: "250" },
      ],
      vials,
    );
    expect(out.map((o) => o.cost)).toEqual([null, null, null]);
  });
});

describe("vialWaste", () => {
  const finished = vialCost({ vialId: "v1", peptideId: "p1", peptideName: "BPC-157", labelStrengthMg: "10", status: "finished", landedUnitCost: "40" });
  const inUse = vialCost({ vialId: "v2", peptideId: "p1", peptideName: "BPC-157", labelStrengthMg: "10", status: "in_use", landedUnitCost: "40" });

  it("values the mass an abandoned vial never delivered", () => {
    // 10mg vial, 5mg delivered (50% used, so below the utilisation threshold)
    // → 5mg wasted at $4/mg = $20.
    const doses = attributeDoseCosts(
      [{ doseLogId: "d1", peptideId: "p1", vialId: "v1", dayKey: "2026-08-01", doseMcg: "5000" }],
      [finished],
    );
    const w = vialWaste({ vials: [finished], doses });
    expect(w.total).toBe("20.00");
    expect(w.byVial[0].wastePct).toBe(50);
  });

  it("ignores in-use and sealed vials — unused mass there is inventory, not waste", () => {
    const w = vialWaste({ vials: [inUse], doses: [] });
    expect(w.total).toBe("0.00");
    expect(w.byVial).toEqual([]);
  });

  it("clamps overdraw at zero rather than reporting negative waste", () => {
    const doses = attributeDoseCosts(
      [{ doseLogId: "d1", peptideId: "p1", vialId: "v1", dayKey: "2026-08-01", doseMcg: "11000" }],
      [finished],
    );
    const w = vialWaste({ vials: [finished], doses });
    expect(w.total).toBe("0.00");
  });

  it("ignores a well-used vial — over 70% delivered is not waste", () => {
    // 10mg vial, 9.4mg delivered (94% used). Dead volume and last-draw
    // remainder, not waste; counting it buries the real losses in noise.
    const doses = attributeDoseCosts(
      [{ doseLogId: "d1", peptideId: "p1", vialId: "v1", dayKey: "2026-08-01", doseMcg: "9400" }],
      [finished],
    );
    const w = vialWaste({ vials: [finished], doses });
    expect(w.total).toBe("0.00");
    expect(w.byVial).toEqual([]);
  });

  it("still ignores a vial at 71% used, just above the line", () => {
    const doses = attributeDoseCosts(
      [{ doseLogId: "d1", peptideId: "p1", vialId: "v1", dayKey: "2026-08-01", doseMcg: "7100" }],
      [finished],
    );
    expect(vialWaste({ vials: [finished], doses }).total).toBe("0.00");
  });

  it("counts the WHOLE unused share once utilisation drops to 70% or below", () => {
    // 10mg vial, 7mg delivered (70% used) → waste is the full 30% × $40 = $12.00,
    // NOT the shortfall below the threshold.
    const doses = attributeDoseCosts(
      [{ doseLogId: "d1", peptideId: "p1", vialId: "v1", dayKey: "2026-08-01", doseMcg: "7000" }],
      [finished],
    );
    const w = vialWaste({ vials: [finished], doses });
    expect(w.total).toBe("12.00");
    expect(w.byVial[0].wastePct).toBe(30);
  });

  it("skips uncosted vials", () => {
    const uncosted = vialCost({ vialId: "v3", peptideId: "p1", peptideName: "X", labelStrengthMg: "10", status: "finished", landedUnitCost: null });
    expect(vialWaste({ vials: [uncosted], doses: [] }).byVial).toEqual([]);
  });
});

describe("summariseConsumables", () => {
  const lines = [
    // 1 box of 100 needles, landed $30 → $0.30 each, 1 per injection.
    { category: "needle", description: "29g needles", quantity: 1, unitsPerPack: 100, unitsPerDose: "1", landed: "30" },
    // 2 packs of 200 swabs, landed $10 → $0.025 each, 2 per injection.
    { category: "swab", description: "alcohol swabs", quantity: 2, unitsPerPack: 200, unitsPerDose: "2", landed: "10" },
    // A sharps container: bought once, no per-dose model.
    { category: "sharps_container", description: "1.4L sharps bin", quantity: 1, unitsPerPack: 1, unitsPerDose: null, landed: "12" },
  ];

  it("totals spend and derives a per-piece cost per category", () => {
    const s = summariseConsumables({ lines, doseCount: 100 });
    expect(s.totalSpend).toBe("52.00");
    const needles = s.byCategory.find((c) => c.category === "needle")!;
    expect(needles.pieces).toBe(100);
    expect(needles.costPerPiece).toBe("0.3");
    expect(needles.label).toBe("Needles");
  });

  it("models the consumable cost of ONE injection from declared units-per-dose", () => {
    // 1 needle @ $0.30 + 2 swabs @ $0.025 = $0.35. The sharps bin has no
    // unitsPerDose so it contributes to amortised only.
    const s = summariseConsumables({ lines, doseCount: 100 });
    expect(Number(s.modelledPerDose).toFixed(4)).toBe("0.3500");
  });

  it("amortises the whole consumable spend over the window's doses", () => {
    const s = summariseConsumables({ lines, doseCount: 100 });
    expect(s.amortisedPerDose).toBe("0.52");
  });

  it("returns nulls rather than zeros when nothing can be derived", () => {
    const s = summariseConsumables({ lines: [], doseCount: 0 });
    expect(s.modelledPerDose).toBeNull();
    expect(s.amortisedPerDose).toBeNull();
    expect(s.totalSpend).toBe("0.00");
  });

  it("buckets an unknown category under 'other' instead of dropping the spend", () => {
    const s = summariseConsumables({
      lines: [{ category: "gauze", description: "?", quantity: 1, unitsPerPack: null, unitsPerDose: null, landed: "5" }],
      doseCount: 1,
    });
    expect(s.byCategory[0].category).toBe("other");
    expect(s.totalSpend).toBe("5.00");
  });
});

describe("rollUpByPeptide", () => {
  const vials = [
    vialCost({ vialId: "v1", peptideId: "p1", peptideName: "BPC-157", labelStrengthMg: "10", status: "in_use", landedUnitCost: "40" }),
    vialCost({ vialId: "v2", peptideId: "p2", peptideName: "Tesa", labelStrengthMg: "10", status: "in_use", landedUnitCost: null }),
  ];
  const doses = attributeDoseCosts(
    [
      { doseLogId: "d1", peptideId: "p1", vialId: "v1", dayKey: "2026-08-01", doseMcg: "250" },
      { doseLogId: "d2", peptideId: "p1", vialId: "v1", dayKey: "2026-08-02", doseMcg: "250" },
      { doseLogId: "d3", peptideId: "p2", vialId: "v2", dayKey: "2026-08-02", doseMcg: "1000" },
    ],
    vials,
  );

  it("reports usage-attributed cost per dose and per mg", () => {
    const rows = rollUpByPeptide({
      doses,
      spendByPeptide: new Map([["p1", "40"]]),
      names: new Map([["p1", "BPC-157"], ["p2", "Tesa"]]),
    });
    const bpc = rows.find((r) => r.peptideId === "p1")!;
    expect(bpc.doseCount).toBe(2);
    expect(bpc.deliveredMg).toBe("0.5");
    expect(bpc.deliveredCost).toBe("2.00");
    expect(bpc.costPerDose).toBe("1");
    expect(bpc.costPerMg).toBe("4");
  });

  it("counts uncosted doses separately instead of averaging them in as free", () => {
    const rows = rollUpByPeptide({
      doses,
      spendByPeptide: new Map(),
      names: new Map([["p2", "Tesa"]]),
    });
    const tesa = rows.find((r) => r.peptideId === "p2")!;
    expect(tesa.uncostedDoses).toBe(1);
    expect(tesa.doseCount).toBe(0);
    expect(tesa.costPerDose).toBeNull();
  });

  it("includes a peptide that was bought but not yet dosed", () => {
    const rows = rollUpByPeptide({
      doses: [],
      spendByPeptide: new Map([["p9", "120"]]),
      names: new Map([["p9", "Retatrutide"]]),
    });
    expect(rows[0].spend).toBe("120.00");
    expect(rows[0].doseCount).toBe(0);
  });
});

describe("spendByMonth", () => {
  it("aggregates invoices into ascending months", () => {
    const out = spendByMonth([
      { monthKey: "2026-07", peptideSubtotal: "100", consumableSubtotal: "20", overhead: "15" },
      { monthKey: "2026-06", peptideSubtotal: "50", consumableSubtotal: "0", overhead: "10" },
      { monthKey: "2026-07", peptideSubtotal: "80", consumableSubtotal: "0", overhead: "0" },
    ]);
    expect(out.map((m) => m.monthKey)).toEqual(["2026-06", "2026-07"]);
    expect(out[1].peptide).toBe("180.00");
    expect(out[1].total).toBe("215.00");
  });

  it("omits months with no invoices — no data is not $0", () => {
    const out = spendByMonth([{ monthKey: "2026-08", peptideSubtotal: "10", consumableSubtotal: "0", overhead: "0" }]);
    expect(out).toHaveLength(1);
  });
});

describe("costPerDose", () => {
  const modelled = summariseConsumables({
    lines: [{ category: "needle", description: "n", quantity: 1, unitsPerPack: 100, unitsPerDose: "1", landed: "30" }],
    doseCount: 60,
  });

  it("prefers the modelled consumable cost over the amortised one", () => {
    const r = costPerDose({ peptideCost: "60", doseCount: 60, consumables: modelled });
    expect(r.peptide).toBe("1");
    expect(r.consumable).toBe("0.3");
    expect(r.consumableBasis).toBe("modelled");
    expect(r.total).toBe("1.3");
  });

  it("falls back to amortising when no line declares a units-per-dose", () => {
    const amortisedOnly = summariseConsumables({
      lines: [{ category: "sharps_container", description: "bin", quantity: 1, unitsPerPack: 1, unitsPerDose: null, landed: "12" }],
      doseCount: 60,
    });
    const r = costPerDose({ peptideCost: "60", doseCount: 60, consumables: amortisedOnly });
    expect(r.consumableBasis).toBe("amortised");
    expect(r.consumable).toBe("0.2");
    expect(r.total).toBe("1.2");
  });

  it("reports null, not zero, when there is nothing to divide", () => {
    const empty = summariseConsumables({ lines: [], doseCount: 0 });
    const r = costPerDose({ peptideCost: "0", doseCount: 0, consumables: empty });
    expect(r.peptide).toBeNull();
    expect(r.total).toBeNull();
  });
});

describe("usageMonths", () => {
  it("divides by the span of actual use, not the window length", () => {
    // One week of dosing inside a 12-month window must not report a run rate
    // 52× too low.
    expect(usageMonths({ firstDayKey: "2026-08-08", todayKey: "2026-08-14", windowMonths: 12 })).toBe(1);
  });

  it("uses the real span once there is more than a month of it", () => {
    expect(usageMonths({ firstDayKey: "2026-02-14", todayKey: "2026-08-14", windowMonths: 12 })).toBe(6);
  });

  it("never exceeds the window", () => {
    expect(usageMonths({ firstDayKey: "2024-01-01", todayKey: "2026-08-14", windowMonths: 3 })).toBe(3);
  });

  it("falls back to the window when there is no usage at all", () => {
    expect(usageMonths({ firstDayKey: null, todayKey: "2026-08-14", windowMonths: 6 })).toBe(6);
  });

  it("floors at one month so a same-day span never inflates the rate", () => {
    expect(usageMonths({ firstDayKey: "2026-08-14", todayKey: "2026-08-14", windowMonths: null })).toBe(1);
  });
});

describe("formatters", () => {
  it("renders money at 2dp and rates at 3dp when sub-dollar", () => {
    expect(fmtMoney("40.5")).toBe("AUD 40.50");
    expect(fmtRate("0.004")).toBe("AUD 0.004");
    expect(fmtRate("4")).toBe("AUD 4.00");
    expect(fmtMoney(null)).toBe("—");
    expect(fmtRate("nonsense")).toBe("—");
  });
});
