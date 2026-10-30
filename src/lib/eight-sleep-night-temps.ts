/**
 * Pure Eight Sleep night temperature series. NO I/O.
 *
 * Reads one raw trend day (the decrypted `raw` of a WearableDaily eight_sleep
 * row) and returns the bed and room temperature readings across that night,
 * from `sessions[].timeseries.tempBedC` / `tempRoomC` ([[iso, value], ...]).
 * A Pod sends these hourly (about 8–9 points a night).
 *
 * All sessions of the night are joined in time order. The API's literal "None"
 * and values ≤ 0 (a sensor gap) are dropped, the same rule the night averages
 * use in eight-sleep-normalise. Times are UTC instants (epoch ms).
 */
import { parseEightSleepInstant } from "./eight-sleep-normalise";

export interface TempPoint {
  /** Epoch ms (UTC instant). */
  t: number;
  /** °C. */
  v: number;
}

export interface NightTemps {
  bed: TempPoint[];
  room: TempPoint[];
}

function series(raw: any, key: string): TempPoint[] {
  const sessions = Array.isArray(raw?.sessions) ? raw.sessions : [];
  const out: TempPoint[] = [];
  for (const s of sessions) {
    const pts = s?.timeseries?.[key];
    if (!Array.isArray(pts)) continue;
    for (const pt of pts) {
      if (!Array.isArray(pt) || typeof pt[0] !== "string") continue;
      const t = parseEightSleepInstant(pt[0]).getTime();
      const v = typeof pt[1] === "number" ? pt[1] : Number(pt[1]);
      if (Number.isFinite(t) && Number.isFinite(v) && v > 0) out.push({ t, v });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Bed and room readings for one night, or null when the night has neither. */
export function nightTemps(raw: unknown): NightTemps | null {
  const bed = series(raw, "tempBedC");
  const room = series(raw, "tempRoomC");
  return bed.length || room.length ? { bed, room } : null;
}

/** Mean of the readings, or null when there are none. */
export function meanTemp(points: TempPoint[]): number | null {
  return points.length ? points.reduce((a, p) => a + p.v, 0) / points.length : null;
}

export interface NightPick {
  night: string;
  prev: string | null;
  next: string | null;
}

/**
 * The night to show: `asked` when it is one of the stored `nights` (ascending
 * "YYYY-MM-DD" keys), else the newest. Null when there are no nights.
 */
export function pickNight(nights: string[], asked: unknown): NightPick | null {
  if (!nights.length) return null;
  const i = typeof asked === "string" && nights.includes(asked) ? nights.indexOf(asked) : nights.length - 1;
  return { night: nights[i], prev: i > 0 ? nights[i - 1] : null, next: i < nights.length - 1 ? nights[i + 1] : null };
}
