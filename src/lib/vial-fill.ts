/**
 * How full a prepared vial is, for the Pitstop vial glyph — pure.
 */
import type { VialView } from "./inventory";

/**
 * Remaining fraction 0–1: remainingMl ÷ the prep's original fill. The fill is
 * `VialView.fillMl` (from `prepFillMl`, the logger's own rule: BAC water, else
 * the PREPARED mass ÷ conc). The label mass is only a fallback — the recon
 * wizard lets the entered mass differ from the label.
 */
export function vialFill(v: VialView): number {
  const conc = Number(v.concentrationMcgPerMl);
  const rem = Number(v.remainingMl);
  if (!conc || !Number.isFinite(conc) || !Number.isFinite(rem) || rem <= 0) return 0;
  const fill = v.fillMl != null ? Number(v.fillMl) : NaN;
  const initialMl = Number.isFinite(fill) && fill > 0 ? fill : (Number(v.labelStrengthMg) * 1000) / conc;
  if (!initialMl || !Number.isFinite(initialMl)) return 0;
  return Math.max(0, Math.min(1, rem / initialMl));
}
