"use client";

/**
 * Manual wellness log for a day inside the month calendar's DayDetail modal.
 * Collapsed by default — the form fields stay hidden behind an "Add log" /
 * "Edit log" button. An existing entry renders read-only (like the Garmin block)
 * until you choose to edit. Sleep/weight are omitted entirely when Garmin already
 * supplies them for the day (Garmin wins).
 */
import { useState } from "react";
import type { ManualDay } from "@/lib/wellness-log";
import { WellnessDayForm } from "./WellnessDayForm";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** Lightweight water-vs-target progress bar. */
function HydrationBar({ waterMl, targetMl }: { waterMl: number; targetMl: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((waterMl / targetMl) * 100)));
  return (
    <div className="col-span-2 sm:col-span-4">
      <div className="flex items-baseline justify-between">
        <dt className="text-xs text-muted">Water</dt>
        <dd className="text-xs font-medium tabular-nums">{waterMl} / {targetMl} mL</dd>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-bg ring-1 ring-line/15">
        <div className="h-full rounded-full bg-accent2 transition-all" style={{ width: `${pct}%` }} aria-hidden />
      </div>
    </div>
  );
}

export function WellnessDayPanel({
  day,
  existing,
  garminHasSleep,
  garminHasWeight,
  hydrationTargetMl,
  symptoms,
  onSaved,
}: {
  day: string;
  existing?: ManualDay;
  garminHasSleep: boolean;
  garminHasWeight: boolean;
  hydrationTargetMl?: number | null;
  symptoms?: readonly string[];
  onSaved?: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="mt-3 border-t border-line/10 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-accentStrong">
          {existing?.id ? "Edit log" : "Add log"}
        </p>
        <WellnessDayForm
          day={day}
          existing={existing}
          hideSleep={garminHasSleep}
          hideWeight={garminHasWeight}
          symptoms={symptoms}
          onSaved={() => {
            setEditing(false);
            onSaved?.();
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  // Manual values worth showing (sleep/weight suppressed when Garmin owns them).
  const showWeight = !garminHasWeight && existing?.weight != null;
  const showSleep = !garminHasSleep && existing?.sleep != null;
  const hasDisplayable =
    existing != null &&
    (showWeight || showSleep || existing.mood != null || existing.energy != null ||
      existing.calories != null || existing.proteinG != null || existing.waterMl != null ||
      !!existing.sideEffects || !!existing.notes);

  return (
    <div className="mt-3 border-t border-line/10 pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-accentStrong">Log</p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-control bg-bg px-3 py-1 text-xs font-medium ring-1 ring-line/15 hover:ring-line/30"
        >
          {hasDisplayable ? "Edit log" : "Add log"}
        </button>
      </div>
      {hasDisplayable ? (
        <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {showWeight && <Stat label="Weight" value={`${existing!.weight} ${existing!.weightUnit ?? ""}`.trim()} />}
          {existing!.mood != null && <Stat label="Mood" value={`${existing!.mood}/5`} />}
          {existing!.energy != null && <Stat label="Energy" value={`${existing!.energy}/5`} />}
          {showSleep && <Stat label="Sleep" value={`${existing!.sleep} h`} />}
          {existing!.calories != null && <Stat label="Calories" value={`${existing!.calories} kcal`} />}
          {existing!.proteinG != null && <Stat label="Protein" value={`${existing!.proteinG} g`} />}
          {existing!.waterMl != null && hydrationTargetMl && hydrationTargetMl > 0 ? (
            <HydrationBar waterMl={existing!.waterMl} targetMl={hydrationTargetMl} />
          ) : (
            existing!.waterMl != null && <Stat label="Water" value={`${existing!.waterMl} mL`} />
          )}
          {existing!.sideEffects && (
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-xs text-muted">Side effects</dt>
              <dd className="text-sm">{existing!.sideEffects}</dd>
            </div>
          )}
          {existing!.notes && (
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-xs text-muted">Notes</dt>
              <dd className="text-sm">{existing!.notes}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="mt-1 text-sm text-muted">No manual log for this day.</p>
      )}
    </div>
  );
}
