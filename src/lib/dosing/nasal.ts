/**
 * Nasal-pump helpers — pure functions, no I/O, no framework.
 *
 * A nasal pump is a device row in `Syringe` with `deviceType = "pump"`. It is
 * mL-graduated; `increment` is the metered spray volume (e.g. 0.1 mL) and
 * `capacityMl` is the bottle fill. `computeDraw` already rounds any
 * mL-graduated device to its `increment`, so a pump gets whole-pump rounding
 * for free — these helpers only convert between the pump count shown in the
 * UI and the mL value the dosing engine actually works in.
 */
import Decimal from "decimal.js";

/** Convert a pump count to millilitres, given the pump's metered spray increment. Exact (Decimal). */
export function pumpsToMl(pumps: Decimal.Value, incrementMl: Decimal.Value): Decimal {
  return new Decimal(pumps).times(incrementMl);
}

/** Convert millilitres to a pump count, given the pump's metered spray increment. Exact (Decimal). */
export function mlToPumps(ml: Decimal.Value, incrementMl: Decimal.Value): Decimal {
  const inc = new Decimal(incrementMl);
  if (inc.lte(0)) throw new Error("Pump increment must be greater than zero");
  return new Decimal(ml).div(inc);
}

/** Patient-facing pump-count label: "1 pump" / "2 pumps". */
export function formatPumps(n: Decimal.Value): string {
  const d = new Decimal(n);
  return `${d.toString()} pump${d.eq(1) ? "" : "s"}`;
}
