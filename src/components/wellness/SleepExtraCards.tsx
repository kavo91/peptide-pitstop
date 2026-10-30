/**
 * Extra sleep cards beside the main one: the "Garmin vs Eight Sleep" comparison
 * once both devices have data in its window, and the Eight Sleep bed card when
 * Eight Sleep has nights. Pure presentational server components.
 */
import type { EightSleepSeries } from "@/lib/eight-sleep-series";
import type { SleepComparison } from "@/lib/sleep-compare";
import { SleepCompareCard } from "./SleepCompareCard";
import { EightSleepBedCard } from "./EightSleepBedCard";

/** True once both devices have at least one night in the comparison window. */
export function showComparison(c: SleepComparison | undefined): c is SleepComparison {
  if (!c) return false;
  const { both, garminOnly, eightSleepOnly } = c.coverage;
  return both > 0 || (garminOnly > 0 && eightSleepOnly > 0);
}

export function SleepExtraCards({
  eightSleep,
  comparison,
  comparisonDays,
}: {
  eightSleep?: EightSleepSeries;
  comparison?: SleepComparison;
  comparisonDays: number;
}) {
  const hasEight = (eightSleep?.sleep.length ?? 0) > 0;
  return (
    <>
      {showComparison(comparison) && <SleepCompareCard comparison={comparison} days={comparisonDays} />}
      {hasEight && eightSleep && <EightSleepBedCard nights={eightSleep.nights} />}
    </>
  );
}
