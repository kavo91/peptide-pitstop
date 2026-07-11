/**
 * Catch-up rolling for interval schedules. A "roll" re-bases the every-N-days
 * grid from the day an off-grid dose was actually taken. Rolls are stored as
 * append-only anchors INSIDE scheduleRule (see DayPattern.anchors), so every
 * consumer of the rule — planner, Today, next-dose, analytics resolver —
 * inherits the piecewise grid with no schema or signature changes.
 */
import { startOfDay } from "./schedule";
import { parseSchedule } from "./entries";

const dayKeyOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Rewrite `scheduleRule` with a roll anchor at `anchorDay` appended to its
 * interval entry. Returns the new rule JSON, the input unchanged when that
 * anchor already exists, or null when the rule has no interval entry (weekly/
 * daily/cycle rules roll via their own machinery, not this one).
 */
export function appendIntervalAnchor(
  scheduleRule: string | null | undefined,
  anchorDay: Date,
): string | null {
  const schedule = parseSchedule(scheduleRule);
  const idx = schedule.findIndex((e) => e.dayPattern.kind === "interval");
  if (idx === -1) return null;

  const pattern = schedule[idx].dayPattern as { kind: "interval"; everyDays: number; anchors?: string[] };
  const key = dayKeyOf(startOfDay(anchorDay));
  const anchors = pattern.anchors ?? [];
  if (anchors.includes(key)) return scheduleRule ?? null;

  const next = schedule.map((e, i) =>
    i === idx ? { ...e, dayPattern: { ...pattern, anchors: [...anchors, key] } } : e,
  );
  return JSON.stringify(next);
}
