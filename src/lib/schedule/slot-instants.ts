/**
 * Timed-slot instants for one local calendar day.
 *
 * PlannedDose rows are day-anchored (local midnight) — a slot's clock time
 * exists only in the protocol's scheduleRule. The Today card composes a timed
 * card's prefill as `new Date(dayKey + "T" + time + ":00")` in the device TZ;
 * this helper is the server-side twin of that construction (runtime TZ), so
 * the two agree whenever the container TZ matches the household TZ.
 */
import { parseSchedule, slotsOn } from "./entries";

const dayKeyOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Local Date instants of every timed slot due on `day`; untimed slots yield none. */
export function slotInstantsOn(
  scheduleRule: string | null | undefined,
  day: Date,
  startDate?: Date | null,
  endDate?: Date | null,
): Date[] {
  const key = dayKeyOf(day);
  return slotsOn(parseSchedule(scheduleRule), day, startDate, endDate)
    .filter((s): s is { time: string } => s.time !== null)
    .map((s) => new Date(`${key}T${s.time}:00`));
}
