/** KEY — local-date string YYYY-MM-DD, zero-padded. Monday-first convention from doses-timeline. */
function KEY(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Milliseconds per day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AnalyticsWindow {
  from: Date;
  to: Date;
}

export interface PlannedDoseRow {
  scheduledAt: Date;
  status: "planned" | "taken" | "missed" | "skipped";
}

export interface LogRow {
  takenAt: Date;
}

export interface AdherenceResult {
  /** null when there are no resolved (taken|missed) rows in the window. */
  adherencePct: number | null;
  taken: number;
  missed: number;
  /** Inclusive day-span from the earliest to the latest scheduledAt in the window. */
  daysOfData: number;
}

/**
 * Compute adherence = taken / (taken + missed) over the window.
 * Rows with status "planned" or "skipped" are excluded from the denominator
 * (they are unresolved or intentionally skipped — not a failure).
 * daysOfData is 0 when there are no planned rows in the window.
 */
export function adherenceOverWindow(args: {
  planned: PlannedDoseRow[];
  logs: LogRow[];
  window: AnalyticsWindow;
}): AdherenceResult {
  const { planned, window } = args;

  const inWindow = planned.filter(
    (p) => p.scheduledAt >= window.from && p.scheduledAt <= window.to,
  );

  // Only resolved rows count — future `planned` rows in the window would
  // otherwise inflate both the denominator and the "N days of data" span.
  const resolved = inWindow.filter((p) => p.status === "taken" || p.status === "missed");
  const taken = resolved.filter((p) => p.status === "taken").length;
  const missed = resolved.filter((p) => p.status === "missed").length;
  const denominator = taken + missed;

  const adherencePct = denominator === 0 ? null : Math.round((taken / denominator) * 100);

  let daysOfData = 0;
  if (resolved.length > 0) {
    const times = resolved.map((p) => p.scheduledAt.getTime());
    const earliest = Math.min(...times);
    const latest = Math.max(...times);
    daysOfData = Math.round((latest - earliest) / MS_PER_DAY) + 1;
  }

  return { adherencePct, taken, missed, daysOfData };
}

export interface HeatmapBucket {
  dateKey: string; // YYYY-MM-DD
  count: number;
}

/**
 * Build one bucket per calendar day in the window (inclusive), counting how many
 * logs fell on each day by their takenAt local date.
 */
export function heatmapBuckets(args: {
  logs: LogRow[];
  window: AnalyticsWindow;
}): HeatmapBucket[] {
  const { logs, window } = args;

  // Build day list from window.from → window.to
  const buckets: HeatmapBucket[] = [];
  const cur = new Date(window.from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(window.to);
  end.setHours(23, 59, 59, 999);

  while (cur <= end) {
    buckets.push({ dateKey: KEY(new Date(cur)), count: 0 });
    cur.setDate(cur.getDate() + 1);
  }

  // Count logs into buckets
  const bucketIndex = new Map(buckets.map((b, i) => [b.dateKey, i]));
  for (const log of logs) {
    if (log.takenAt < window.from || log.takenAt > end) continue;
    const key = KEY(log.takenAt);
    const idx = bucketIndex.get(key);
    if (idx !== undefined) buckets[idx].count++;
  }

  return buckets;
}
