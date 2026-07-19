/**
 * "Today" / "Yesterday" / "D Mon" label for a wearable snapshot's as-of day,
 * compared against the VIEWER's day key (viewerToday().key — v1.4.2), not the
 * server clock. Anything older than today is `stale` so the card can flag it —
 * otherwise a sync gap silently shows yesterday's recovery as if current.
 *
 * Pure module (no I/O, no ambient clock) so it is unit-testable and cannot
 * regress to server-day labelling.
 */
import { dayAnchor } from "@/lib/tz-day";
import { dayKey } from "@/lib/today-overrides";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function asOfLabel(asOf: string, todayKey: string): { text: string; stale: boolean } {
  if (asOf === todayKey) return { text: "Today", stale: false };
  // Yesterday = one calendar day before todayKey, derived via the noon anchor
  // and LOCAL getters (dayKey). Never toISOString().slice — that is only
  // coincidentally right in positive-offset runtimes.
  const yesterdayKey = dayKey(new Date(dayAnchor(todayKey).getTime() - 86_400_000));
  if (asOf === yesterdayKey) return { text: "Yesterday", stale: true };
  const [, m, d] = asOf.split("-").map(Number);
  return { text: `${d ?? ""} ${MONTHS[(m ?? 1) - 1] ?? ""}`.trim(), stale: true };
}
