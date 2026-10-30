/**
 * Pure Eight Sleep → WellnessDay normaliser. NO I/O, no Prisma, no crypto. The
 * `eight-sleep-sync` sidecar is a thin fetch-and-forward: it POSTs the `days`
 * entries of Eight Sleep's `/v1/users/{id}/trends` response unchanged, and ALL
 * shaping lives here (same split as garmin-sync ↔ wearable-normalise).
 *
 * ── Contract: one raw trend day (fields the mapping reads; any may be absent) ──
 *
 *   {
 *     day: "YYYY-MM-DD",              // Eight Sleep's own label for the night
 *     presenceStart, presenceEnd,     // ISO instants (UTC) in / out of bed
 *     processing: boolean,            // true while the night is still being scored
 *     score,                          // Eight Sleep sleep score, 0–100
 *     sleepDuration, presenceDuration, lightDuration, deepDuration, remDuration, // seconds
 *     wasoDuration,                   // seconds awake after first falling asleep
 *     tnt,                            // toss & turns
 *     sleepQualityScore: {
 *       hrv:             { average, current },  // ms
 *       respiratoryRate: { average, current },  // breaths / min
 *       heartRate:       { average, current },  // bpm while asleep
 *       tempBedC:        { average },  // not sent by every account
 *       tempRoomC:       { average },
 *     },
 *     sessions: [{ timeseries: { heartRate, tempBedC, tempRoomC: [[iso, value], ...] } }],
 *   }
 *
 * The API sends the literal string "None" for absent values; num() drops it.
 * Night values prefer the `average` of a quality-score metric; `current` can be a
 * single late reading. Bed and room temperature fall back to the mean of the
 * session timeseries, which is where some Pods send them.
 * Awake is Eight Sleep's own `wasoDuration` (awake after first falling asleep);
 * presence − sleep (which also counts time in bed before sleep and after waking)
 * is only the fallback.
 *
 * Day convention: Garmin files a night under the morning you WAKE UP. Eight
 * Sleep's `day` label is not documented, so the date here comes from
 * `presenceEnd` (out-of-bed instant) read in the runtime's local zone (the
 * container pins TZ) — the same wake-up day Garmin uses. `day` is only the
 * fallback when presenceEnd is missing.
 *
 * Eight Sleep is an ADDITIONAL source: rows land under source "eight_sleep" and
 * are never merged into Garmin's series. Its HRV is a bed-sensor reading, a
 * different method from Garmin's overnight RMSSD and HealthKit's SDNN, so it is
 * only ever charted on its own.
 */
import type { WellnessDay } from "./wearable-normalise";

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v as never);
  return Number.isFinite(n) ? n : undefined;
}

function int(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Math.round(n);
}

/** One decimal place (temperatures, breath rate). */
function dec1(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Math.round(n * 10) / 10;
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Parse an Eight Sleep instant. The API is UTC; pyEight treats a timestamp with
 * no zone as UTC too. JS would read "2026-06-19T20:35:00" as LOCAL time and move
 * every night a day early, so a zone-less date-time gets an explicit "Z".
 */
export function parseEightSleepInstant(s: string): Date {
  const t = s.trim();
  const naive = /T\d{2}:\d{2}/.test(t) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(t);
  return new Date(naive ? `${t}Z` : t);
}

/** Wake-up day ("YYYY-MM-DD", local zone) from presenceEnd, else the `day` label, else "". */
export function eightSleepWakeDay(raw: any): string {
  const end = typeof raw?.presenceEnd === "string" ? parseEightSleepInstant(raw.presenceEnd) : null;
  if (end && Number.isFinite(end.getTime())) return localDayKey(end);
  return typeof raw?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.day) ? raw.day : "";
}

/**
 * Mean of one session timeseries ([[iso, value], ...]) across all sessions.
 * Only samples above zero count (a 0 bpm / 0 °C sample is a sensor gap).
 */
function meanSessionSeries(raw: any, key: string): number | undefined {
  const sessions = Array.isArray(raw?.sessions) ? raw.sessions : [];
  let sum = 0;
  let n = 0;
  for (const s of sessions) {
    const series = s?.timeseries?.[key];
    if (!Array.isArray(series)) continue;
    for (const pt of series) {
      const v = Array.isArray(pt) ? num(pt[1]) : undefined;
      if (v !== undefined && v > 0) {
        sum += v;
        n += 1;
      }
    }
  }
  return n ? sum / n : undefined;
}

/** v when above zero, else undefined (a 0 bpm / ms / °C reading is a gap, not a value). */
function positive(v: number | undefined): number | undefined {
  return v !== undefined && v > 0 ? v : undefined;
}

/** A quality-score metric for the night: its `average`, else its `current` (both must be > 0). */
function nightValue(metric: any): number | undefined {
  return positive(num(metric?.average)) ?? positive(num(metric?.current));
}

/**
 * Normalise one raw trend day. Returns a WellnessDay with `date: ""` (which the
 * import skips) for a night still `processing` or with no sleep recorded — a
 * half-scored night must not land as a short one; the next backfill re-pulls it.
 */
export function normaliseEightSleepDay(raw: any): WellnessDay {
  const q = raw?.sleepQualityScore ?? {};
  const sleepSeconds = int(raw?.sleepDuration);
  const presence = int(raw?.presenceDuration);
  const waso = int(raw?.wasoDuration);
  const awake =
    waso !== undefined && waso >= 0
      ? waso
      : sleepSeconds !== undefined && presence !== undefined && presence >= sleepSeconds
        ? presence - sleepSeconds
        : undefined;

  const scored = raw?.processing !== true && sleepSeconds !== undefined && sleepSeconds > 0;

  return {
    date: scored ? eightSleepWakeDay(raw) : "",
    source: "eight_sleep",
    sleepSeconds,
    sleepDeepSeconds: int(raw?.deepDuration),
    sleepLightSeconds: int(raw?.lightDuration),
    sleepRemSeconds: int(raw?.remDuration),
    sleepAwakeSeconds: awake,
    sleepScore: int(raw?.score),
    hrvMs: nightValue(q?.hrv),
    respirationAvg: dec1(nightValue(q?.respiratoryRate)),
    sleepHrAvg: int(nightValue(q?.heartRate) ?? meanSessionSeries(raw, "heartRate")),
    tossTurns: int(raw?.tnt),
    bedTempC: dec1(positive(num(q?.tempBedC?.average)) ?? meanSessionSeries(raw, "tempBedC")),
    roomTempC: dec1(positive(num(q?.tempRoomC?.average)) ?? meanSessionSeries(raw, "tempRoomC")),
    activities: [],
    activityCount: 0,
    raw,
  };
}
