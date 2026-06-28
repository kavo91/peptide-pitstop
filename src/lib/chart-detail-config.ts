/** Per-chart configuration for the chart-detail view: which series a chart can
 *  plot on its Y-axis, and how to project the WearableSeries into plain
 *  { date, value } points the client controls can filter/smooth. Pure. */
import type { WearableSeries } from "@/lib/wearable-series";
import type { AggPoint } from "@/lib/wearable-aggregate";

export const CHART_IDS = ["sleep", "recovery", "body", "activity"] as const;
export type ChartId = (typeof CHART_IDS)[number];

export function isChartId(s: string): s is ChartId {
  return (CHART_IDS as readonly string[]).includes(s);
}

export interface SeriesOption {
  key: string;
  label: string;
}

export const CHART_CONFIG: Record<ChartId, { title: string; series: SeriesOption[] }> = {
  sleep: {
    title: "Sleep",
    series: [
      { key: "score", label: "Sleep score" },
      { key: "hours", label: "Sleep hours" },
    ],
  },
  recovery: {
    title: "Recovery",
    series: [
      { key: "bodyBatteryHigh", label: "Body Battery" },
      { key: "restingHr", label: "Resting HR" },
      { key: "hrvMs", label: "HRV" },
      { key: "stressAvg", label: "Stress" },
    ],
  },
  body: {
    title: "Body composition",
    series: [{ key: "weightKg", label: "Weight" }],
  },
  activity: {
    title: "Activity",
    series: [
      { key: "steps", label: "Steps" },
      { key: "vo2max", label: "VO₂max" },
      { key: "caloriesActive", label: "Active cal" },
      { key: "intensityMinutes", label: "Intensity min" },
    ],
  },
};

/** Total asleep hours for a night (deep+light+rem seconds → hours); null when no
 *  stage data is present. Excludes the awake band — time awake isn't "sleep". */
export function sleepHours(p: { deep: number | null; light: number | null; rem: number | null }): number | null {
  if (p.deep == null && p.light == null && p.rem == null) return null;
  return ((p.deep ?? 0) + (p.light ?? 0) + (p.rem ?? 0)) / 3600;
}

/** Project the WearableSeries into { seriesKey → AggPoint[] } for one chart. */
export function buildChartSeries(chart: ChartId, series: WearableSeries): Record<string, AggPoint[]> {
  switch (chart) {
    case "sleep":
      return {
        score: series.sleep.map((p) => ({ date: p.date, value: p.score })),
        hours: series.sleep.map((p) => ({ date: p.date, value: sleepHours(p) })),
      };
    case "recovery":
      return {
        bodyBatteryHigh: series.recovery.map((p) => ({ date: p.date, value: p.bodyBatteryHigh })),
        restingHr: series.recovery.map((p) => ({ date: p.date, value: p.restingHr })),
        hrvMs: series.recovery.map((p) => ({ date: p.date, value: p.hrvMs })),
        stressAvg: series.recovery.map((p) => ({ date: p.date, value: p.stressAvg })),
      };
    case "body":
      return {
        weightKg: series.weight.map((p) => ({ date: p.date, value: p.weightKg })),
      };
    case "activity":
      return {
        steps: series.activity.map((p) => ({ date: p.date, value: p.steps })),
        vo2max: series.activity.map((p) => ({ date: p.date, value: p.vo2max })),
        caloriesActive: series.activity.map((p) => ({ date: p.date, value: p.caloriesActive })),
        intensityMinutes: series.activity.map((p) => ({ date: p.date, value: p.intensityMinutes })),
      };
  }
}
