/**
 * Pure presentational chart math for the wellness/wearable charts — NO I/O, no
 * React, no DOM. Shared by the inline-SVG charts in src/components/wellness/*.
 * Mirrors the scale/path idiom used by PlasmaChart/MultiPlasmaChart but factors
 * out the null-handling bits that are worth unit-testing.
 */

export interface XY {
  x: number;
  y: number;
}

/** Min/max over an array of nullable numbers; null when no finite values. */
export function extent(
  values: (number | null | undefined)[],
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min === Infinity ? null : { min, max };
}

/**
 * Build an SVG path from points where `null` entries BREAK the line into
 * separate move-to subpaths, so gaps in the data are not bridged with a
 * misleading straight segment.
 */
export function buildLinePath(points: (XY | null)[]): string {
  let d = "";
  let penDown = false;
  for (const p of points) {
    if (p == null) {
      penDown = false;
      continue;
    }
    d += `${penDown ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)} `;
    penDown = true;
  }
  return d.trim();
}

/** Mean of the finite values, or null when there are none. */
export function average(values: (number | null | undefined)[]): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v != null && Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return n ? sum / n : null;
}

/** Last finite value in the array, or null. */
export function latestNonNull(
  values: (number | null | undefined)[],
): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

/** Seconds → hours, null-safe. */
export function secondsToHours(
  s: number | null | undefined,
): number | null {
  return s == null || !Number.isFinite(s) ? null : s / 3600;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Format a local "YYYY-MM-DD" day key (as produced by buildWearableSeries) into
 * a locale-independent "D Mon" label for chart axes. Parsing the string parts
 * (rather than `new Date(key)`) keeps the output identical on the SSR server and
 * in the browser — the same anti-hydration-mismatch tactic PlasmaChart uses.
 */
export function formatDayKeyShort(key: string): string {
  const [, m, d] = key.split("-").map((p) => Number(p));
  const month = MONTHS[(m ?? 1) - 1] ?? "";
  return `${d ?? ""} ${month}`.trim();
}
