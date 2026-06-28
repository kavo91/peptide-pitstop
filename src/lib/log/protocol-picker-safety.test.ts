/**
 * §6 OVERDOSE-GUARD REGRESSION LOCK for the dose-logging Protocol picker.
 *
 * The picker resolves a chosen protocol's per-injection dose and feeds it into
 * the syringe draw + multi-unit breakdown. This test pins the end-to-end chain:
 * a per_week 350 mcg/week protocol at 2×/week must surface 175 mcg (per
 * injection) — NEVER the raw 350 mcg weekly total — through both the option
 * builder AND the rendered syringe breakdown. A per_week protocol whose
 * injection frequency can't be resolved must surface a BLANK dose, never raw.
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { buildProtocolDoseOptions, type ProtocolForOptions } from "./protocol-options";
import { computeDraw } from "../dosing/engine";
import { doseUnitBreakdown } from "../dosing/unit-breakdown";
import type { Preparation, Syringe } from "../dosing/types";

const TWICE_WEEKLY = "FREQ=WEEKLY;BYDAY=MO,TH";
const NOW = new Date(2026, 0, 7);

const perWeek350: ProtocolForOptions = {
  id: "proto-pw",
  peptideId: "pep-1",
  peptideName: "Weekly Peptide",
  doseBasis: "per_week",
  targetDose: "350",
  doseInputUnit: "mcg",
  scheduleRule: TWICE_WEEKLY,
  rebaseMode: "fixed_anchor",
  startDate: null,
  endDate: null,
  adherenceWindowMin: 120,
  steps: [],
  deliveredLogs: [],
  activePreparationId: "prep-1",
};

const u100_1ml: Syringe = {
  name: "1 mL U-100", graduationType: "units", unitsPerMl: 100,
  capacityMl: 1, capacityUnits: 100, increment: 1,
};
// 1000 mcg/mL so 175 mcg → 0.175 mL → 17.5 units (clean to read).
const prep1000: Preparation = { prepType: "premixed", concentrationMcgPerMl: new Decimal(1000) };

describe("§6 picker overdose guard — per_week → per-injection, never raw weekly", () => {
  it("renders 175 mcg in the picker (NOT the raw 350)", () => {
    const [opt] = buildProtocolDoseOptions([perWeek350], NOW);
    expect(opt.doseValue).toBe("175");
    expect(opt.doseValue).not.toBe("350");

    // The picked value drives the syringe draw + breakdown the user sees.
    const draw = computeDraw({
      dose: { value: opt.doseValue, unit: opt.doseUnit },
      preparation: prep1000,
      syringe: u100_1ml,
    });
    const b = doseUnitBreakdown(draw, u100_1ml);
    expect(b.mcg).toBe("175"); // the rendered dose — per injection, never 350
    expect(b.mcg).not.toBe("350");
    expect(b.mg).toBe("0.175");
  });

  it("leaves the dose BLANK when injection frequency is unresolved (no raw weekly leak)", () => {
    const [opt] = buildProtocolDoseOptions([{ ...perWeek350, scheduleRule: null }], NOW);
    expect(opt.doseValue).toBe("");
    expect(opt.doseValue).not.toBe("350");
    // A blank dose yields no draw → submit stays disabled (the form guards on `draw`).
    expect(opt.doseValue === "" || new Decimal(opt.doseValue).gt(0)).toBe(true);
  });
});
