/**
 * Multi-unit breakdown of a computed draw — pure, no I/O.
 *
 * Renders the TARGET dose (what's dialled, before syringe rounding) in all four
 * units so the syringe graphic can show mcg / mg / mL / units side-by-side.
 *
 * Source of every figure is the DrawResult from `computeDraw`, which itself
 * derives mass/volume from the safe resolver→canonicalise path — this function
 * NEVER touches a raw protocol/step dose, so it can't reintroduce a §6 overdose.
 *
 * `units` is syringe-dependent (rawUnits = targetVolumeMl × syringe.unitsPerMl),
 * so callers must recompute the breakdown when the selected syringe changes.
 * The `syringe` param is accepted for call-site symmetry / future use; the
 * unit count already lives in `draw.rawUnits` (computed against that syringe).
 */
import Decimal from "decimal.js";
import { mcgToMg } from "./engine";
import type { DrawResult, Syringe } from "./types";

export interface UnitBreakdown {
  mcg: string;
  mg: string;
  ml: string;
  units: string;
}

export function doseUnitBreakdown(draw: DrawResult, _syringe: Syringe): UnitBreakdown {
  // Keep everything in Decimal until the edge; stringify with trailing zeros
  // stripped (toString) so "0.50" → "0.5", "50.0" → "50".
  return {
    mcg: new Decimal(draw.targetMassMcg).toDecimalPlaces(1).toString(),
    mg: mcgToMg(draw.targetMassMcg).toDecimalPlaces(3).toString(),
    ml: new Decimal(draw.targetVolumeMl).toDecimalPlaces(3).toString(),
    units: new Decimal(draw.rawUnits).toDecimalPlaces(1).toString(),
  };
}
