/**
 * The prescription wizard shows a vial concentration in mg/mL and stores it in
 * mcg/mL. Pure — shared by `PrescriptionWizardForm` and its test.
 *
 * Decimal, through the dosing engine's `mgToMcg` / `mcgToMg`: float maths
 * stored 1.005 mg/mL as 1004.9999999999999 mcg/mL. The stored
 * value feeds the preparation snapshot, so it must be exact.
 */
import Decimal from "decimal.js";
import { mcgToMg, mgToMcg } from "./dosing/engine";

function parse(text: string): Decimal | null {
  try {
    const d = new Decimal(text);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** Stored mcg/mL → the mg/mL text the input shows. "" for blank or unparseable input. */
export function displayMgPerMlFromStoredMcg(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const mcg = parse(trimmed);
  return mcg ? mcgToMg(mcg).toFixed() : "";
}

/** Typed mg/mL → the mcg/mL text the wizard stores. Unparseable text passes through for the server to reject. */
export function storeMcgPerMlFromMgInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const mg = parse(trimmed);
  return mg ? mgToMcg(mg).toFixed() : trimmed;
}
