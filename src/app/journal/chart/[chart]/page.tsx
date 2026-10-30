/**
 * Per-chart detail view. Server loads a wide (90-day) window for one wearable
 * chart and projects it into selectable series; the client ChartDetail handles
 * range/series/smoothing controls. Invalid chart id → 404. The sleep chart also
 * shows one Eight Sleep night's bed/room temperature (`?night=YYYY-MM-DD`,
 * default the newest stored night).
 */
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/owner";
import { getEightSleepNightTemps, getEightSleepWindow, getWearableWindow } from "@/lib/wearable";
import { pairSleepNights, sleepCoverage } from "@/lib/sleep-pairs";
import { compareSleep, SLEEP_COMPARE_DAYS } from "@/lib/sleep-compare";
import { SleepCompareCard } from "@/components/wellness/SleepCompareCard";
import { showComparison } from "@/components/wellness/SleepExtraCards";
import { startOfDay } from "@/lib/schedule/schedule";
import { viewerTimeZone, viewerToday } from "@/lib/viewer-tz";
import { isChartId, CHART_CONFIG, buildChartSeries, sleepSeriesOptions } from "@/lib/chart-detail-config";
import { ChartDetail } from "@/components/wellness/ChartDetail";
import { BackButton } from "@/components/BackButton";
import { EightSleepNightTempChart } from "@/components/wellness/EightSleepNightTempChart";
import { pickNight } from "@/lib/eight-sleep-night-temps";

export const dynamic = "force-dynamic";

export default async function ChartDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ chart: string }>;
  searchParams: Promise<{ night?: string | string[] }>;
}) {
  const { chart } = await params;
  if (!isChartId(chart)) notFound();
  const user = await getCurrentUser();
  if (!user) return null;

  // Wide window — the client trims to 7/30/90/all from here. Anchored to the
  // VIEWER's day (v1.4.2), not the server clock.
  const viewer = await viewerToday();
  const to = viewer.date;
  const from = startOfDay(viewer.date);
  from.setDate(from.getDate() - 90);

  const isSleep = chart === "sleep";
  const [series, eightSleep] = await Promise.all([
    getWearableWindow(user.id, from, to),
    isSleep ? getEightSleepWindow(user.id, from, to) : Promise.resolve(undefined),
  ]);
  const cfg = CHART_CONFIG[chart];
  const data = buildChartSeries(chart, series, eightSleep);
  // Sleep reads Garmin and Eight Sleep together; every other chart is Garmin as before.
  const pairs = isSleep && eightSleep ? pairSleepNights(series, eightSleep) : [];
  const has = sleepCoverage(pairs);
  const options = isSleep ? sleepSeriesOptions(has) : cfg.series;
  const comparison = isSleep ? compareSleep(pairs) : undefined;
  const sources = isSleep && has.eightSleep ? (has.garmin ? "Garmin + Eight Sleep" : "Eight Sleep") : "Garmin";

  // One Eight Sleep night's temperature readings: only a stored night can be picked.
  const pick = pickNight(eightSleep?.nights.map((n) => n.date) ?? [], (await searchParams).night);
  const [temps, timeZone] = pick
    ? await Promise.all([getEightSleepNightTemps(user.id, pick.night), viewerTimeZone()])
    : [null, null];

  return (
    <main className="mx-auto max-w-md px-4 py-8 lg:max-w-3xl lg:px-8">
      <BackButton fallback="/journal" />
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{cfg.title}</h1>
        <p className="text-sm text-muted">{sources} · choose a range or focus a metric</p>
      </div>
      <ChartDetail chart={chart} series={series} options={options} data={data} eightSleep={eightSleep} />
      {pick && (
        <div className="mt-4">
          <EightSleepNightTempChart
            temps={temps}
            timeZone={timeZone ?? undefined}
            nav={{ ...pick, href: (n) => `/journal/chart/sleep?night=${n}` }}
          />
        </div>
      )}
      {showComparison(comparison) && (
        <div className="mt-4">
          <SleepCompareCard comparison={comparison} days={SLEEP_COMPARE_DAYS} />
        </div>
      )}
    </main>
  );
}
