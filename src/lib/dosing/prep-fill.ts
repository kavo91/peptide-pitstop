/**
 * The original fill volume of a preparation — pure. BAC water for a
 * reconstituted vial, else the prepared mass over its concentration. Used by
 * the logger to clamp a volume restore and by /inventory for the vial glyph.
 */
import Decimal from "decimal.js";

export function prepFillMl(prep: {
  prepType: string;
  bacWaterMl: Decimal.Value | { toString(): string } | null;
  totalMg: Decimal.Value | { toString(): string };
  concentrationMcgPerMl: Decimal.Value | { toString(): string };
}): Decimal {
  if (prep.prepType === "reconstituted" && prep.bacWaterMl) return new Decimal(prep.bacWaterMl.toString());
  // premixed (or missing bac): mass / concentration
  const conc = new Decimal(prep.concentrationMcgPerMl.toString());
  return conc.gt(0) ? new Decimal(prep.totalMg.toString()).times(1000).div(conc) : new Decimal(0);
}
