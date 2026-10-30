/**
 * Pure per-night pairing of the watch sleep series (Garmin, HealthKit gap-fills
 * included — see mergeWearableRows) with the Eight Sleep series. NO I/O.
 *
 * One SleepPair per date that either device has a night for. A side is null
 * when that device recorded no sleep that night, so the view works with
 * Garmin only, Eight Sleep only, or both. Values are never blended or copied
 * across sides: each side carries only its own device's numbers.
 */
import type { RecoveryPoint, SleepPoint, WearableSeries, WearableSource } from "./wearable-series";
import type { EightSleepSeries } from "./eight-sleep-series";

/** One device's night. Seconds for durations; score 0–100 on that device's own scale. */
export interface DeviceNight {
  /** Time asleep (stored total, else deep + light + REM). */
  asleep: number | null;
  deep: number | null;
  light: number | null;
  rem: number | null;
  awake: number | null;
  score: number | null;
  /** That device's own HRV reading (different methods — never combine). */
  hrvMs: number | null;
}

export interface GarminNight extends DeviceNight {
  /** Literal tag so the type system keeps the two sides apart. */
  device: "garmin";
  /** Which watch source produced the night (garmin / healthkit / mixed). */
  source?: WearableSource;
}

export interface EightSleepNightFull extends DeviceNight {
  device: "eight_sleep";
  tossTurns: number | null;
  sleepHrAvg: number | null;
  respirationAvg: number | null;
  bedTempC: number | null;
  roomTempC: number | null;
}

export interface SleepPair {
  date: string;
  garmin: GarminNight | null;
  eightSleep: EightSleepNightFull | null;
}

function asleepOf(p: SleepPoint): number | null {
  if (p.total != null) return p.total;
  if (p.deep == null && p.light == null && p.rem == null) return null;
  return (p.deep ?? 0) + (p.light ?? 0) + (p.rem ?? 0);
}

/** A sleep point counts as a recorded night only if it carries a duration, a stage or a score. */
function hasNight(p: SleepPoint): boolean {
  return asleepOf(p) != null || p.awake != null || p.score != null;
}

function deviceNight(p: SleepPoint, hrvMs: number | null): DeviceNight {
  return {
    asleep: asleepOf(p),
    deep: p.deep,
    light: p.light,
    rem: p.rem,
    awake: p.awake,
    score: p.score,
    hrvMs,
  };
}

export function pairSleepNights(
  watch: Pick<WearableSeries, "sleep" | "recovery">,
  eight: EightSleepSeries,
): SleepPair[] {
  const hrvByDate = new Map<string, number | null>(
    watch.recovery.map((r: RecoveryPoint) => [r.date, r.hrvMs]),
  );
  const byDate = new Map<string, SleepPair>();
  const slot = (date: string) => {
    let pair = byDate.get(date);
    if (!pair) {
      pair = { date, garmin: null, eightSleep: null };
      byDate.set(date, pair);
    }
    return pair;
  };

  for (const p of watch.sleep) {
    if (!hasNight(p)) continue;
    slot(p.date).garmin = { ...deviceNight(p, hrvByDate.get(p.date) ?? null), device: "garmin", source: p.source };
  }

  const nightByDate = new Map(eight.nights.map((n) => [n.date, n]));
  for (const p of eight.sleep) {
    if (!hasNight(p)) continue;
    const n = nightByDate.get(p.date);
    slot(p.date).eightSleep = {
      ...deviceNight(p, n?.hrvMs ?? null),
      device: "eight_sleep",
      tossTurns: n?.tossTurns ?? null,
      sleepHrAvg: n?.sleepHrAvg ?? null,
      respirationAvg: n?.respirationAvg ?? null,
      bedTempC: n?.bedTempC ?? null,
      roomTempC: n?.roomTempC ?? null,
    };
  }

  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Which devices have at least one night in these pairs. */
export function sleepCoverage(pairs: SleepPair[]): { garmin: boolean; eightSleep: boolean } {
  return {
    garmin: pairs.some((p) => p.garmin != null),
    eightSleep: pairs.some((p) => p.eightSleep != null),
  };
}
