"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Save, X } from "lucide-react";
import { type WeekdayCode } from "@/lib/schedule/schedule";
import {
  parseSchedule,
  scheduleSummary,
  evenlySpacedDays,
  isWithinDoseWindow,
  DEFAULT_DOSE_TIME,
  type ScheduleEntry,
  type DayPattern,
} from "@/lib/schedule/entries";
import { updateStackSchedule } from "@/app/actions/stacks";

const field = "w-full rounded-control border border-line/15 bg-bg px-2.5 py-1.5 text-sm text-ink";
const DAYS: WeekdayCode[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/**
 * Compact, single-entry stack schedule editor. Reuses ProtocolForm's day-pattern
 * controls (Every day / Specific weekdays / N× per week / Every N days / Cycle)
 * and the shared schedule lib (parseSchedule, scheduleSummary, evenlySpacedDays,
 * isWithinDoseWindow). A stack carries ONE shared schedule, so this edits a single
 * ScheduleEntry plus a start date and saves to ALL component protocols via
 * updateStackSchedule. Times are not exposed (stack components are seeded untimed
 * by createStack); keeping it single-entry/untimed makes the control compact.
 *
 * A re-opened weekly schedule shows the "Specific weekdays" editor (preset flag
 * off) — same v1 behaviour ProtocolForm documents for the N×/week preset.
 */
export function StackScheduleEditor({
  stackId,
  scheduleRule,
  startDate,
}: {
  stackId: string;
  scheduleRule: string | null;
  startDate: string | null;
}) {
  const router = useRouter();
  const initial = parseSchedule(scheduleRule);
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState<ScheduleEntry>(initial[0] ?? { dayPattern: { kind: "daily" }, times: [] });
  const [start, setStart] = useState<string>(startDate ?? "");
  const [preset, setPreset] = useState(false);
  const [presetN, setPresetN] = useState(2);
  const [presetTime, setPresetTime] = useState(DEFAULT_DOSE_TIME);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const p = entry.dayPattern;
  const patternValid =
    p.kind === "weekly" ? p.byDays.length > 0
    : p.kind === "interval" ? p.everyDays > 0
    : p.kind === "cycle" ? p.onDays > 0 && p.onDays + p.offDays > 0
    : true;
  const presetTimeBad = preset && !isWithinDoseWindow(presetTime);
  // Interval/cycle patterns are undefined without an anchor date (entryDueOn
  // returns false), so block save until a start date is set — avoids a silently
  // never-due stack.
  const needsStart = (p.kind === "interval" || p.kind === "cycle") && !start.trim();
  const canSave = patternValid && !presetTimeBad && !needsStart && !busy;

  // Build the weekly entry the N×/week preset authors (clamped 1..7, time clamped
  // to the 06:00–20:00 dose window). Mirrors ProtocolForm.presetEntry.
  function buildPreset(n: number, time: string): ScheduleEntry {
    const safeN = Math.min(7, Math.max(1, n));
    const safeTime = isWithinDoseWindow(time) ? time : DEFAULT_DOSE_TIME;
    return { dayPattern: { kind: "weekly", byDays: evenlySpacedDays(safeN) }, times: [safeTime] };
  }

  function changeKind(choice: string) {
    if (choice === "perweek") {
      setPreset(true);
      setEntry(buildPreset(presetN, presetTime));
      return;
    }
    setPreset(false);
    const kind = choice as DayPattern["kind"];
    const next: DayPattern =
      kind === "daily" ? { kind: "daily" }
      : kind === "weekly" ? { kind: "weekly", byDays: [] }
      : kind === "interval" ? { kind: "interval", everyDays: 3 }
      : { kind: "cycle", onDays: 5, offDays: 2 };
    setEntry({ ...entry, dayPattern: next });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    const res = await updateStackSchedule(stackId, JSON.stringify([entry]), start);
    setBusy(false);
    if (!res.ok) {
      setErr(res.error ?? "Could not update schedule.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs">
        <CalendarClock className="h-3.5 w-3.5 text-muted" aria-hidden />
        <span className="text-muted">
          Schedule: <span className="text-ink">{scheduleSummary(parseSchedule(scheduleRule))}</span>
          {startDate ? ` · from ${startDate}` : ""}
        </span>
        <button type="button" onClick={() => setOpen(true)} className="font-medium text-accentStrong">Edit schedule</button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-control bg-bg p-2.5 text-xs ring-1 ring-line/10">
      <p className="font-medium">Stack schedule</p>
      <p className="text-muted">Applies to every component protocol in this stack.</p>

      <select className={field} aria-label="Day pattern" value={preset ? "perweek" : p.kind} onChange={(e) => changeKind(e.target.value)}>
        <option value="daily">Every day</option>
        <option value="weekly">Specific weekdays</option>
        <option value="perweek">N× per week (evenly spaced)</option>
        <option value="interval">Every N days</option>
        <option value="cycle">Cycle (on/off)</option>
      </select>

      {preset && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <label className="block flex-1 text-muted">Doses per week
              <input
                className={field + " mt-1"}
                type="number"
                inputMode="numeric"
                min={1}
                max={7}
                value={presetN}
                onChange={(e) => {
                  const val = Math.min(7, Math.max(1, parseInt(e.target.value, 10) || 1));
                  setPresetN(val);
                  setEntry(buildPreset(val, presetTime));
                }}
              />
            </label>
            <label className="block flex-1 text-muted">Time of day
              <input
                className={field + " mt-1"}
                type="time"
                min="06:00"
                max="20:00"
                value={presetTime}
                onChange={(e) => {
                  const val = e.target.value;
                  setPresetTime(val);
                  if (isWithinDoseWindow(val)) setEntry(buildPreset(presetN, val));
                }}
              />
            </label>
          </div>
          <p className="text-muted">Days: <span className="text-ink">{evenlySpacedDays(Math.min(7, Math.max(1, presetN))).join(", ")}</span></p>
          {presetTimeBad && <p className="text-warn">Time must be between 06:00 and 20:00.</p>}
        </div>
      )}

      {p.kind === "weekly" && !preset && (
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((day) => {
            const on = p.byDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() =>
                  setEntry({ ...entry, dayPattern: { kind: "weekly", byDays: on ? p.byDays.filter((x) => x !== day) : [...p.byDays, day] } })
                }
                className={`rounded-control px-2.5 py-1.5 font-medium ${on ? "bg-accent text-onAccent" : "bg-surface ring-1 ring-line/15"}`}
              >
                {day}
              </button>
            );
          })}
        </div>
      )}

      {p.kind === "interval" && (
        <label className="block text-muted">Every
          <input
            className={field + " mt-1"}
            inputMode="numeric"
            value={p.everyDays}
            onChange={(e) => setEntry({ ...entry, dayPattern: { kind: "interval", everyDays: Math.max(1, parseInt(e.target.value, 10) || 1) } })}
          /> days
        </label>
      )}

      {p.kind === "cycle" && (
        <div className="flex gap-2">
          <label className="block flex-1 text-muted">Days on
            <input
              className={field + " mt-1"}
              inputMode="numeric"
              min={1}
              value={p.onDays}
              onChange={(e) => setEntry({ ...entry, dayPattern: { ...p, onDays: Math.max(1, parseInt(e.target.value, 10) || 1) } })}
            />
          </label>
          <label className="block flex-1 text-muted">Days off
            <input
              className={field + " mt-1"}
              inputMode="numeric"
              min={1}
              value={p.offDays}
              onChange={(e) => setEntry({ ...entry, dayPattern: { ...p, offDays: Math.max(1, parseInt(e.target.value, 10) || 1) } })}
            />
          </label>
        </div>
      )}

      <label className="block text-muted">Start date
        <input className={field + " mt-1"} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>

      <p className="text-muted">Preview: <span className="text-ink">{scheduleSummary([entry])}</span></p>
      {!patternValid && <p className="text-warn">Pick at least one weekday / a positive interval or cycle.</p>}
      {needsStart && <p className="text-warn">Set a start date for interval / cycle schedules.</p>}
      {err && <p className="text-danger">{err}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-control bg-accent px-2.5 py-1.5 font-medium text-onAccent disabled:opacity-40"
        >
          <Save className="h-3.5 w-3.5" aria-hidden /> {busy ? "…" : "Save schedule"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setErr(null); }}
          className="inline-flex items-center gap-1 rounded-control bg-surface px-2.5 py-1.5 ring-1 ring-line/15"
        >
          <X className="h-3.5 w-3.5" aria-hidden /> Cancel
        </button>
      </div>
    </div>
  );
}
