/**
 * Pure, dependency-free bloodwork helpers — classification + trend shaping.
 *
 * Lab values are stored as opaque strings (encrypted) so the raw form can carry
 * censored results like "<3" or ">90". These helpers never touch the DB or
 * crypto; they operate on already-decrypted plain values and are unit-tested.
 *
 * Reference only — not medical advice.
 */

export type Flag = "low" | "normal" | "high" | "borderline";

/**
 * Extract a numeric magnitude from a lab value string. Handles censored/qualified
 * results by taking the first number found: "<3" → 3, ">90" → 90, "5.2" → 5.2,
 * "1,200" → 1200, "3.4 (H)" → 3.4. Returns null for non-numeric values
 * ("Positive", "", "Not detected").
 */
export function parseNumeric(value: string | null | undefined): number | null {
  if (value == null) return null;
  const m = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Classify a single result against its reference interval and (optional) optimal
 * target.
 *  - Outside the lab reference interval → "low" / "high".
 *  - Inside reference but outside the narrower optimal target → "borderline".
 *  - Inside both (or no bounds to fail) → "normal".
 *  - Non-numeric values can't be compared → "normal" (shown verbatim elsewhere).
 */
export function classifyFlag(
  value: string,
  refLow?: number | null,
  refHigh?: number | null,
  optimalLow?: number | null,
  optimalHigh?: number | null,
): Flag {
  const n = parseNumeric(value);
  if (n == null) return "normal";

  // Hard out-of-range against the lab's reference interval takes precedence.
  if (refLow != null && n < refLow) return "low";
  if (refHigh != null && n > refHigh) return "high";

  // Within reference (or no reference bound to fail) but outside optimal target.
  if (optimalLow != null && n < optimalLow) return "borderline";
  if (optimalHigh != null && n > optimalHigh) return "borderline";

  return "normal";
}

export interface ResultForTrend {
  biomarkerName: string;
  collectedDate: Date;
  value: string;
  flag?: Flag | string | null;
}

export interface TrendPoint {
  date: Date;
  value: number;
  flag: Flag | null;
}

export interface BiomarkerTrend {
  biomarkerName: string;
  points: TrendPoint[];
}

/**
 * Group results per biomarker into numeric {date, value} series for charting.
 * Non-numeric values are skipped; biomarkers left with no numeric points are
 * dropped. Points are sorted oldest → newest; biomarkers sorted by name.
 */
export function trendSeries(results: ResultForTrend[]): BiomarkerTrend[] {
  const byName = new Map<string, TrendPoint[]>();

  for (const r of results) {
    const value = parseNumeric(r.value);
    if (value == null) continue; // skip non-numeric (e.g. "Positive")
    const points = byName.get(r.biomarkerName) ?? [];
    points.push({
      date: r.collectedDate,
      value,
      flag: (r.flag as Flag | undefined) ?? null,
    });
    byName.set(r.biomarkerName, points);
  }

  return [...byName.entries()]
    .map(([biomarkerName, points]) => ({
      biomarkerName,
      points: points.sort((a, b) => a.date.getTime() - b.date.getTime()),
    }))
    .sort((a, b) => a.biomarkerName.localeCompare(b.biomarkerName));
}

/** A single decoded result row, as the bloodwork page assembles it for display. */
export interface PanelSummaryResult {
  biomarkerName: string;
  value: string;
  referenceLow?: number | null;
  referenceHigh?: number | null;
  flag?: Flag | string | null;
}

export interface PanelSummary {
  /** Results in the latest panel whose flag is normal/null (i.e. not out-of-range). */
  inRange: number;
  /** Numeric results in the latest panel (non-numeric values are excluded). */
  total: number;
  /** How many latest values moved *toward* their in-range/optimal zone vs the prior panel. */
  improving: number;
}

/**
 * Signed distance of a value from its acceptable interval. 0 ⇒ inside the
 * interval; positive ⇒ how far outside (below low, or above high). An open or
 * absent bound on a side never penalises that side. Used to decide whether a
 * reading moved *toward* being in-range between two panels.
 */
function distanceOutside(n: number, low?: number | null, high?: number | null): number {
  if (low != null && n < low) return low - n;
  if (high != null && n > high) return n - high;
  return 0;
}

/**
 * Summarise the latest lab panel against the immediately prior one.
 *
 * Heuristic:
 *  - `total`   = count of latest-panel results whose value parses as numeric.
 *  - `inRange` = of those, how many carry a flag of "normal" / null (i.e. not
 *                low / high / borderline). Flags are computed at write-time by
 *                {@link classifyFlag}; we trust them here rather than re-deriving.
 *  - `improving` = of the numeric latest results that also appear (by name) in
 *                the prior panel with a numeric value, how many strictly reduced
 *                their distance outside the reference interval — i.e. moved
 *                toward (or further into) the in-range zone. A reading already
 *                in range that stays in range does NOT count as "improving"
 *                (no room to improve toward); one that moves from out-of-range
 *                toward the interval, or from far-out to less-far-out, does.
 *
 * Gracefully handles a missing prior panel (`improving` = 0) and non-numeric
 * values (skipped from every count).
 */
export function panelSummary(
  latest: PanelSummaryResult[] | null | undefined,
  prior: PanelSummaryResult[] | null | undefined,
): PanelSummary {
  if (!latest || latest.length === 0) return { inRange: 0, total: 0, improving: 0 };

  let total = 0;
  let inRange = 0;
  let improving = 0;

  // Index the prior panel by biomarker name for O(1) pairing.
  const priorByName = new Map<string, PanelSummaryResult>();
  for (const r of prior ?? []) {
    if (!priorByName.has(r.biomarkerName)) priorByName.set(r.biomarkerName, r);
  }

  for (const r of latest) {
    const n = parseNumeric(r.value);
    if (n == null) continue; // non-numeric → not comparable
    total += 1;

    const flag = r.flag ?? null;
    if (flag == null || flag === "normal") inRange += 1;

    const p = priorByName.get(r.biomarkerName);
    if (!p) continue;
    const pn = parseNumeric(p.value);
    if (pn == null) continue;

    // Prefer the latest panel's reference interval; fall back to the prior's.
    const low = r.referenceLow ?? p.referenceLow ?? null;
    const high = r.referenceHigh ?? p.referenceHigh ?? null;
    const nowDist = distanceOutside(n, low, high);
    const priorDist = distanceOutside(pn, low, high);
    if (nowDist < priorDist) improving += 1; // moved toward in-range
  }

  return { inRange, total, improving };
}
