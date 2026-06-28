/**
 * Pure merge of the manual wellness log and the Garmin wearable series into one
 * unified per-day record — NO I/O, no Prisma, no crypto, no `server-only`. Safe
 * to unit test and to call from a server component.
 *
 * The caller (the /journal page) is responsible for: (1) decrypting side effects
 * and notes into display strings, and (2) keying each manual entry to a local
 * "YYYY-MM-DD" day with the SAME convention `buildWearableSeries` uses, so the
 * manual and Garmin sides line up on the same calendar day.
 */
import type { GarminActivity } from "./garmin-activity";
import type { WearableSeries } from "./wearable-series";
import type { SideEffectEntry } from "./side-effects";

/** A manual JournalEntry, flattened + decrypted for display, keyed to a day. */
export interface ManualDay {
  date: string; // "YYYY-MM-DD"
  /** JournalEntry id — lets the log render a per-entry delete control. */
  id?: string;
  weight: number | null;
  weightUnit: string | null;
  mood: number | null;
  energy: number | null;
  sleep: number | null;
  /** Energy intake (kcal). */
  calories: number | null;
  /** Protein (grams). */
  proteinG: number | null;
  /** Water intake (mL). */
  waterMl: number | null;
  /** ALREADY-DECRYPTED display string (the page decrypts before calling). */
  sideEffects: string | null;
  /** Structured side effects (decrypted + parsed) — drives the editor. */
  sideEffectEntries: SideEffectEntry[];
  /** ALREADY-DECRYPTED display string. */
  notes: string | null;
}

/** That day's Garmin metrics, pulled from the wearable series. */
export interface WellnessLogGarmin {
  /** Sum of the non-null sleep stage seconds (deep + light + rem + awake). */
  sleepSeconds: number | null;
  sleepScore: number | null;
  weightKg: number | null;
  steps: number | null;
  caloriesActive: number | null;
  intensityMinutes: number | null;
  restingHr: number | null;
  hrvMs: number | null;
  bodyBattery: number | null;
  /** Logged workouts for the day (plaintext; [] when none). */
  activities: GarminActivity[];
}

/** One day of the unified wellness log: manual entry and/or Garmin data. */
export interface WellnessLogDay {
  date: string; // "YYYY-MM-DD"
  manual: ManualDay | null;
  garmin: WellnessLogGarmin | null;
}

/** Sum of the non-null stage seconds, or null when every stage is null. */
function sumStages(...stages: (number | null)[]): number | null {
  const present = stages.filter((s): s is number => s != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/**
 * Merge the manual days and the wearable series into one row per calendar day,
 * over the union of all dates present in either source, newest first. A day is
 * emitted only when it has a manual entry OR at least one non-null Garmin metric.
 */
export function mergeWellnessLog(manual: ManualDay[], series: WearableSeries): WellnessLogDay[] {
  const manualByDate = new Map(manual.map((m) => [m.date, m]));
  const sleepByDate = new Map(series.sleep.map((p) => [p.date, p]));
  const recoveryByDate = new Map(series.recovery.map((p) => [p.date, p]));
  const weightByDate = new Map(series.weight.map((p) => [p.date, p]));
  const activityByDate = new Map(series.activity.map((p) => [p.date, p]));

  const dates = new Set<string>([
    ...manualByDate.keys(),
    ...sleepByDate.keys(),
    ...recoveryByDate.keys(),
    ...weightByDate.keys(),
    ...activityByDate.keys(),
  ]);

  const rows: WellnessLogDay[] = [];
  for (const date of dates) {
    const sleep = sleepByDate.get(date);
    const recovery = recoveryByDate.get(date);
    const weight = weightByDate.get(date);
    const activity = activityByDate.get(date);

    const garmin: WellnessLogGarmin = {
      sleepSeconds: sleep ? sumStages(sleep.deep, sleep.light, sleep.rem, sleep.awake) : null,
      sleepScore: sleep?.score ?? null,
      weightKg: weight?.weightKg ?? null,
      steps: activity?.steps ?? null,
      caloriesActive: activity?.caloriesActive ?? null,
      intensityMinutes: activity?.intensityMinutes ?? null,
      restingHr: recovery?.restingHr ?? null,
      hrvMs: recovery?.hrvMs ?? null,
      bodyBattery: recovery?.bodyBatteryHigh ?? null,
      activities: activity?.activities ?? [],
    };

    // A non-null scalar metric OR at least one logged activity makes this a Garmin
    // day. (`activities` is always a non-null [] — exclude it from the generic
    // null-scan and check its length, else every row would falsely count.)
    const { activities, ...scalars } = garmin;
    const hasGarmin = activities.length > 0 || Object.values(scalars).some((v) => v != null);
    const manualDay = manualByDate.get(date) ?? null;
    if (!manualDay && !hasGarmin) continue;

    rows.push({ date, manual: manualDay, garmin: hasGarmin ? garmin : null });
  }

  // Reverse-chronological — "YYYY-MM-DD" sorts lexicographically === by date.
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return rows;
}
