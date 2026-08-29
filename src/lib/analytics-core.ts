import { expandBlendDose, rollUpExposure, type ExposureRow } from "./blends-core";

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
  /** Frozen phone-local tracking day (02:00 rollover), when available. */
  localDay?: string | null;
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
 * logs fell on each tracking day. A frozen phone-local localDay wins; legacy
 * rows fall back to the runtime-local date of takenAt.
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
    // Stamped rows may sit on the previous tracking day even though their UTC
    // instant falls just outside that day's runtime window. Bucket membership,
    // not the server-local instant, is authoritative for those rows.
    if (!log.localDay && (log.takenAt < window.from || log.takenAt > end)) continue;
    const key = log.localDay ?? KEY(log.takenAt);
    const idx = bucketIndex.get(key);
    if (idx !== undefined) buckets[idx].count++;
  }

  return buckets;
}

/** One grouped dose-sum row — the shape of `groupBy(["preparationId","protocolId"])`. */
export interface DoseSumRow {
  preparationId: string | null;
  protocolId: string | null;
  totalMcg: number;
}

/** What a preparation id or protocol id resolves to. */
export interface PeptideRef {
  peptideId: string;
  name: string;
}

/**
 * Cumulative exposure, all time — PURE. No I/O; the caller supplies the grouped
 * dose sums and the two id→peptide lookups.
 *
 * Two rules this encodes, both of which were once defects:
 *
 * 1. EVERY dose counts, including ad-hoc ones with no protocol. Filtering to
 *    protocol-linked doses made this table disagree with the CSV and PDF
 *    exports, which have always included them.
 * 2. A dose resolves its peptide PREPARATION-first, protocol-second — the exact
 *    precedence the exports use — so the surfaces cannot drift apart again.
 *
 * A dose that resolves to neither is skipped rather than guessed at. Blend
 * parents never appear under their own name: their mass is expanded into the
 * components they deliver, which then aggregate with those compounds' standalone
 * history. The roll-up is keyed by NAME so derived rows merge with standalone
 * ones, and `rollUpExposure` accumulates on key collision — two peptide rows can
 * share a name, since nothing constrains it.
 */
export function buildExposureRollup(args: {
  doseSums: DoseSumRow[];
  prepPeptide: Map<string, PeptideRef>;
  protoPeptide: Map<string, PeptideRef>;
  componentsByBlendId: Map<string, { name: string; mg: number }[]>;
}): ExposureRow[] {
  const { doseSums, prepPeptide, protoPeptide, componentsByBlendId } = args;
  const blendIds = new Set(componentsByBlendId.keys());
  const standaloneByPeptide = new Map<string, { peptideName: string; totalMcg: number }>();
  const blendTotals = new Map<string, number>();

  for (const row of doseSums) {
    const pep =
      (row.preparationId ? prepPeptide.get(row.preparationId) : undefined) ??
      (row.protocolId ? protoPeptide.get(row.protocolId) : undefined);
    if (!pep) continue;
    if (blendIds.has(pep.peptideId)) {
      blendTotals.set(pep.peptideId, (blendTotals.get(pep.peptideId) ?? 0) + row.totalMcg);
    } else {
      const cur = standaloneByPeptide.get(pep.peptideId);
      if (cur) cur.totalMcg += row.totalMcg;
      else standaloneByPeptide.set(pep.peptideId, { peptideName: pep.name, totalMcg: row.totalMcg });
    }
  }

  const derived = [...blendTotals.entries()].flatMap(([blendId, totalMcg]) =>
    expandBlendDose(
      totalMcg,
      (componentsByBlendId.get(blendId) ?? []).map((c, i) => ({
        componentPeptideId: c.name, // roll-up key: name (stable across environments)
        componentName: c.name,
        massMg: c.mg,
        source: "label" as const,
        sortIndex: i,
      })),
    ),
  );

  return rollUpExposure({
    standalone: [...standaloneByPeptide.values()].map((v) => ({
      peptideId: v.peptideName, // keyed by name so derived rows merge correctly
      peptideName: v.peptideName,
      totalMcg: v.totalMcg,
    })),
    derived,
  });
}
