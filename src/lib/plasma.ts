/**
 * Plasma-level model — single-compartment, first-order elimination,
 * instantaneous absorption. Pure — no I/O.
 *
 * Model: level(t) = Σ_doses  amountMcg · decayFraction(t − doseAt, halfLifeHours)
 *
 * Units are "mcg-equiv" (relative, not absolute serum concentration) — we lack
 * volume-of-distribution / bioavailability data. Label accordingly in UI.
 *
 * Uses a RELATIVE import for decayFraction (not @/lib/halflife) so that
 * plasma.test.ts can resolve the transitive import at vitest runtime.
 * vitest has no @/ alias; an @/ import here would cause the test suite to
 * fail with "Cannot find module '@/lib/halflife'".
 * Both files live in src/lib/, so the relative path is correct.
 * Leave @/-imports in analytics.ts and the page unchanged — those are not
 * unit-tested and Next.js resolves @/ at build time.
 */

import { decayFraction } from "./halflife";

export interface DosePoint {
  at: Date;
  amountMcg: number;
}

export interface PlasmaPoint {
  t: Date;
  level: number; // mcg-equiv relative level
}

/**
 * Generate a sampled plasma-level time series.
 *
 * @param doses      Historical + projected dose events (any order; past or future).
 * @param halfLifeHours  The peptide's half-life. null → returns [] immediately.
 * @param from       Series window start (inclusive).
 * @param to         Series window end (inclusive).
 * @param stepHours  Sampling interval in hours (e.g. 6).
 */
export function plasmaCurve(args: {
  doses: DosePoint[];
  halfLifeHours: number | null;
  from: Date;
  to: Date;
  stepHours: number;
}): PlasmaPoint[] {
  const { doses, halfLifeHours, from, to, stepHours } = args;

  if (halfLifeHours === null) return [];

  const HOUR = 60 * 60 * 1000;
  const fromMs = from.getTime();
  const endMs = to.getTime();

  // DOSE-ANCHORED sampling. A coarse step relative to the half-life ALIASES a
  // fast-decaying curve (e.g. Tα1, 2h, collapses ~8x between 6h samples), so a
  // dose's rendered peak would depend on how its clock time aligns to the grid
  // rather than its magnitude — making equal doses look unequal. But sampling the
  // WHOLE window finely emits thousands of mostly-zero points. Instead: resolve
  // the curve finely only where it changes fast (right after each dose) and stay
  // coarse elsewhere. (Points are time-ordered but not evenly spaced — every
  // consumer positions by timestamp.)
  const sampleTimes = new Set<number>();

  // 1. Coarse baseline grid — flat near-zero stretches + the slow accumulation of
  //    long-half-life peptides.
  const coarseMs = stepHours * HOUR;
  for (let t = fromMs; t <= endMs; t += coarseMs) sampleTimes.add(t);

  // 2. Around each in-window dose: the EXACT dose time (true peak — hoursElapsed=0
  //    → full amount, so equal doses render as equal spikes regardless of grid
  //    alignment), one fine step before it (baseline → a crisp onset, not a coarse
  //    ramp), and a fine decay tail at ~halfLife/4 until the dose has effectively
  //    cleared (~8 half-lives) or the window ends. `fineMs` is capped at the
  //    coarse step, so long-half-life peptides (Reta 144h) add nothing here —
  //    their coarse grid already resolves them; only short half-lives refine.
  const fineMs = Math.min(stepHours, Math.max(halfLifeHours / 4, 0.25)) * HOUR;
  const tailMs = Math.min(halfLifeHours * 8 * HOUR, endMs - fromMs);
  for (const dose of doses) {
    const dt = dose.at.getTime();
    if (dt < fromMs || dt > endMs) continue;
    sampleTimes.add(dt);
    const tailEnd = Math.min(dt + tailMs, endMs);
    for (let t = Math.max(dt - fineMs, fromMs); t <= tailEnd; t += fineMs) sampleTimes.add(t);
  }

  // 3. Evaluate the decay superposition at each sample time.
  const series: PlasmaPoint[] = [];
  for (const tMs of [...sampleTimes].sort((a, b) => a - b)) {
    let level = 0;
    for (const dose of doses) {
      const hoursElapsed = (tMs - dose.at.getTime()) / HOUR;
      if (hoursElapsed < 0) continue; // dose not yet administered at this sample
      level += dose.amountMcg * decayFraction(hoursElapsed, halfLifeHours);
    }
    series.push({ t: new Date(tMs), level });
  }

  return series;
}

/**
 * Split a plasma series into a historical segment (samples up to `now`) and a
 * forecast segment (samples from `now`), for drawing as two coloured lines on
 * one chart. When a sample lands exactly on `now` it is shared by both segments
 * so the lines join with no gap; otherwise the segments meet across the now-gap.
 */
export function splitSeriesAtNow(
  series: PlasmaPoint[],
  now: Date,
): { historical: PlasmaPoint[]; forecast: PlasmaPoint[] } {
  const nowMs = now.getTime();
  const historical = series.filter((p) => p.t.getTime() <= nowMs);
  const forecast = series.filter((p) => p.t.getTime() >= nowMs);
  return { historical, forecast };
}
