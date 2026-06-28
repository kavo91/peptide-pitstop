/**
 * Pure wellness/journal helpers — NO I/O, no Prisma, no crypto. Safe to unit
 * test and to call from server components. Operates on JournalEntry-like rows.
 *
 * `wellnessTrend` summarises the trailing 7 days into a small object the
 * dashboard WellnessTile and the /journal screen can render directly.
 */

const WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A row shaped like a Prisma JournalEntry — only the fields the trend needs. */
export interface WellnessEntryLike {
  date: Date;
  /** Prisma Decimal | number | string | null — anything with toString(). */
  weight?: number | string | { toString(): string } | null;
  weightUnit?: string | null;
  mood?: number | null;
  energy?: number | null;
}

export interface WellnessSparkPoint {
  date: Date;
  weight: number | null;
  mood: number | null;
}

export interface WellnessTrend {
  /** Most recent weight inside the window (in `weightUnit`), or null. */
  latestWeight: number | null;
  weightUnit: string | null;
  /**
   * Change from the earliest to the latest weight inside the window, in the
   * latest weight's unit. Null when there are fewer than two weight points or
   * the units don't match (no silent kg↔lb arithmetic).
   */
  weightDelta: number | null;
  /** Most recent mood (1–5) inside the window, or null. */
  latestMood: number | null;
  /** Most recent energy (1–5) inside the window, or null. */
  latestEnergy: number | null;
  /** Window points ascending by date — drives the sparkline. */
  points: WellnessSparkPoint[];
  hasData: boolean;
}

/** Coerce a Decimal/number/string into a finite number, else null. */
function toNum(v: number | string | { toString(): string } | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build a 7-day wellness summary. Considers only entries dated within
 * (now − 7 days, now]; future-dated rows are ignored.
 */
export function wellnessTrend(entries: WellnessEntryLike[], now: Date): WellnessTrend {
  const nowMs = now.getTime();
  const cutoff = nowMs - WINDOW_DAYS * DAY_MS;

  const inWindow = entries
    .filter((e) => {
      const t = e.date.getTime();
      return t > cutoff && t <= nowMs;
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const points: WellnessSparkPoint[] = inWindow.map((e) => ({
    date: e.date,
    weight: toNum(e.weight),
    mood: e.mood ?? null,
  }));

  // Weight points (with their unit) in ascending order.
  const weighted = inWindow
    .map((e) => ({ value: toNum(e.weight), unit: e.weightUnit ?? null }))
    .filter((w): w is { value: number; unit: string | null } => w.value != null);

  const earliestW = weighted.length ? weighted[0] : null;
  const latestW = weighted.length ? weighted[weighted.length - 1] : null;

  let weightDelta: number | null = null;
  if (earliestW && latestW && earliestW !== latestW && earliestW.unit === latestW.unit) {
    weightDelta = round2(latestW.value - earliestW.value);
  }

  // Latest non-null mood/energy (scan ascending, keep the last hit).
  let latestMood: number | null = null;
  let latestEnergy: number | null = null;
  for (const e of inWindow) {
    if (e.mood != null) latestMood = e.mood;
    if (e.energy != null) latestEnergy = e.energy;
  }

  return {
    latestWeight: latestW ? round2(latestW.value) : null,
    weightUnit: latestW ? latestW.unit : null,
    weightDelta,
    latestMood,
    latestEnergy,
    points,
    hasData: points.length > 0,
  };
}

// Structured side-effect (de)serialization + display now lives in `./side-effects`.
// Re-exported here so existing import sites keep working.
export {
  serializeSideEffects,
  deserializeSideEffects,
  formatSideEffects,
  type SideEffectEntry,
  type Severity,
} from "./side-effects";
