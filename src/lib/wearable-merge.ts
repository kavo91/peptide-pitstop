/**
 * Pure field-level merge of garmin + healthkit WearableDaily rows into one
 * row per day for the charts. Garmin wins where both have a value; healthkit
 * fills gaps. hrvMs is NEVER taken from healthkit — HealthKit reports SDNN,
 * Garmin RMSSD-based overnight HRV; mixing them in one series is forbidden
 * (see the getWearableWindow doc comment). No I/O, no Prisma, no crypto.
 */
import type { WearableDailyLike } from "./wearable-series";

export type SourcedRow = WearableDailyLike & { source: string };

const FILLABLE = [
  "sleepSeconds", "sleepDeepSeconds", "sleepLightSeconds", "sleepRemSeconds",
  "sleepAwakeSeconds", "sleepScore", "restingHr", "weightKg", "steps",
  "caloriesActive", "vo2max", "intensityMinutes",
] as const satisfies readonly (keyof WearableDailyLike)[];

function key(d: Date): number {
  return d.getTime();
}

export function mergeWearableRows(rows: SourcedRow[]): WearableDailyLike[] {
  const byDay = new Map<number, { garmin?: SourcedRow; healthkit?: SourcedRow }>();
  for (const r of rows) {
    const bucket = byDay.get(key(r.date)) ?? {};
    if (r.source === "garmin") bucket.garmin = r;
    else if (r.source === "healthkit") bucket.healthkit = r;
    byDay.set(key(r.date), bucket);
  }

  const merged: WearableDailyLike[] = [];
  for (const [, { garmin, healthkit }] of [...byDay.entries()].sort(([a], [b]) => a - b)) {
    if (garmin && !healthkit) {
      merged.push({ ...garmin, mergedSource: "garmin" });
    } else if (!garmin && healthkit) {
      merged.push({ ...healthkit, hrvMs: null, mergedSource: "healthkit" });
    } else if (garmin && healthkit) {
      const out: WearableDailyLike = { ...garmin };
      const writable = out as unknown as Record<string, unknown>;
      let filled = false;
      for (const f of FILLABLE) {
        if (out[f] == null && healthkit[f] != null) {
          writable[f] = healthkit[f];
          filled = true;
        }
      }
      // Garmin day that Apple Health topped up = "mixed"; untouched garmin = "garmin".
      out.mergedSource = filled ? "mixed" : "garmin";
      merged.push(out);
    }
  }
  return merged;
}
