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

/**
 * Display-only grouping: standard CRP and hs-CRP show as
 * ONE "CRP" row in the matrix, the trend cards and the panel deltas. The data keeps
 * the two assays as separate biomarkers; only these helpers combine them. Where a
 * panel holds both, the hs result is shown and the standard one goes in the note.
 */
export const CRP_GROUP = "CRP";
const HS_CRP = "CRP (hs)";
export const HS_CRP_NOTE = "hs-CRP — high-sensitivity assay";

/** Readable label for an assay listed in a hover note. */
const ASSAY_LABEL: ReadonlyMap<string, string> = new Map([
  [CRP_GROUP, "standard CRP"],
  [HS_CRP, "hs-CRP"],
]);

/** The bloodwork row a biomarker displays under. */
export function displayGroupName(biomarkerName: string): string {
  return biomarkerName === CRP_GROUP || biomarkerName === HS_CRP ? CRP_GROUP : biomarkerName;
}

/** Lower wins within a display group: hs-CRP beats standard CRP. */
function assayRank(biomarkerName: string): number {
  return biomarkerName === HS_CRP ? 0 : 1;
}

export interface DisplayPick<T> {
  /** The result the row shows. */
  item: T;
  /** Other results of the same panel in the same display group. */
  alternates: T[];
}

/**
 * One panel's results → one pick per display group, in first-seen order. The
 * preferred assay wins (ties keep the first); the rest become `alternates`.
 */
export function pickPerDisplayGroup<T>(items: readonly T[], nameOf: (t: T) => string): Map<string, DisplayPick<T>> {
  const out = new Map<string, DisplayPick<T>>();
  for (const it of items) {
    const group = displayGroupName(nameOf(it));
    const cur = out.get(group);
    if (!cur) out.set(group, { item: it, alternates: [] });
    else if (assayRank(nameOf(it)) < assayRank(nameOf(cur.item))) {
      out.set(group, { item: it, alternates: [cur.item, ...cur.alternates] });
    } else cur.alternates.push(it);
  }
  return out;
}

export interface AssayResult {
  biomarkerName: string;
  value: string;
  unit?: string | null;
}

/**
 * Hover note for a displayed result: names the hs assay, and lists any other
 * assay of the same row in that panel (e.g. "· standard CRP: <5 mg/L"). Null
 * when there is nothing to say.
 */
export function assayNote(biomarkerName: string, alternates: readonly AssayResult[]): string | null {
  const parts: string[] = [];
  if (biomarkerName === HS_CRP) parts.push(HS_CRP_NOTE);
  for (const a of alternates) {
    if (a.biomarkerName === biomarkerName) continue;
    parts.push(`${ASSAY_LABEL.get(a.biomarkerName) ?? a.biomarkerName}: ${a.value}${a.unit ? ` ${a.unit}` : ""}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export interface ResultForTrend {
  biomarkerName: string;
  collectedDate: Date;
  value: string;
  flag?: Flag | string | null;
  /** The panel this result came from: one point per panel per row. */
  panelId: string;
  unit?: string | null;
}

export interface TrendPoint {
  date: Date;
  value: number;
  flag: Flag | null;
  /** Hover note (hs-CRP assay), or null. */
  note: string | null;
}

export interface BiomarkerTrend {
  /** The display row name (standard CRP and hs-CRP share "CRP"). */
  biomarkerName: string;
  points: TrendPoint[];
}

/**
 * Group results per display row into numeric {date, value} series for charting.
 * Non-numeric values are skipped; rows left with no numeric points are dropped.
 * One point per panel per row (hs-CRP preferred over standard CRP). Points are
 * sorted oldest → newest; rows sorted by name.
 */
export function trendSeries(results: ResultForTrend[]): BiomarkerTrend[] {
  const byPanel = new Map<string, ResultForTrend[]>();
  for (const r of results) {
    if (parseNumeric(r.value) == null) continue; // skip non-numeric (e.g. "Positive")
    byPanel.set(r.panelId, [...(byPanel.get(r.panelId) ?? []), r]);
  }

  const byName = new Map<string, TrendPoint[]>();
  for (const panelResults of byPanel.values()) {
    for (const [group, { item, alternates }] of pickPerDisplayGroup(panelResults, (r) => r.biomarkerName)) {
      const points = byName.get(group) ?? [];
      points.push({
        date: item.collectedDate,
        value: parseNumeric(item.value)!,
        flag: (item.flag as Flag | undefined) ?? null,
        note: assayNote(item.biomarkerName, alternates),
      });
      byName.set(group, points);
    }
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
 *  - `improving` = of the numeric latest results that also appear (by display
 *                row — see {@link displayGroupName}) in the prior panel with a numeric value, how many strictly reduced
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

  // One numeric result per display row on each side (hs-CRP and standard CRP pair
  // as "CRP"). Non-numeric values drop out before the pick, as in trendSeries, so
  // the summary counts the same reading the trend card plots.
  const nameOf = (r: PanelSummaryResult) => r.biomarkerName;
  const numeric = (rs: PanelSummaryResult[]) => rs.filter((r) => parseNumeric(r.value) != null);
  const priorByRow = pickPerDisplayGroup(numeric(prior ?? []), nameOf);

  for (const [row, { item: r }] of pickPerDisplayGroup(numeric(latest), nameOf)) {
    const n = parseNumeric(r.value)!;
    total += 1;

    const flag = r.flag ?? null;
    if (flag == null || flag === "normal") inRange += 1;

    const p = priorByRow.get(row)?.item;
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
