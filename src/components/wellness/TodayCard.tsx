/**
 * Today's wellness on the journal page. Shows today's Garmin data read-only and
 * a collapsed manual log (WellnessDayPanel) — same pattern as the month-calendar
 * day modal: fields stay hidden behind an Add/Edit button, an existing entry
 * renders read-only, and sleep/weight are owned by Garmin when present.
 */
import type { WellnessLogDay } from "@/lib/wellness-log";
import { GarminBlock, fmtDayKey } from "./WellnessLog";
import { WellnessDayPanel } from "./WellnessDayPanel";

export function TodayCard({
  today,
  todayKey,
  hydrationTargetMl,
  symptoms,
}: {
  today?: WellnessLogDay;
  todayKey: string;
  hydrationTargetMl?: number | null;
  symptoms?: readonly string[];
}) {
  const garmin = today?.garmin;
  const garminHasSleep = !!garmin && (garmin.sleepSeconds != null || garmin.sleepScore != null);
  const garminHasWeight = !!garmin && garmin.weightKg != null;

  return (
    <div className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      <p className="font-medium tabular-nums">{fmtDayKey(todayKey)}</p>
      {garmin && <GarminBlock g={garmin} />}
      <WellnessDayPanel
        day={todayKey}
        existing={today?.manual ?? undefined}
        garminHasSleep={garminHasSleep}
        garminHasWeight={garminHasWeight}
        hydrationTargetMl={hydrationTargetMl ?? null}
        symptoms={symptoms}
      />
    </div>
  );
}
