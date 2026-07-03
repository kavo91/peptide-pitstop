/**
 * Pure next-dose label formatting — split from next-dose.ts so the ticking
 * CLIENT component can import it without dragging getNextDose's dynamic
 * prisma import toward the client bundle.
 */
// Relative import for the same vitest-alias reason as next-dose.ts.
import { startOfDay } from "./schedule/schedule";

// Deterministic names (not toLocaleDateString) so the label is identical on
// server, client, and CI regardless of runtime locale.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * PURE: the dashboard's next-dose phrase. A dose on a FUTURE calendar day names
 * the day — "tomorrow", then the weekday ("Tuesday") up to 6 days out, then a
 * short date ("14 Jul") where a weekday alone would be ambiguous. Only a
 * SAME-day dose gets the live countdown ("in 3h 20m" / "in 14m"), plus the
 * "now"/"overdue" edge states. Calendar-day comparison happens in the caller's
 * local timezone (the ticking client component).
 */
export function formatNextDoseLabel(atMs: number, nowMs: number): string {
  const diffMin = Math.round((atMs - nowMs) / 60_000);
  if (diffMin < 0) return "overdue";
  if (diffMin === 0) return "now";

  const at = new Date(atMs);
  const dayDiff = Math.round(
    (startOfDay(at).getTime() - startOfDay(new Date(nowMs)).getTime()) / 86_400_000,
  );
  if (dayDiff >= 7) return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
  if (dayDiff >= 2) return WEEKDAYS[at.getDay()];
  if (dayDiff === 1) return "tomorrow";

  // Same calendar day → live countdown.
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return hours >= 1 ? `in ${hours}h ${mins}m` : `in ${mins}m`;
}
