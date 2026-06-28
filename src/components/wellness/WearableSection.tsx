/**
 * "Wearable (Garmin)" section for the Wellness screen. Server component: takes
 * the precomputed WearableSeries and renders the sleep / recovery / body-comp /
 * activity charts (2-up on lg), or a tasteful empty state + Sync-now button when
 * no wearable data has synced yet. The Sync-now button lives in the header in
 * both states.
 */
import type { WearableSeries } from "@/lib/wearable-series";
import { SleepChart } from "./SleepChart";
import { RecoveryChart } from "./RecoveryChart";
import { BodyCompositionChart } from "./BodyCompositionChart";
import { ActivityChart } from "./ActivityChart";
import { SyncNowButton } from "./SyncNowButton";

export function WearableSection({ series }: { series: WearableSeries }) {
  const hasData = series.latestSnapshot != null;

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Wearable (Garmin)</h2>
          <p className="text-sm text-muted">
            {hasData ? "Last 7 days, synced from Garmin." : "Sleep, recovery, body and activity."}
          </p>
        </div>
        <SyncNowButton />
      </div>

      {!hasData ? (
        <div className="rounded-card bg-surface p-8 text-center shadow-sm ring-1 ring-line/10">
          <p className="text-sm font-medium text-ink">No wearable data yet</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
            Connect Garmin and run a sync to see your sleep, recovery, body composition and activity trends here.
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2 lg:items-stretch min-[1900px]:grid-cols-3">
          <SleepChart sleep={series.sleep} detailHref="/journal/chart/sleep" />
          <RecoveryChart recovery={series.recovery} detailHref="/journal/chart/recovery" />
          <BodyCompositionChart weight={series.weight} detailHref="/journal/chart/body" />
          <ActivityChart activity={series.activity} detailHref="/journal/chart/activity" />
        </div>
      )}
    </section>
  );
}
