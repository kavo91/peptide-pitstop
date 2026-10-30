/**
 * Picks the main sleep card for whatever devices have nights, so the Wellness
 * sleep view works with Garmin only, Eight Sleep only, or both:
 *   - both     → one "Sleep" chart with the two devices side by side
 *   - Garmin   → the Garmin "Sleep" chart (unchanged)
 *   - Eight Sleep only → "Sleep · Eight Sleep"
 * Pure presentational component — rendered on the server (journal) and inside the
 * ChartDetail client island, so it imports nothing server-only. The comparison and
 * bed cards live in SleepExtraCards (server-only use, kept out of that island).
 */
import type { WearableSeries } from "@/lib/wearable-series";
import type { EightSleepSeries } from "@/lib/eight-sleep-series";
import { pairSleepNights, sleepCoverage } from "@/lib/sleep-pairs";
import { SleepChart } from "./SleepChart";
import { SleepPairChart } from "./SleepPairChart";

const NO_EIGHT: EightSleepSeries = { sleep: [], nights: [] };

export function SleepMainCard({
  watch,
  eightSleep,
  detailHref,
}: {
  watch: Pick<WearableSeries, "sleep" | "recovery">;
  eightSleep?: EightSleepSeries;
  detailHref?: string;
}) {
  const eight = eightSleep ?? NO_EIGHT;
  const pairs = pairSleepNights(watch, eight);
  const has = sleepCoverage(pairs);
  if (has.garmin && has.eightSleep) return <SleepPairChart pairs={pairs} detailHref={detailHref} />;
  if (has.eightSleep) return <SleepChart sleep={eight.sleep} title="Sleep · Eight Sleep" detailHref={detailHref} />;
  return <SleepChart sleep={watch.sleep} detailHref={detailHref} />;
}
