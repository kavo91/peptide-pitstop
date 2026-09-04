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
  // training (Fenix 9 Pro era endpoints the sidecar adds to the raw day; all optional)
  trainingReadiness?: number;
  trainingReadinessLevel?: string;
  acuteLoad?: number;
  chronicLoad?: number;
  acwr?: number;
  acwrStatus?: string;
  trainingStatus?: string;
  enduranceScore?: number;
  hillScore?: number;
  fitnessAge?: number;
  ltHr?: number;
  ltSpeedMs?: number;
  floorsClimbed?: number;
  restingHr7d?: number;
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

/**
 * Garmin's lactate-threshold `speed` is a TENTH of a metre per second — it is not
 * the plain m/s the activity list uses. Confirmed against Garmin Connect
 * (Performance Stats → Lactate Threshold): a raw value of 0.35 is 3.5 m/s,
 * which Connect displays as 4:46 /km — the tenth-of-m/s scaling, not m/s.
 * The same field appears in `/userprofile-service/userprofile/user-settings` as
 * `lactateThresholdSpeed`, in a payload that also scales weight to grams — so no
 * field there can be assumed to be in SI base units.
 *
 * We convert on the way in, so `WearableDaily.ltSpeedMs` really is metres per
 * second, as its name says.
 */
export const LT_SPEED_TO_MS = 10;

type TrainingFields = Pick<
  WellnessDay,
  | "trainingReadiness" | "trainingReadinessLevel" | "acuteLoad" | "chronicLoad" | "acwr" | "acwrStatus" | "trainingStatus"
  | "enduranceScore" | "hillScore" | "fitnessAge" | "ltHr" | "ltSpeedMs" | "floorsClimbed" | "restingHr7d"
>;

/**
 * Training metrics from the extra endpoints the sidecar adds to the raw day
 * (`trainingReadiness`, `trainingStatus`, `enduranceScore`, `hillScore`,
 * `fitnessAge`, `lactateThreshold`, `floors`, `rhr`). Every key may be absent;
 * every field below is then undefined. Shapes verified against Connect on
 * 2026-09-03 (garminconnect 0.3.6).
 */
export function normaliseTraining(raw: any): TrainingFields {
  // Readiness: a list (one entry per device / update). Prefer the primary tracker, else the last entry.
  const readinessList: any[] = Array.isArray(raw?.trainingReadiness) ? raw.trainingReadiness : raw?.trainingReadiness ? [raw.trainingReadiness] : [];
  const readiness = readinessList.find((r) => r?.primaryActivityTracker === true) ?? readinessList[readinessList.length - 1] ?? null;

  // Training status: `latestTrainingStatusData` is keyed by device id. Prefer the primary training device.
  const ltsd = raw?.trainingStatus?.mostRecentTrainingStatus?.latestTrainingStatusData;
  const statusEntries: any[] = ltsd && typeof ltsd === "object" ? Object.values(ltsd) : [];
  const status = statusEntries.find((e) => e?.primaryTrainingDevice === true) ?? statusEntries[0] ?? null;
  const acute = status?.acuteTrainingLoadDTO ?? null;
  const phrase = typeof status?.trainingStatusFeedbackPhrase === "string" ? status.trainingStatusFeedbackPhrase : undefined;
  const trainingStatus = phrase ? phrase.split("_")[0].toUpperCase() : undefined;

  const lt = raw?.lactateThreshold?.speed_and_heart_rate ?? raw?.lactateThreshold ?? null;

  // Floors: rows of [startGMT, endGMT, ascended, descended] in the order the descriptor list gives.
  let floorsClimbed: number | undefined;
  const floorRows = raw?.floors?.floorValuesArray;
  if (Array.isArray(floorRows)) {
    const desc: any[] = Array.isArray(raw?.floors?.floorsValueDescriptorDTOList) ? raw.floors.floorsValueDescriptorDTOList : [];
    let idx = desc.findIndex((d) => d?.key === "floorsAscended");
    if (idx < 0) idx = 2;
    const total = floorRows.reduce((acc: number, row: any) => acc + (num(Array.isArray(row) ? row[idx] : undefined) ?? 0), 0);
    floorsClimbed = Math.round(total);
  }

  // 7-day resting HR: the mean of the daily values Garmin returns for its statistics window.
  const rhrEntries = raw?.rhr?.allMetrics?.metricsMap?.WELLNESS_RESTING_HEART_RATE;
  const rhrVals: number[] = Array.isArray(rhrEntries)
    ? rhrEntries.map((e: any) => num(e?.value)).filter((v: number | undefined): v is number => v !== undefined)
    : [];
  const restingHr7d = rhrVals.length ? Math.round(rhrVals.reduce((a, b) => a + b, 0) / rhrVals.length) : undefined;

  return {
    trainingReadiness: int(readiness?.score),
    trainingReadinessLevel: typeof readiness?.level === "string" ? readiness.level : undefined,
    acuteLoad: int(acute?.dailyTrainingLoadAcute),
    chronicLoad: int(acute?.dailyTrainingLoadChronic),
    acwr: num(acute?.dailyAcuteChronicWorkloadRatio),
    acwrStatus: typeof acute?.acwrStatus === "string" ? acute.acwrStatus : undefined,
    trainingStatus,
    enduranceScore: int(raw?.enduranceScore?.overallScore),
    hillScore: int(raw?.hillScore?.overallScore),
    fitnessAge: num(raw?.fitnessAge?.fitnessAge ?? raw?.trainingStatus?.mostRecentVO2Max?.generic?.fitnessAge),
    ltHr: int(lt?.heartRate),
    ltSpeedMs: (() => { const s = num(lt?.speed); return s === undefined ? undefined : s * LT_SPEED_TO_MS; })(),
    floorsClimbed,
    restingHr7d,
  };
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
    // training
    ...normaliseTraining(raw),
    // logged activities (plaintext)
    activities,
    activityCount: activities.length,
    raw,
  };
}
