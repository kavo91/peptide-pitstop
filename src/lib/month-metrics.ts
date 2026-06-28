/**
 * Pure per-day Garmin metric transform for the month calendar — NO I/O, no
 * Prisma, no crypto, no `server-only`. Turns a window of WearableDaily rows into
 * a `dayKey → DayMetric` map the month grid + DayDetail render directly. Decimal
 * columns arrive as Prisma Decimal | number | string | null; everything is
 * coerced to plain `number | null` here so the UI never touches Decimal.
 *
 * `sleepSeconds` prefers the stored total, falling back to the sum of the
 * non-null stage seconds — the same stage-sum convention `wellness-log` uses.
 */
import { parseActivitiesJson, type GarminActivity } from "./garmin-activity";
import type { WearableDailyLike } from "./wearable-series";

/** One day's key Garmin metrics, all coerced to plain `number | null`. */
export interface DayMetric {
  steps: number | null;
  sleepSeconds: number | null;
  intensityMinutes: number | null;
  caloriesActive: number | null;
  weightKg: number | null;
  restingHr: number | null;
  hrvMs: number | null;
  bodyBattery: number | null;
  sleepScore: number | null;
  /** Logged workouts for the day (plaintext; [] when none/malformed). */
  activities: GarminActivity[];
  /** Stored workout count (falls back to the parsed activities length). */
  activityCount: number;
}

/** Prisma Decimal | number | string | null | undefined — anything stringifiable. */
type Decimalish = number | string | { toString(): string } | null | undefined;

function toNum(v: Decimalish): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

/** Local-date key "YYYY-MM-DD" (rows are stored at local-midnight). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Sum of the non-null stage seconds, or null when every stage is null. */
function sumStages(...stages: (number | null | undefined)[]): number | null {
  const present = stages.filter((s): s is number => s != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/** Map a window of WearableDaily rows to a `dayKey → DayMetric` lookup. */
export function monthMetricsByDay(rows: WearableDailyLike[]): Record<string, DayMetric> {
  const out: Record<string, DayMetric> = {};
  for (const r of rows) {
    // Parse defensively — a single malformed row must never throw the whole grid.
    const activities = parseActivitiesJson(r.activitiesJson);
    out[dayKey(r.date)] = {
      steps: r.steps ?? null,
      sleepSeconds:
        r.sleepSeconds ??
        sumStages(r.sleepDeepSeconds, r.sleepLightSeconds, r.sleepRemSeconds, r.sleepAwakeSeconds),
      intensityMinutes: r.intensityMinutes ?? null,
      caloriesActive: r.caloriesActive ?? null,
      weightKg: toNum(r.weightKg),
      restingHr: r.restingHr ?? null,
      hrvMs: toNum(r.hrvMs),
      bodyBattery: r.bodyBatteryHigh ?? null,
      sleepScore: r.sleepScore ?? null,
      activities,
      // Prefer the stored count; fall back to the parsed length (e.g. malformed JSON
      // with no stored count, or an older row). null → array length.
      activityCount: r.activityCount ?? activities.length,
    };
  }
  return out;
}
