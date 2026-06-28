/**
 * Pure Garmin → WellnessDay normaliser. NO I/O, no Prisma, no crypto — safe to
 * unit test and to call from the import route. This is the SINGLE place wearable
 * normalisation lives; the Python sidecar is a thin fetch-and-forward and does
 * NOT normalise.
 *
 * ── Contract: the "assembled raw" object the sidecar POSTs (one per day) ──────
 * The sidecar logs into Garmin, calls several Connect endpoints, and assembles
 * ONE object per day with these top-level keys (each holding the relevant slice
 * of the raw Garmin response; any key may be missing if that fetch failed):
 *
 *   {
 *     date:    "YYYY-MM-DD",          // the wellness/calendar day (required)
 *     sleep:   { dailySleepDTO: {     // /wellness-service .../dailySleepData
 *                  sleepTimeSeconds, deepSleepSeconds, lightSleepSeconds,
 *                  remSleepSeconds, awakeSleepSeconds,
 *                  sleepScores: { overall: { value } },
 *                  averageSpO2Value, averageRespirationValue } },
 *     summary: {                       // /usersummary-service .../daily
 *                  totalSteps, restingHeartRate, averageStressLevel,
 *                  bodyBatteryHighestValue, bodyBatteryLowestValue,
 *                  activeKilocalories, moderateIntensityMinutes,
 *                  vigorousIntensityMinutes, averageSpo2,
 *                  avgWakingRespirationValue },
 *     hrv:     { hrvSummary: { lastNightAvg, status } },   // /hrv-service
 *     weight:  { totalAverage: { weight /* grams *\/, bmi, bodyFat } }, // /weight-service
 *     vo2max:  { generic: { vo2MaxValue } } | number       // /metrics-service maxmet
 *   }
 *
 * The mapping is defensive: missing fields → undefined, sub-objects may be null,
 * sleep stages accept seconds OR minutes, weight accepts grams OR kg. The whole
 * input is preserved under `raw` for future-proofing (stored encrypted).
 *
 * `raw.activities` (an array of Garmin activity-list entries — deliberate logged
 * workouts) is shaped into `activities` + `activityCount`. These are stored
 * PLAINTEXT (not under encrypted `raw`) so the month/wellness views can read them.
 */
import { normaliseActivity, type GarminActivity } from "./garmin-activity";

/** A normalised wellness day — matches WearableDaily columns (all metrics optional). */
export interface WellnessDay {
  date: string; // "YYYY-MM-DD"
  source: string; // "garmin"
  // sleep
  sleepSeconds?: number;
  sleepDeepSeconds?: number;
  sleepLightSeconds?: number;
  sleepRemSeconds?: number;
  sleepAwakeSeconds?: number;
  sleepScore?: number;
  // recovery
  restingHr?: number;
  hrvMs?: number;
  hrvStatus?: string;
  bodyBatteryHigh?: number;
  bodyBatteryLow?: number;
  stressAvg?: number;
  // body composition
  weightKg?: number;
  bmi?: number;
  bodyFatPct?: number;
  // activity
  steps?: number;
  caloriesActive?: number;
  vo2max?: number;
  intensityMinutes?: number;
  // misc
  spo2Avg?: number;
  respirationAvg?: number;
  // logged activities (deliberate workouts) — PLAINTEXT (not under encrypted `raw`)
  activities: GarminActivity[];
  activityCount: number;
  // original payload (stored encrypted)
  raw: unknown;
}

/** Coerce anything number-ish to a finite number, else undefined. */
function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v as never);
  return Number.isFinite(n) ? n : undefined;
}

/** Coerce to a rounded integer (for Int columns), else undefined. */
function int(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Math.round(n);
}

/** Seconds from a seconds field, falling back to a minutes field (× 60). */
function secs(secondsVal: unknown, minutesVal: unknown): number | undefined {
  const s = int(secondsVal);
  if (s !== undefined) return s;
  const m = num(minutesVal);
  return m === undefined ? undefined : Math.round(m * 60);
}

export function normaliseGarminDay(raw: any): WellnessDay {
  const sleep = raw?.sleep?.dailySleepDTO ?? raw?.sleep ?? null;
  const summary = raw?.summary ?? null;
  const hrv = raw?.hrv?.hrvSummary ?? raw?.hrv ?? null;
  const weight = raw?.weight?.totalAverage ?? raw?.weight ?? null;

  // VO2max: a bare number, or the maxmet { generic: { vo2MaxValue } } shape.
  const vo2max =
    typeof raw?.vo2max === "number"
      ? num(raw.vo2max)
      : num(raw?.vo2max?.generic?.vo2MaxValue ?? raw?.vo2max?.vo2MaxValue);

  // Weight: grams (Garmin's native unit) → kg, or an already-kg field.
  let weightKg: number | undefined;
  const weightKgDirect = num(weight?.weightKg);
  const weightGrams = num(weight?.weight ?? weight?.weightGrams);
  if (weightKgDirect !== undefined) weightKg = weightKgDirect;
  else if (weightGrams !== undefined) weightKg = weightGrams / 1000;

  // Intensity minutes: Garmin's own weighting (moderate + 2 × vigorous), or a
  // pre-computed field if the summary provides one.
  let intensityMinutes = int(summary?.intensityMinutes);
  const mod = num(summary?.moderateIntensityMinutes);
  const vig = num(summary?.vigorousIntensityMinutes);
  if (intensityMinutes === undefined && (mod !== undefined || vig !== undefined)) {
    intensityMinutes = Math.round((mod ?? 0) + 2 * (vig ?? 0));
  }

  const status = typeof hrv?.status === "string" ? hrv.status.toLowerCase() : undefined;

  // Logged activities: an array of Garmin activity-list entries, each shaped
  // defensively. A non-array (or missing) value → no activities.
  const activities = Array.isArray(raw?.activities) ? raw.activities.map(normaliseActivity) : [];

  return {
    date: raw?.date,
    source: "garmin",
    // sleep
    sleepSeconds: secs(sleep?.sleepTimeSeconds, sleep?.sleepTimeMinutes),
    sleepDeepSeconds: secs(sleep?.deepSleepSeconds, sleep?.deepSleepMinutes),
    sleepLightSeconds: secs(sleep?.lightSleepSeconds, sleep?.lightSleepMinutes),
    sleepRemSeconds: secs(sleep?.remSleepSeconds, sleep?.remSleepMinutes),
    sleepAwakeSeconds: secs(sleep?.awakeSleepSeconds, sleep?.awakeSleepMinutes),
    sleepScore: int(sleep?.sleepScores?.overall?.value ?? sleep?.sleepScore),
    // recovery
    restingHr: int(summary?.restingHeartRate ?? sleep?.restingHeartRate),
    hrvMs: num(hrv?.lastNightAvg ?? hrv?.weeklyAvg),
    hrvStatus: status,
    bodyBatteryHigh: int(summary?.bodyBatteryHighestValue),
    bodyBatteryLow: int(summary?.bodyBatteryLowestValue),
    stressAvg: int(summary?.averageStressLevel),
    // body composition
    weightKg,
    bmi: num(weight?.bmi),
    bodyFatPct: num(weight?.bodyFat ?? weight?.bodyFatPct),
    // activity
    steps: int(summary?.totalSteps),
    caloriesActive: int(summary?.activeKilocalories),
    vo2max,
    intensityMinutes,
    // misc — daily summary preferred, overnight sleep values as fallback
    spo2Avg: int(summary?.averageSpo2 ?? sleep?.averageSpO2Value),
    respirationAvg: num(summary?.avgWakingRespirationValue ?? sleep?.averageRespirationValue),
    // logged activities (plaintext)
    activities,
    activityCount: activities.length,
    raw,
  };
}
