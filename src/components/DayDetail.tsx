"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { createPortal } from "react-dom";
import { activityDisplay, fmtActivityDistance, fmtActivityDuration, type GarminActivity } from "@/lib/garmin-activity";
import type { TimelineEntry } from "@/lib/doses-timeline-core";
import type { DayMetric } from "@/lib/month-metrics";
import { STATUS_CHIP_CLASS, STATUS_DESCRIPTION, STATUS_LABEL } from "@/lib/timeline-status";
import type { ManualDay } from "@/lib/wellness-log";
import { WellnessDayPanel } from "@/components/wellness/WellnessDayPanel";
import { DeleteLogButton } from "@/components/DeleteLogButton";

/** Seconds → "7h 12m" (rounded to the nearest minute). */
function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function WellnessStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** A list of the day's logged Garmin workouts: icon · type · duration · distance. */
function ActivitiesList({ activities }: { activities: GarminActivity[] }) {
  if (activities.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1.5">
      {activities.map((a, i) => {
        const disp = activityDisplay(a.type);
        const Icon = disp.icon;
        const detail = [fmtActivityDuration(a.durationSec), a.distanceM != null ? fmtActivityDistance(a.distanceM) : null]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={i} className="flex items-center gap-2 text-sm">
            <Icon className={`h-4 w-4 shrink-0 ${disp.colorClass}`} aria-hidden />
            <span className="font-medium">{a.name || disp.label}</span>
            <span className="text-muted tabular-nums">{detail}</span>
          </li>
        );
      })}
    </ul>
  );
}

function WellnessSection({ metric }: { metric: DayMetric }) {
  const sleep =
    metric.sleepSeconds != null || metric.sleepScore != null
      ? [metric.sleepSeconds != null ? fmtDuration(metric.sleepSeconds) : null, metric.sleepScore != null ? `score ${metric.sleepScore}` : null].filter(Boolean).join(" · ")
      : null;
  const hasActivities = metric.activities.length > 0;
  const hasAny =
    metric.steps != null || metric.caloriesActive != null || metric.intensityMinutes != null ||
    sleep != null || metric.weightKg != null || metric.restingHr != null || metric.hrvMs != null ||
    metric.bodyBattery != null || hasActivities;
  if (!hasAny) return null;
  return (
    <div className="mt-3 border-t border-line/10 pt-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent2Strong">Wellness</p>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {metric.steps != null && <WellnessStat label="Steps" value={metric.steps.toLocaleString()} />}
        {sleep && <WellnessStat label="Sleep" value={sleep} />}
        {metric.caloriesActive != null && <WellnessStat label="Active cal" value={`${metric.caloriesActive}`} />}
        {metric.intensityMinutes != null && <WellnessStat label="Intensity" value={`${metric.intensityMinutes} min`} />}
        {metric.weightKg != null && <WellnessStat label="Weight" value={`${metric.weightKg} kg`} />}
        {metric.restingHr != null && <WellnessStat label="Resting HR" value={`${metric.restingHr} bpm`} />}
        {metric.hrvMs != null && <WellnessStat label="HRV" value={`${metric.hrvMs} ms`} />}
        {metric.bodyBattery != null && <WellnessStat label="Body Battery" value={`${metric.bodyBattery}`} />}
      </dl>
      {hasActivities && (
        <>
          <p className="mb-1 mt-3 text-xs text-muted">Workouts</p>
          <ActivitiesList activities={metric.activities} />
        </>
      )}
    </div>
  );
}

export function DayDetail({ date, entries, metric, wellness, editable, hydrationTargetMl, symptoms }: { date: string; entries: TimelineEntry[]; metric?: DayMetric; wellness?: ManualDay; editable?: boolean; hydrationTargetMl?: number | null; symptoms?: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const dayEntries = entries.filter((e) => e.date === date);
  return (
    <>
      <button type="button" aria-label="Day detail" onClick={() => setOpen(true)} className="absolute inset-0 z-[1]" />
      {open && typeof document !== "undefined" && createPortal(
        // Portalled to <body> so a faded (opacity-55) future-day cell doesn't tint the modal.
        <div className="fixed inset-0 z-20 flex items-end bg-black/30" onClick={() => setOpen(false)}>
          <div className="mx-auto w-full max-w-md rounded-t-card bg-surface p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 font-medium">{new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
            {dayEntries.length === 0 && <p className="text-sm text-muted">No doses.</p>}
            <ul className="space-y-2">
              {dayEntries.map((e, i) => (
                <li key={i} className="flex items-center justify-between rounded-control bg-bg px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{e.peptideName}</span>
                    {e.time && <span className="ml-1.5 text-muted tabular-nums">{e.time}</span>}
                    {" "}<span className="text-muted">{e.doseLabel}</span>
                    {e.phaseIndex != null && <span className="text-muted"> · phase {e.phaseIndex + 1}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    {e.doseLogId && <Link href={`/log/${e.doseLogId}/edit`} className="text-xs font-medium text-accentStrong">Edit</Link>}
                    {e.doseLogId && <DeleteLogButton id={e.doseLogId} label={`${e.peptideName} dose`} />}
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_CHIP_CLASS[e.status]}`} title={STATUS_DESCRIPTION[e.status]}>{STATUS_LABEL[e.status]}</span>
                  </span>
                </li>
              ))}
            </ul>
            {metric && <WellnessSection metric={metric} />}
            {editable && (
              <WellnessDayPanel
                day={date}
                existing={wellness}
                garminHasSleep={!!metric && (metric.sleepSeconds != null || metric.sleepScore != null)}
                garminHasWeight={!!metric && metric.weightKg != null}
                hydrationTargetMl={hydrationTargetMl}
                symptoms={symptoms}
              />
            )}
            <button type="button" onClick={() => setOpen(false)} className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-control bg-bg py-2 text-sm ring-1 ring-line/15"><X className="h-4 w-4" aria-hidden /> Close</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
