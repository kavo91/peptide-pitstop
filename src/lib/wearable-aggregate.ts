/** Pure range-filter + smoothing for the chart-detail view. Generic over any
 *  { date, value } point so every chart series can reuse it. */
export interface AggPoint {
  date: string;
  value: number | null;
}
export type Range = 7 | 30 | 90 | "all";

/** Keep the most recent `range` points (series is chronological ascending). */
export function filterByRange<T extends { date: string }>(points: readonly T[], range: Range): T[] {
  if (range === "all") return [...points];
  return points.slice(Math.max(0, points.length - range));
}

/** Trailing-window mean over `value`, null-skipping; returns the same length. */
export function rollingAverage(points: readonly AggPoint[], window: number): AggPoint[] {
  return points.map((p, i) => {
    const slice = points
      .slice(Math.max(0, i - window + 1), i + 1)
      .map((q) => q.value)
      .filter((v): v is number => v != null);
    return {
      date: p.date,
      value: slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null,
    };
  });
}
