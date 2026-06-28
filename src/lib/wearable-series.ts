/**
 * Pure wearable charting transforms — NO I/O, no Prisma, no crypto. Turns a
 * window of WearableDaily rows into the typed series the Wellness charts and the
 * dashboard tile render. Decimal columns arrive as Prisma Decimal | number |
 * string | null; everything is coerced to plain `number | null` here so the UI
 * never touches Decimal. `raw` is intentionally NOT read (charts don't need it).
 */
import { parseActivitiesJson, type GarminActivity } from "./garmin-activity";

/** A WearableDaily-shaped row — only the fields the series need. */
export interface WearableDailyLike {
  date: Date;
  sleepSeconds?: number | null;
  sleepDeepSeconds?: number | null;
  sleepLightSeconds?: number | null;
  sleepRemSeconds?: number | null;
  sleepAwakeSeconds?: number | null;
  sleepScore?: number | null;
  restingHr?: number | null;
  hrvMs?: Decimalish;
  bodyBatteryHigh?: number | null;
  bodyBatteryLow?: number | null;
  stressAvg?: number | null;
  weightKg?: Decimalish;
  steps?: number | null;
  caloriesActive?: number | null;
  vo2max?: Decimalish;
  intensityMinutes?: number | null;
  // logged activities (plaintext) — JSON string of GarminActivity[] + a count
  activitiesJson?: string | null;
  activityCount?: number | null;
}

/** Prisma Decimal | number | string | null | undefined — anything stringifiable. */
type Decimalish = number | string | { toString(): string } | null | undefined;

export interface SleepPoint {
  date: string;
  deep: number | null;
  light: number | null;
  rem: number | null;
  awake: number | null;
  score: number | null;
}
export interface RecoveryPoint {
  date: string;
  restingHr: number | null;
  hrvMs: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  stressAvg: number | null;
}
export interface WeightPoint {
  date: string;
  weightKg: number;
}
export interface ActivityPoint {
  date: string;
  steps: number | null;
  caloriesActive: number | null;
  vo2max: number | null;
  intensityMinutes: number | null;
  /** Logged workouts for the day (plaintext; [] when none/malformed). */
  activities: GarminActivity[];
}
export interface WearableSnapshot {
  asOf: string;
  restingHr: number | null;
  hrvMs: number | null;
  bodyBattery: number | null;
  sleepScore: number | null;
  weightKg: number | null;
  /** Logged workouts from the most recent day that had any (latest-available, like the metrics). */
  activities: GarminActivity[];
  /** Local day-key ("YYYY-MM-DD") the `activities` came from, or null when none.
   *  May differ from `asOf` — workouts are discrete dated events, not a lagging
   *  daily metric — so the UI labels them with THIS day (a ride yesterday must
   *  not read as today's). */
  activitiesAsOf: string | null;
}
export interface WearableSeries {
  sleep: SleepPoint[];
  recovery: RecoveryPoint[];
  weight: WeightPoint[];
  activity: ActivityPoint[];
  latestSnapshot: WearableSnapshot | null;
}

function toNum(v: Decimalish): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

/** Local-date key "YYYY-MM-DD" (rows are stored at local-midnight). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function buildWearableSeries(rows: WearableDailyLike[]): WearableSeries {
  const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());

  const sleep: SleepPoint[] = sorted.map((r) => ({
    date: dayKey(r.date),
    deep: r.sleepDeepSeconds ?? null,
    light: r.sleepLightSeconds ?? null,
    rem: r.sleepRemSeconds ?? null,
    awake: r.sleepAwakeSeconds ?? null,
    score: r.sleepScore ?? null,
  }));

  const recovery: RecoveryPoint[] = sorted.map((r) => ({
    date: dayKey(r.date),
    restingHr: r.restingHr ?? null,
    hrvMs: toNum(r.hrvMs),
    bodyBatteryHigh: r.bodyBatteryHigh ?? null,
    bodyBatteryLow: r.bodyBatteryLow ?? null,
    stressAvg: r.stressAvg ?? null,
  }));

  const weight: WeightPoint[] = sorted
    .map((r) => ({ date: dayKey(r.date), weightKg: toNum(r.weightKg) }))
    .filter((p): p is WeightPoint => p.weightKg != null);

  const activity: ActivityPoint[] = sorted.map((r) => ({
    date: dayKey(r.date),
    steps: r.steps ?? null,
    caloriesActive: r.caloriesActive ?? null,
    vo2max: toNum(r.vo2max),
    intensityMinutes: r.intensityMinutes ?? null,
    activities: parseActivitiesJson(r.activitiesJson),
  }));

  // Latest non-null per metric (scan ascending, keep the last hit).
  let latestSnapshot: WearableSnapshot | null = null;
  if (sorted.length) {
    const snap: WearableSnapshot = {
      asOf: dayKey(sorted[sorted.length - 1].date),
      restingHr: null,
      hrvMs: null,
      bodyBattery: null,
      sleepScore: null,
      weightKg: null,
      activities: [],
      activitiesAsOf: null,
    };
    for (const r of sorted) {
      if (r.restingHr != null) snap.restingHr = r.restingHr;
      const hrv = toNum(r.hrvMs);
      if (hrv != null) snap.hrvMs = hrv;
      if (r.bodyBatteryHigh != null) snap.bodyBattery = r.bodyBatteryHigh;
      if (r.sleepScore != null) snap.sleepScore = r.sleepScore;
      const w = toNum(r.weightKg);
      if (w != null) snap.weightKg = w;
      const acts = parseActivitiesJson(r.activitiesJson);
      if (acts.length) {
        snap.activities = acts;
        snap.activitiesAsOf = dayKey(r.date);
      }
    }
    latestSnapshot = snap;
  }

  return { sleep, recovery, weight, activity, latestSnapshot };
}
