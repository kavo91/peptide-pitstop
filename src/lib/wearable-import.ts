/**
 * Wearable import core — pure-ish, NO `server-only`, no direct Prisma/crypto
 * imports. The DB client and the encrypt function are injected so this is unit
 * testable with fakes. The import route wires in the real `prisma` +
 * `encryptField`. Keeping this free of `server-only` lets vitest import it
 * directly (server-only throws when evaluated outside an RSC build).
 */
import { normaliseGarminDay, type WellnessDay } from "./wearable-normalise";

const SOURCE = "garmin";

/** Parse "YYYY-MM-DD" to a local-midnight Date, or null if malformed. */
export function localMidnight(dateStr: string): Date | null {
  if (typeof dateStr !== "string") return null;
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  // Reject overflow (e.g. 2026-13-40 rolls forward to another month/day).
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** Encrypts a string for the `raw` column (real impl: encryptField). */
export type EncryptFn = (plain: string | null | undefined) => string | null;

/** A minimal Prisma-like client surface — keeps this unit-testable. */
export interface WearableUpsertClient {
  wearableDaily: { upsert: (args: WearableUpsertArgs) => Promise<unknown> };
}

/**
 * The metric columns shared by create/update (everything but keys + syncedAt).
 * `raw` is the encrypted ciphertext column. The normalised `activities` array is
 * dropped here and re-projected to the `activitiesJson` PLAINTEXT column +
 * `activityCount` (the array itself is not a DB column).
 */
type WearableMetrics = Omit<WellnessDay, "date" | "source" | "raw" | "activities"> & {
  raw: string | null;
  activitiesJson: string;
};

export interface WearableUpsertArgs {
  where: { userId_date_source: { userId: string; date: Date; source: string } };
  create: WearableMetrics & { userId: string; date: Date; source: string };
  update: WearableMetrics & { syncedAt: Date };
}

/** Build the Prisma upsert args for one normalised day. `date` must be valid. */
export function buildWearableUpsertArgs(
  userId: string,
  day: WellnessDay,
  encrypt: EncryptFn,
): WearableUpsertArgs {
  const date = localMidnight(day.date);
  if (!date) throw new Error(`buildWearableUpsertArgs: invalid date "${day.date}"`);

  const metrics: WearableMetrics = {
    sleepSeconds: day.sleepSeconds,
    sleepDeepSeconds: day.sleepDeepSeconds,
    sleepLightSeconds: day.sleepLightSeconds,
    sleepRemSeconds: day.sleepRemSeconds,
    sleepAwakeSeconds: day.sleepAwakeSeconds,
    sleepScore: day.sleepScore,
    restingHr: day.restingHr,
    hrvMs: day.hrvMs,
    hrvStatus: day.hrvStatus,
    bodyBatteryHigh: day.bodyBatteryHigh,
    bodyBatteryLow: day.bodyBatteryLow,
    stressAvg: day.stressAvg,
    weightKg: day.weightKg,
    bmi: day.bmi,
    bodyFatPct: day.bodyFatPct,
    steps: day.steps,
    caloriesActive: day.caloriesActive,
    vo2max: day.vo2max,
    intensityMinutes: day.intensityMinutes,
    spo2Avg: day.spo2Avg,
    respirationAvg: day.respirationAvg,
    // logged activities — PLAINTEXT (the month/wellness views never decrypt `raw`)
    activityCount: day.activityCount,
    activitiesJson: JSON.stringify(day.activities),
    raw: encrypt(JSON.stringify(day.raw)),
  };

  return {
    where: { userId_date_source: { userId, date, source: SOURCE } },
    create: { userId, date, source: SOURCE, ...metrics },
    update: { ...metrics, syncedAt: new Date() },
  };
}

/**
 * Normalise + upsert a batch of assembled raw Garmin days. Malformed entries
 * (non-object, or no valid YYYY-MM-DD date) are skipped, never throwing the
 * whole batch. Idempotent via the (userId, date, source) composite unique.
 */
export async function importWellnessDays(
  client: WearableUpsertClient,
  userId: string,
  rawDays: unknown[],
  encrypt: EncryptFn,
): Promise<{ upserted: number }> {
  if (!Array.isArray(rawDays)) return { upserted: 0 };

  let upserted = 0;
  for (const raw of rawDays) {
    if (raw == null || typeof raw !== "object") continue;
    const day = normaliseGarminDay(raw);
    if (!localMidnight(day.date)) continue; // skip undated/garbage days
    await client.wearableDaily.upsert(buildWearableUpsertArgs(userId, day, encrypt));
    upserted += 1;
  }
  return { upserted };
}
