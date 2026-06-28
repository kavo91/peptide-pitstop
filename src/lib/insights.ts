/**
 * Cross-metric insights — PURE, descriptive, honest. NO I/O, no Prisma, no crypto.
 *
 * PHILOSOPHY (load-bearing): every insight is a plain DESCRIPTIVE comparison with
 * its sample sizes shown. These are NOT causal claims and NOT inferential
 * statistics. We never compute p-values, correlation coefficients, or say
 * "significant" / "caused by". When a comparison has too few data points on
 * either side (below MIN_SAMPLE), we SKIP the insight rather than show noise.
 *
 * The caller loads + decrypts the data (wearable rows, dose dates, journal
 * entries with deserialized side-effects) and hands this module a plain typed
 * object. The page renders each {title, detail, samples} and prepends the
 * "Observational — not medical advice; correlation ≠ causation" disclaimer.
 */

import type { SideEffectEntry, Severity } from "./side-effects";

/** Min data points required on EACH side of a comparison before we'll show it. */
export const MIN_SAMPLE = 5;

/** A wearable daily row — only the metrics insights use. `date` is local-midnight. */
export interface InsightWearableRow {
  date: Date;
  sleepSeconds: number | null;
  restingHr: number | null;
  bodyBatteryHigh: number | null;
}

/** A journal entry — already decrypted; side-effects already deserialized. */
export interface InsightJournalEntry {
  date: Date;
  weight: number | null;
  weightUnit: string | null;
  calories: number | null;
  proteinG: number | null;
  waterMl: number | null;
  sideEffects: SideEffectEntry[];
}

export interface InsightWindow {
  from: Date;
  to: Date;
}

export interface InsightInput {
  /** Timestamps of taken doses (DoseLog.takenAt). */
  doseDates: Date[];
  /** Wearable daily rows in the window. */
  wearable: InsightWearableRow[];
  /** Journal entries in the window (decrypted, side-effects deserialized). */
  journal: InsightJournalEntry[];
  /** The analytics window (e.g. trailing 90 days). */
  window: InsightWindow;
  /**
   * Overall adherence percentage over the window (reuse the existing adherence
   * calc), or null when there's no resolved schedule data. Paired with weight
   * trend as a NEUTRAL observation — never framed as cause.
   */
  adherencePct: number | null;
  /** "now" — anchors the rolling weight-trend windows (30/60/90 days). */
  now: Date;
}

export type InsightKind =
  | "sleep_dose"
  | "resting_hr_dose"
  | "body_battery_dose"
  | "weight_trend"
  | "side_effect_frequency"
  | "side_effect_timing"
  | "adherence_weight";

export interface Insight {
  id: string;
  title: string;
  detail: string;
  /** Sample sizes behind the comparison (the two sides), or null when N/A. */
  samples: { a: number; b: number } | null;
  kind: InsightKind;
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Local-date key YYYY-MM-DD — same convention as analytics-core. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function inWindow(d: Date, w: InsightWindow): boolean {
  return d >= w.from && d <= w.to;
}

/**
 * Split a wearable metric into dose-day vs non-dose-day buckets and build the
 * insight if BOTH sides clear MIN_SAMPLE. Generic over the three wearable
 * comparisons (sleep, resting HR, body battery). `format` renders the average.
 */
function doseSplitInsight(opts: {
  id: string;
  kind: InsightKind;
  title: string;
  doseDayKeys: Set<string>;
  rows: InsightWearableRow[];
  pick: (r: InsightWearableRow) => number | null;
  format: (avgDose: number, avgOther: number) => string;
}): Insight | null {
  const onDose: number[] = [];
  const offDose: number[] = [];
  for (const r of opts.rows) {
    const v = opts.pick(r);
    if (v == null || !Number.isFinite(v)) continue;
    if (opts.doseDayKeys.has(dayKey(r.date))) onDose.push(v);
    else offDose.push(v);
  }
  if (onDose.length < MIN_SAMPLE || offDose.length < MIN_SAMPLE) return null;
  const avgDose = mean(onDose);
  const avgOther = mean(offDose);
  return {
    id: opts.id,
    kind: opts.kind,
    title: opts.title,
    detail: opts.format(avgDose, avgOther),
    samples: { a: onDose.length, b: offDose.length },
  };
}

/** Weight points (same-unit), ascending by date, with their day. */
interface WeightPoint {
  date: Date;
  value: number;
  unit: string;
}

/**
 * Build the weight-trend detail for a single look-back window. Compares the
 * latest point with the earliest point INSIDE the window, in a single unit.
 * Returns null when there are fewer than MIN_SAMPLE same-unit points in the
 * window (skip noise) — direction comes from the sign of (latest − earliest).
 */
function weightTrendForWindow(
  points: WeightPoint[],
  now: Date,
  days: number,
): { label: string; samples: number } | null {
  const cutoff = new Date(now.getTime() - days * MS_PER_DAY);
  const inWin = points.filter((p) => p.date >= cutoff && p.date <= now);
  if (inWin.length < MIN_SAMPLE) return null;
  const earliest = inWin[0];
  const latest = inWin[inWin.length - 1];
  const delta = round1(latest.value - earliest.value);
  const unit = latest.unit;
  let dir: string;
  if (delta > 0) dir = `up ${Math.abs(delta)} ${unit}`;
  else if (delta < 0) dir = `down ${Math.abs(delta)} ${unit}`;
  else dir = `no change (${unit})`;
  return { label: `${days}d: ${dir} (n=${inWin.length})`, samples: inWin.length };
}

/** Most-common severity among entries, or null when none are graded. */
function topSeverity(severities: (Severity | null)[]): Severity | null {
  const counts: Record<Severity, number> = { mild: 0, moderate: 0, severe: 0 };
  let any = false;
  for (const s of severities) {
    if (s) {
      counts[s]++;
      any = true;
    }
  }
  if (!any) return null;
  return (Object.keys(counts) as Severity[]).sort((a, b) => counts[b] - counts[a])[0];
}

/**
 * Compute descriptive cross-metric insights. Every insight that fails its
 * min-sample guard is SKIPPED (omitted), so the result is only the insights we
 * can honestly show. The order is stable: sleep, resting HR, body battery,
 * weight trend, side-effect frequency, side-effect timing, adherence vs weight.
 */
export function computeInsights(input: InsightInput): Insight[] {
  const { wearable, journal, window, doseDates, now, adherencePct } = input;
  const out: Insight[] = [];

  // Dose days (within the window) as a Set of local-date keys.
  const doseInWindow = doseDates.filter((d) => inWindow(d, window));
  const doseDayKeys = new Set(doseInWindow.map(dayKey));

  // Wearable rows clipped to the window.
  const wearRows = wearable.filter((r) => inWindow(r.date, window));

  // ── 1. Sleep on dose days vs non-dose days ────────────────────────────────
  const sleep = doseSplitInsight({
    id: "sleep_dose",
    kind: "sleep_dose",
    title: "Sleep on dose days vs other days",
    doseDayKeys,
    rows: wearRows,
    pick: (r) => (r.sleepSeconds != null ? r.sleepSeconds / 3600 : null),
    format: (a, b) =>
      `Avg sleep: ${round1(a)}h on dose days vs ${round1(b)}h on other days.`,
  });
  if (sleep) out.push(sleep);

  // ── 2. Resting HR on dose vs non-dose days ────────────────────────────────
  const rhr = doseSplitInsight({
    id: "resting_hr_dose",
    kind: "resting_hr_dose",
    title: "Resting heart rate on dose days vs other days",
    doseDayKeys,
    rows: wearRows,
    pick: (r) => r.restingHr,
    format: (a, b) =>
      `Avg resting HR: ${Math.round(a)} bpm on dose days vs ${Math.round(b)} bpm on other days.`,
  });
  if (rhr) out.push(rhr);

  // ── 3. Body Battery (high) on dose vs non-dose days ───────────────────────
  const bb = doseSplitInsight({
    id: "body_battery_dose",
    kind: "body_battery_dose",
    title: "Body Battery (daily high) on dose days vs other days",
    doseDayKeys,
    rows: wearRows,
    pick: (r) => r.bodyBatteryHigh,
    format: (a, b) =>
      `Avg Body Battery high: ${Math.round(a)} on dose days vs ${Math.round(b)} on other days.`,
  });
  if (bb) out.push(bb);

  // ── 4. Weight trend over 30 / 60 / 90 days ────────────────────────────────
  // Don't mix units: keep only points whose unit matches the most-recent unit.
  const weightAll = journal
    .filter((e) => e.weight != null && Number.isFinite(e.weight) && e.weightUnit)
    .map((e) => ({ date: e.date, value: e.weight as number, unit: e.weightUnit as string }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  let weightWindows: { label: string; samples: number }[] = [];
  if (weightAll.length) {
    const recentUnit = weightAll[weightAll.length - 1].unit;
    const sameUnit = weightAll.filter((p) => p.unit === recentUnit);
    weightWindows = [30, 60, 90]
      .map((d) => weightTrendForWindow(sameUnit, now, d))
      .filter((w): w is { label: string; samples: number } => w != null);
  }
  if (weightWindows.length) {
    out.push({
      id: "weight_trend",
      kind: "weight_trend",
      title: "Weight trend",
      detail: weightWindows.map((w) => w.label).join("  ·  "),
      samples: null,
    });
  }

  // ── 5. Most-frequent side-effects over the window ─────────────────────────
  const seEntriesInWindow: { date: Date; entry: SideEffectEntry }[] = [];
  for (const e of journal) {
    if (!inWindow(e.date, window)) continue;
    for (const se of e.sideEffects) {
      if (se.symptom) seEntriesInWindow.push({ date: e.date, entry: se });
    }
  }
  if (seEntriesInWindow.length) {
    // Count by symptom (case-insensitive key, keep first-seen display casing).
    const counts = new Map<string, { display: string; count: number; sev: (Severity | null)[] }>();
    for (const { entry } of seEntriesInWindow) {
      const k = entry.symptom.toLowerCase();
      const rec = counts.get(k) ?? { display: entry.symptom, count: 0, sev: [] };
      rec.count++;
      rec.sev.push(entry.severity);
      counts.set(k, rec);
    }
    const ranked = [...counts.values()].sort(
      (a, b) => b.count - a.count || a.display.localeCompare(b.display),
    );
    const TOP_N = 3;
    const top = ranked.slice(0, TOP_N);
    const detail = top
      .map((r) => {
        const sev = topSeverity(r.sev);
        const times = r.count === 1 ? "1 day" : `${r.count} days`;
        return sev ? `${r.display} — ${times} (mostly ${sev})` : `${r.display} — ${times}`;
      })
      .join("; ");
    out.push({
      id: "side_effect_frequency",
      kind: "side_effect_frequency",
      title: "Most-logged side-effects",
      detail,
      samples: null,
    });
  }

  // ── 6. Side-effect timing relative to dosing ──────────────────────────────
  // For each side-effect DAY, hours since the most recent PRIOR dose; bucket.
  const sortedDoseTimes = [...doseDates]
    .map((d) => d.getTime())
    .sort((a, b) => a - b);
  // One bucket-assignment per journal DAY that has any side-effect (avoid
  // double-counting multiple symptoms on the same day).
  const seDays = new Map<string, Date>();
  for (const e of journal) {
    if (!inWindow(e.date, window)) continue;
    if (e.sideEffects.some((s) => s.symptom)) seDays.set(dayKey(e.date), e.date);
  }
  let b0 = 0; // 0–24h
  let b1 = 0; // 24–72h
  let b2 = 0; // >72h
  let timed = 0;
  for (const d of seDays.values()) {
    const t = d.getTime();
    // Most recent dose at or before this side-effect day.
    let prior: number | null = null;
    for (const dt of sortedDoseTimes) {
      if (dt <= t) prior = dt;
      else break;
    }
    if (prior == null) continue; // no prior dose → can't time it
    const hours = (t - prior) / MS_PER_HOUR;
    timed++;
    if (hours <= 24) b0++;
    else if (hours <= 72) b1++;
    else b2++;
  }
  if (timed >= MIN_SAMPLE) {
    out.push({
      id: "side_effect_timing",
      kind: "side_effect_timing",
      title: "Side-effect timing after a dose",
      detail: `Of ${timed} side-effect days with a prior dose: ${b0} within 24h, ${b1} at 24–72h, ${b2} after 72h.`,
      samples: null,
    });
  }

  // ── 7. Adherence vs weight trend (NEUTRAL pairing — not causal) ────────────
  // Only show when we have BOTH an adherence figure and a weight trend.
  if (adherencePct != null && weightWindows.length) {
    const longest = weightWindows[weightWindows.length - 1];
    out.push({
      id: "adherence_weight",
      kind: "adherence_weight",
      title: "Adherence alongside weight",
      detail: `Adherence ${adherencePct}% over the window. Weight ${longest.label}. Shown side by side — not a cause-and-effect claim.`,
      samples: null,
    });
  }

  return out;
}
