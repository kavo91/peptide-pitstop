/**
 * Helpers for overlaying multiple peptides' plasma curves on ONE chart.
 *
 * Type-only import of PlasmaPoint (erased at compile time) so this stays a pure,
 * dependency-free module that vitest can resolve without the @/ alias.
 */
import type { PlasmaPoint } from "./plasma";

/**
 * Normalise a plasma series to its OWN peak → levels in [0, 1].
 *
 * Each peptide is scaled independently because absolute mcg-equiv levels differ
 * by orders of magnitude across half-lives; plotting absolute would flatten a
 * short-half-life peptide into the baseline. Pure — no I/O, no mutation.
 *
 * - the peak sample → 1, others proportional
 * - all-zero / non-positive-peak series → all levels 0 (never NaN from /0)
 * - empty series → empty
 * Timestamps are preserved.
 */
export function normalizeToPeak(series: PlasmaPoint[]): PlasmaPoint[] {
  if (series.length === 0) return [];
  let peak = 0;
  for (const p of series) if (p.level > peak) peak = p.level;
  if (peak <= 0) return series.map((p) => ({ t: p.t, level: 0 }));
  return series.map((p) => ({ t: p.t, level: p.level / peak }));
}
