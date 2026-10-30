/**
 * Pure Eight Sleep charting transform — NO I/O, no Prisma, no crypto. Turns a
 * window of source="eight_sleep" WearableDaily rows into the series the Eight
 * Sleep cards render. Kept apart from buildWearableSeries on purpose: Eight
 * Sleep is an extra view beside Garmin, never merged into Garmin's series (its
 * score and bed-sensor HRV are different methods from Garmin's).
 */
import type { SleepPoint } from "./wearable-series";

type Decimalish = number | string | { toString(): string } | null | undefined;

/** The WearableDaily fields an Eight Sleep night needs. */
export interface EightSleepRowLike {
  date: Date;
  sleepSeconds?: number | null;
  sleepDeepSeconds?: number | null;
  sleepLightSeconds?: number | null;
  sleepRemSeconds?: number | null;
  sleepAwakeSeconds?: number | null;
  sleepScore?: number | null;
  hrvMs?: Decimalish;
  respirationAvg?: Decimalish;
  sleepHrAvg?: number | null;
  tossTurns?: number | null;
  bedTempC?: Decimalish;
  roomTempC?: Decimalish;
}

export interface EightSleepNight {
  date: string;
  hrvMs: number | null;
  sleepHrAvg: number | null;
  respirationAvg: number | null;
  tossTurns: number | null;
  bedTempC: number | null;
  roomTempC: number | null;
}

export interface EightSleepSeries {
  /** Same shape as the Garmin sleep series, so the stage chart is reused as-is. */
  sleep: SleepPoint[];
  nights: EightSleepNight[];
}

function toNum(v: Decimalish): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function buildEightSleepSeries(rows: EightSleepRowLike[]): EightSleepSeries {
  const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
  return {
    sleep: sorted.map((r) => ({
      date: dayKey(r.date),
      total: r.sleepSeconds ?? null,
      deep: r.sleepDeepSeconds ?? null,
      light: r.sleepLightSeconds ?? null,
      rem: r.sleepRemSeconds ?? null,
      awake: r.sleepAwakeSeconds ?? null,
      score: r.sleepScore ?? null,
    })),
    nights: sorted.map((r) => ({
      date: dayKey(r.date),
      hrvMs: toNum(r.hrvMs),
      sleepHrAvg: r.sleepHrAvg ?? null,
      respirationAvg: toNum(r.respirationAvg),
      tossTurns: r.tossTurns ?? null,
      bedTempC: toNum(r.bedTempC),
      roomTempC: toNum(r.roomTempC),
    })),
  };
}

/** One night from Eight Sleep for a day view — its own block beside Garmin, never mixed in. */
export interface EightSleepDay {
  sleepSeconds: number | null;
  score: number | null;
  sleepHrAvg: number | null;
  hrvMs: number | null;
  respirationAvg: number | null;
  tossTurns: number | null;
  bedTempC: number | null;
  roomTempC: number | null;
}

/** `dayKey → EightSleepDay` for the day views (Today card, month calendar). Eight Sleep's numbers only. */
export function eightSleepDaysByKey(series: EightSleepSeries): Record<string, EightSleepDay> {
  const nightByDate = new Map(series.nights.map((n) => [n.date, n]));
  const out: Record<string, EightSleepDay> = {};
  for (const p of series.sleep) {
    const n = nightByDate.get(p.date);
    out[p.date] = {
      sleepSeconds: p.total ?? null,
      score: p.score ?? null,
      sleepHrAvg: n?.sleepHrAvg ?? null,
      hrvMs: n?.hrvMs ?? null,
      respirationAvg: n?.respirationAvg ?? null,
      tossTurns: n?.tossTurns ?? null,
      bedTempC: n?.bedTempC ?? null,
      roomTempC: n?.roomTempC ?? null,
    };
  }
  return out;
}

/** True when Eight Sleep recorded the night's sleep (a duration or a score). */
export function eightSleepHasSleep(e: EightSleepDay | null | undefined): boolean {
  return !!e && (e.sleepSeconds != null || e.score != null);
}
