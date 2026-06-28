/**
 * Server-only wearable reader. Fetches a window of WearableDaily rows for a
 * user and returns the typed chart series via the pure core (wearable-series).
 * Owner-scoped callers pass the resolved userId. `raw` is never decrypted here —
 * the charts don't need it; decrypt on demand elsewhere if a future view does.
 */
import "server-only";
import { prisma } from "@/lib/db";
import { buildWearableSeries, type WearableSeries } from "@/lib/wearable-series";

/**
 * Read WearableDaily rows in [fromDate, toDate] (inclusive) for a user and build
 * the chart series + latest snapshot. Dates are local-midnight Dates.
 */
export async function getWearableWindow(
  userId: string,
  fromDate: Date,
  toDate: Date,
): Promise<WearableSeries> {
  const rows = await prisma.wearableDaily.findMany({
    where: { userId, date: { gte: fromDate, lte: toDate } },
    orderBy: { date: "asc" },
  });
  return buildWearableSeries(rows);
}
