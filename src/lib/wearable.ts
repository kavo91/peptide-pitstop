/**
 * Server-only wearable reader. Fetches a window of WearableDaily rows for a
 * user and returns the typed chart series via the pure core (wearable-series).
 * Owner-scoped callers pass the resolved userId. `raw` is decrypted in one place
 * only — getEightSleepNightTemps, for ONE night — and only the derived series
 * leave this module, never `raw` itself.
 */
import "server-only";
import { prisma } from "@/lib/db";
import { buildWearableSeries, type WearableSeries } from "@/lib/wearable-series";
import { mergeWearableRows } from "@/lib/wearable-merge";
import { buildEightSleepSeries, type EightSleepSeries } from "@/lib/eight-sleep-series";
import { pairSleepNights } from "@/lib/sleep-pairs";
import { compareSleep, type SleepComparison } from "@/lib/sleep-compare";
import { nightTemps, type NightTemps } from "@/lib/eight-sleep-night-temps";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import { parseDayKey } from "@/lib/schedule/shift-transition";

/**
 * Read garmin + healthkit rows in [fromDate, toDate] and field-merge them for
 * the charts (garmin priority; healthkit fills gaps; healthkit hrvMs is never
 * charted — HealthKit SDNN must not mix with Garmin RMSSD-based HRV in one
 * series). health_connect stays source-isolated until a view needs it.
 */
export async function getWearableWindow(
  userId: string,
  fromDate: Date,
  toDate: Date,
): Promise<WearableSeries> {
  const rows = await prisma.wearableDaily.findMany({
    where: { userId, source: { in: ["garmin", "healthkit"] }, date: { gte: fromDate, lte: toDate } },
    orderBy: { date: "asc" },
  });
  return buildWearableSeries(mergeWearableRows(rows));
}

/**
 * Read the source="eight_sleep" rows in [fromDate, toDate] for the Eight Sleep
 * cards. Never merged with garmin/healthkit — an extra view beside them.
 */
export async function getEightSleepWindow(
  userId: string,
  fromDate: Date,
  toDate: Date,
): Promise<EightSleepSeries> {
  const rows = await prisma.wearableDaily.findMany({
    where: { userId, source: "eight_sleep", date: { gte: fromDate, lte: toDate } },
    orderBy: { date: "asc" },
  });
  return buildEightSleepSeries(rows);
}

/** Garmin vs Eight Sleep comparison over [fromDate, toDate] (each device on its own; see sleep-compare). */
export async function getSleepComparison(userId: string, fromDate: Date, toDate: Date): Promise<SleepComparison> {
  const [watch, eight] = await Promise.all([
    getWearableWindow(userId, fromDate, toDate),
    getEightSleepWindow(userId, fromDate, toDate),
  ]);
  return compareSleep(pairSleepNights(watch, eight));
}

/**
 * Bed and room temperature across ONE Eight Sleep night ("YYYY-MM-DD" wake-up
 * day), read from that row's encrypted `raw`. Null when the night, its `raw` or
 * its readings are missing, or `raw` cannot be decrypted / parsed.
 */
export async function getEightSleepNightTemps(userId: string, dayKey: string): Promise<NightTemps | null> {
  const row = await prisma.wearableDaily.findUnique({
    where: { userId_date_source: { userId, date: parseDayKey(dayKey), source: "eight_sleep" } },
    select: { raw: true },
  });
  if (!row?.raw) return null;
  try {
    return nightTemps(JSON.parse(decryptField(row.raw) ?? "null"));
  } catch (err) {
    console.error("[wearable] could not read an Eight Sleep night's raw", err);
    return null;
  }
}
