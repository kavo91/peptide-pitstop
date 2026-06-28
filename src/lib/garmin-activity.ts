/**
 * Pure Garmin LOGGED-ACTIVITY transforms — NO I/O, no Prisma, no crypto, no
 * `server-only`. "Activities" here are deliberate workouts (runs, rides, lifts,
 * swims) the user recorded, NOT the passive steps/intensity-minutes that already
 * live on WearableDaily. Stored PLAINTEXT (activitiesJson) so the month grid and
 * wellness views — which never decrypt `raw` — can read them.
 *
 * `normaliseActivity` shapes one raw Garmin activity-list entry; `activityDisplay`
 * (and the `ACTIVITY_DISPLAY` map it reads) maps a friendly type → the icon +
 * colour-class + label the UI renders. Both are defensive: garbage in → a stable
 * shape / a muted fallback, never a throw.
 */
import { Activity, Bike, Dumbbell, Footprints, Waves, type LucideIcon } from "lucide-react";

/** One logged workout, coerced to plain primitives the UI + DB can store. */
export interface GarminActivity {
  /** Garmin's activityType.typeKey, lowercased (e.g. "running", "strength_training"). */
  type: string;
  /** Duration in whole seconds (0 when missing/garbage). */
  durationSec: number;
  /** Distance in metres, omitted when absent or non-finite. */
  distanceM?: number;
  /** The user-given activity name, if any. */
  name?: string;
  /** Garmin's local start timestamp string (display only; never parsed for math). */
  startLocal?: string;
}

/** Finite number or undefined. */
function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v as never);
  return Number.isFinite(n) ? n : undefined;
}

/** Read the typeKey from a nested `activityType.typeKey`, a bare string, else "other". */
function readType(raw: any): string {
  const t = raw?.activityType?.typeKey ?? (typeof raw?.activityType === "string" ? raw.activityType : undefined);
  return typeof t === "string" && t.length ? t.toLowerCase() : "other";
}

/** Shape one raw Garmin activity-list entry into a GarminActivity. Never throws. */
export function normaliseActivity(raw: any): GarminActivity {
  const out: GarminActivity = {
    type: readType(raw),
    durationSec: Math.round(num(raw?.duration) ?? 0),
  };
  const distanceM = num(raw?.distance);
  if (distanceM !== undefined) out.distanceM = distanceM;
  if (typeof raw?.activityName === "string" && raw.activityName.length) out.name = raw.activityName;
  if (typeof raw?.startTimeLocal === "string" && raw.startTimeLocal.length) out.startLocal = raw.startTimeLocal;
  return out;
}

/** The icon + colour-class + label for one activity type. */
export interface ActivityDisplay {
  label: string;
  /** A Tailwind text-colour utility backed by a CSS-var token. */
  colorClass: string;
  icon: LucideIcon;
}

/**
 * Friendly type → display. One distinct colour per type (existing CSS-var
 * tokens); unknown types fall through to a muted generic Activity icon.
 * Keys are Garmin `typeKey`s (lowercased) plus a few common synonyms.
 */
export const ACTIVITY_DISPLAY: Record<string, ActivityDisplay> = {
  running: { label: "Run", colorClass: "text-ok", icon: Footprints },
  treadmill_running: { label: "Run", colorClass: "text-ok", icon: Footprints },
  trail_running: { label: "Run", colorClass: "text-ok", icon: Footprints },
  walking: { label: "Walk", colorClass: "text-ok", icon: Footprints },
  strength_training: { label: "Strength", colorClass: "text-accent2Strong", icon: Dumbbell },
  cycling: { label: "Ride", colorClass: "text-accentStrong", icon: Bike },
  road_biking: { label: "Ride", colorClass: "text-accentStrong", icon: Bike },
  indoor_cycling: { label: "Ride", colorClass: "text-accentStrong", icon: Bike },
  mountain_biking: { label: "Ride", colorClass: "text-accentStrong", icon: Bike },
  lap_swimming: { label: "Swim", colorClass: "text-warn", icon: Waves },
  open_water_swimming: { label: "Swim", colorClass: "text-warn", icon: Waves },
  swimming: { label: "Swim", colorClass: "text-warn", icon: Waves },
};

/** Muted generic fallback for any unmapped activity type. */
const UNKNOWN_DISPLAY: ActivityDisplay = { label: "Workout", colorClass: "text-muted", icon: Activity };

/** The display (icon + colour + label) for a friendly activity type. */
export function activityDisplay(type: string): ActivityDisplay {
  return ACTIVITY_DISPLAY[type] ?? UNKNOWN_DISPLAY;
}

/**
 * Parse the PLAINTEXT `activitiesJson` column into a GarminActivity[]. Defensive:
 * null/empty → `[]`, malformed JSON → `[]` (never throws — a bad row must not
 * break the whole month grid), non-array → `[]`. Used on the month + wellness
 * read paths where `raw` is never decrypted.
 */
export function parseActivitiesJson(json: string | null | undefined): GarminActivity[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as GarminActivity[]) : [];
  } catch {
    return [];
  }
}

/**
 * Compact workout duration: seconds → "1h 12m" / "30m" / "45s". Drops the hours
 * part when zero (a 30-min lift reads "30m", not "0h 30m"), and only shows raw
 * seconds for sub-minute activities.
 */
export function fmtActivityDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Distance metres → "5.0 km" (≥1 km) or "850 m" (<1 km). */
export function fmtActivityDistance(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres)} m`;
}
