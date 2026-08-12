/**
 * Server-only wearable reader. Fetches a window of WearableDaily rows for a
 * user and returns the typed chart series via the pure core (wearable-series).
 * Owner-scoped callers pass the resolved userId. `raw` is never decrypted here —
 * the charts don't need it; decrypt on demand elsewhere if a future view does.
 */
import "server-only";
import { prisma } from "@/lib/db";
import { buildWearableSeries, type WearableSeries } from "@/lib/wearable-series";
import { mergeWearableRows } from "@/lib/wearable-merge";

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
