/**
 * Per-chart detail view. Server loads a wide (90-day) window for one wearable
 * chart and projects it into selectable series; the client ChartDetail handles
 * range/series/smoothing controls. Invalid chart id → 404.
 */
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/owner";
import { getWearableWindow } from "@/lib/wearable";
import { startOfDay } from "@/lib/schedule/schedule";
import { isChartId, CHART_CONFIG, buildChartSeries } from "@/lib/chart-detail-config";
import { ChartDetail } from "@/components/wellness/ChartDetail";
import { BackButton } from "@/components/BackButton";

export const dynamic = "force-dynamic";

export default async function ChartDetailPage({ params }: { params: { chart: string } }) {
  if (!isChartId(params.chart)) notFound();
  const user = await getCurrentUser();
  if (!user) return null;

  // Wide window — the client trims to 7/30/90/all from here.
  const to = new Date();
  const from = startOfDay(new Date());
  from.setDate(from.getDate() - 90);

  const series = await getWearableWindow(user.id, from, to);
  const cfg = CHART_CONFIG[params.chart];
  const data = buildChartSeries(params.chart, series);

  return (
    <main className="mx-auto max-w-md px-4 py-8 lg:max-w-3xl lg:px-8">
      <BackButton fallback="/journal" />
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{cfg.title}</h1>
        <p className="text-sm text-muted">Garmin · choose a range or focus a metric</p>
      </div>
      <ChartDetail chart={params.chart} series={series} options={cfg.series} data={data} />
    </main>
  );
}
