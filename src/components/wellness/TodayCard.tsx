/**
 * Today's wellness on the journal page. Shows today's Garmin data and, when it
 * has last night, Eight Sleep's — each in its own block, never mixed — read-only,
 * plus a collapsed manual log (WellnessDayPanel) — same pattern as the
 * month-calendar day modal: fields stay hidden behind an Add/Edit button, an
 * existing entry renders read-only, and sleep/weight are owned by a device when
 * one has them (sleep by Garmin or Eight Sleep, weight by Garmin).
 */
import type { WellnessLogDay } from "@/lib/wellness-log";
import { eightSleepHasSleep } from "@/lib/eight-sleep-series";
import { EightSleepBlock, GarminBlock, fmtDayKey, type EightSleepDay } from "./WellnessLog";
import { WellnessDayPanel } from "./WellnessDayPanel";

export function TodayCard({
  today,
  todayKey,
  hydrationTargetMl,
  symptoms,
  eightSleep,
}: {
  today?: WellnessLogDay;
  /** Eight Sleep's night that ended today, if any. */
  eightSleep?: EightSleepDay | null;
  todayKey: string;
  hydrationTargetMl?: number | null;
  symptoms?: readonly string[];
}) {
  const garmin = today?.garmin;
  const deviceHasSleep =
    (!!garmin && (garmin.sleepSeconds != null || garmin.sleepScore != null)) || eightSleepHasSleep(eightSleep);
  const garminHasWeight = !!garmin && garmin.weightKg != null;

  return (
    <div className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      <p className="font-medium tabular-nums">{fmtDayKey(todayKey)}</p>
      {garmin && <GarminBlock g={garmin} />}
      {eightSleep && <EightSleepBlock e={eightSleep} />}
      <WellnessDayPanel
        day={todayKey}
        existing={today?.manual ?? undefined}
        deviceHasSleep={deviceHasSleep}
        garminHasWeight={garminHasWeight}
        hydrationTargetMl={hydrationTargetMl ?? null}
        symptoms={symptoms}
      />
    </div>
  );
}
