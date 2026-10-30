/**
 * Pure Garmin ↔ Eight Sleep sleep comparison. NO I/O.
 *
 * - Coverage: how many nights each device saw, and how many both saw.
 * - Differences: per-metric averages over the nights BOTH devices recorded,
 *   each device on its own, plus Eight Sleep minus Garmin. Nothing is blended.
 * - HRV: shown side by side only. The bed sensor and the watch use different
 *   methods, so no difference is computed for it.
 * - Awake: shown side by side without a difference, like HRV. Garmin counts awake
 *   time inside its sleep window; Eight Sleep rows hold its wake-after-sleep-onset
 *   (`wasoDuration`), or time in bed not asleep when a night has none
 *   or the row was written before that field was stored and never re-pulled.
 *   Close, but not the same measure on every night.
 * - Patterns: descriptive splits across the two devices (e.g. Garmin deep sleep
 *   on nights with more vs fewer Eight Sleep toss & turns). Observations only —
 *   every pattern says "Pattern, not cause", prints n and the gap, and appears
 *   only when each group has at least PATTERN_MIN_N nights. The product stays
 *   neutral tracking: no advice, no judgement words.
 * - The comparison uses Garmin's own nights only: a night the watch series got
 *   wholly from Apple Health (source "healthkit") is not a Garmin night here.
 */
import type { SleepPair, GarminNight, EightSleepNightFull } from "./sleep-pairs";

export const PATTERN_MIN_N = 5;
/** Window the comparison card covers (journal + sleep detail page). */
export const SLEEP_COMPARE_DAYS = 90;

export interface Coverage {
  both: number;
  garminOnly: number;
  eightSleepOnly: number;
}

export type DiffKey = "asleep" | "deep" | "rem" | "awake" | "score";

export interface Difference {
  key: DiffKey;
  label: string;
  unit: "duration" | "score";
  /** Shared nights where both devices have this metric. */
  n: number;
  garminAvg: number | null;
  eightSleepAvg: number | null;
  /** eightSleepAvg − garminAvg (same n); null when the metric is not comparable. */
  diff: number | null;
  /** False when the devices define the metric differently (no difference shown). */
  comparable: boolean;
}

export interface HrvSideBySide {
  /** Shared nights where both devices have an HRV reading. */
  n: number;
  garminAvg: number | null;
  eightSleepAvg: number | null;
}

export interface Pattern {
  id: string;
  text: string;
  nLow: number;
  nHigh: number;
}

export interface PatternWaiting {
  id: string;
  label: string;
  /** Nights in the smaller of the two groups today. */
  have: number;
  need: number;
  /** "no-spread": every night has the same value, so there is nothing to split. */
  reason: "few-nights" | "no-spread";
}

export interface SleepComparison {
  coverage: Coverage;
  differences: Difference[];
  hrv: HrvSideBySide;
  patterns: Pattern[];
  waiting: PatternWaiting[];
}

type Both = { garmin: GarminNight; eightSleep: EightSleepNightFull };

const DIFFS: { key: DiffKey; label: string; unit: "duration" | "score"; comparable: boolean }[] = [
  { key: "asleep", label: "Time asleep", unit: "duration", comparable: true },
  { key: "deep", label: "Deep", unit: "duration", comparable: true },
  { key: "rem", label: "REM", unit: "duration", comparable: true },
  { key: "awake", label: "Awake", unit: "duration", comparable: false },
  { key: "score", label: "Sleep score", unit: "score", comparable: true },
];

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** "7 h 05 m" / "48 m" from seconds. */
export function formatDuration(seconds: number): string {
  const m = Math.round(Math.abs(seconds) / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h} h ${String(mm).padStart(2, "0")} m` : `${mm} m`;
}

function fmt(unit: "duration" | "score", v: number): string {
  return unit === "duration" ? formatDuration(v) : String(Math.round(v));
}

interface PatternDef {
  id: string;
  label: string;
  /** Splits the shared nights by this value (median). */
  split: (b: Both) => number | null;
  splitHigh: string;
  splitLow: string;
  /** The other device's metric compared between the two groups. */
  measure: (b: Both) => number | null;
  measureLabel: string;
  unit: "duration" | "score";
}

const PATTERNS: PatternDef[] = [
  {
    id: "tnt-garmin-deep",
    label: "Eight Sleep toss & turns vs Garmin deep sleep",
    split: (b) => b.eightSleep.tossTurns,
    splitHigh: "more toss & turns on Eight Sleep",
    splitLow: "fewer toss & turns",
    measure: (b) => b.garmin.deep,
    measureLabel: "Garmin deep sleep",
    unit: "duration",
  },
  {
    id: "bedhr-garmin-score",
    label: "Eight Sleep sleeping heart rate vs Garmin sleep score",
    split: (b) => b.eightSleep.sleepHrAvg,
    splitHigh: "a higher sleeping heart rate on Eight Sleep",
    splitLow: "a lower sleeping heart rate",
    measure: (b) => b.garmin.score,
    measureLabel: "Garmin sleep score",
    unit: "score",
  },
  {
    id: "bedtemp-garmin-deep",
    label: "Eight Sleep bed temperature vs Garmin deep sleep",
    split: (b) => b.eightSleep.bedTempC,
    splitHigh: "a warmer bed on Eight Sleep",
    splitLow: "a cooler bed",
    measure: (b) => b.garmin.deep,
    measureLabel: "Garmin deep sleep",
    unit: "duration",
  },
  {
    id: "garmin-score-eight-score",
    label: "Garmin sleep score vs Eight Sleep score",
    split: (b) => b.garmin.score,
    splitHigh: "a higher Garmin sleep score",
    splitLow: "a lower Garmin sleep score",
    measure: (b) => b.eightSleep.score,
    measureLabel: "Eight Sleep score",
    unit: "score",
  },
];

/**
 * Median split: nights at or below the median → low group, above → high.
 * A pattern needs both a split value and a measure on a night to use it.
 */
function evaluatePattern(def: PatternDef, shared: Both[]): Pattern | PatternWaiting | null {
  const rows = shared
    .map((b) => ({ s: def.split(b), m: def.measure(b) }))
    .filter((r): r is { s: number; m: number } => r.s != null && r.m != null);
  // A field this device never reports (e.g. bed temperature on some Pods) → no pattern at all.
  if (!shared.some((b) => def.split(b) != null)) return null;

  const sorted = [...rows].sort((a, b) => a.s - b.s);
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)].s : 0;
  const low = sorted.filter((r) => r.s <= median);
  const high = sorted.filter((r) => r.s > median);
  const have = Math.min(low.length, high.length);
  if (have < PATTERN_MIN_N) {
    // Enough nights but one value on all of them: waiting for more nights would never help.
    const noSpread = sorted.length >= 2 * PATTERN_MIN_N && high.length === 0;
    return { id: def.id, label: def.label, have, need: PATTERN_MIN_N, reason: noSpread ? "no-spread" : "few-nights" };
  }

  const lowAvg = mean(low.map((r) => r.m))!;
  const highAvg = mean(high.map((r) => r.m))!;
  return {
    id: def.id,
    nLow: low.length,
    nHigh: high.length,
    text:
      `Pattern, not cause: on nights with ${def.splitHigh} (n=${high.length}), ` +
      `${def.measureLabel} averaged ${fmt(def.unit, highAvg)}; ` +
      `on nights with ${def.splitLow} (n=${low.length}) it averaged ${fmt(def.unit, lowAvg)} ` +
      `(a gap of ${fmt(def.unit, Math.abs(highAvg - lowAvg))}).`,
  };
}

/** A Garmin night for the comparison: not one the watch series took wholly from Apple Health. */
function garminOwn(p: SleepPair): GarminNight | null {
  return p.garmin && p.garmin.source !== "healthkit" ? p.garmin : null;
}

export function compareSleep(allPairs: SleepPair[]): SleepComparison {
  const pairs = allPairs.map((p) => ({ ...p, garmin: garminOwn(p) }));
  const shared = pairs.filter((p): p is SleepPair & Both => p.garmin != null && p.eightSleep != null);

  const coverage: Coverage = {
    both: shared.length,
    garminOnly: pairs.filter((p) => p.garmin && !p.eightSleep).length,
    eightSleepOnly: pairs.filter((p) => p.eightSleep && !p.garmin).length,
  };

  const differences: Difference[] = DIFFS.map(({ key, label, unit, comparable }) => {
    const rows = shared
      .map((b) => ({ g: b.garmin[key], e: b.eightSleep[key] }))
      .filter((r): r is { g: number; e: number } => r.g != null && r.e != null);
    const garminAvg = mean(rows.map((r) => r.g));
    const eightSleepAvg = mean(rows.map((r) => r.e));
    return {
      key,
      label,
      unit,
      n: rows.length,
      garminAvg,
      eightSleepAvg,
      diff: comparable && garminAvg != null && eightSleepAvg != null ? eightSleepAvg - garminAvg : null,
      comparable,
    };
  });

  const hrvRows = shared
    .map((b) => ({ g: b.garmin.hrvMs, e: b.eightSleep.hrvMs }))
    .filter((r): r is { g: number; e: number } => r.g != null && r.e != null);
  const hrv: HrvSideBySide = {
    n: hrvRows.length,
    garminAvg: mean(hrvRows.map((r) => r.g)),
    eightSleepAvg: mean(hrvRows.map((r) => r.e)),
  };

  const patterns: Pattern[] = [];
  const waiting: PatternWaiting[] = [];
  for (const def of PATTERNS) {
    const r = evaluatePattern(def, shared);
    if (r == null) continue;
    if ("text" in r) patterns.push(r);
    else waiting.push(r);
  }

  return { coverage, differences, hrv, patterns, waiting };
}

/** "+18 m" / "−4" style signed difference for display. */
export function formatSignedDiff(d: Difference): string {
  if (d.diff == null) return "—";
  // Round the magnitude once (whole minutes / whole points) and take the sign from
  // it, so −0.3 prints "±0" and −0.5 prints "−1" — never "−0" or "±1".
  const mag = d.unit === "duration" ? Math.round(Math.abs(d.diff) / 60) : Math.round(Math.abs(d.diff));
  const sign = mag === 0 ? "±" : d.diff > 0 ? "+" : "−";
  return `${sign}${d.unit === "duration" ? formatDuration(mag * 60) : String(mag)}`;
}
