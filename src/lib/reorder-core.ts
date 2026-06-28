/**
 * Reorder status — pure logic, no I/O. Given a peptide's aggregated coverage
 * (doses on hand) and its consumption rate + lead time, decide whether it
 * needs reordering now. Consumption-only: expiry/refills are not considered.
 * See docs/superpowers/specs/2026-06-16-reorder-leadtime-design.md.
 */
export type ReorderStatus = "ok" | "reorder_now" | "unknown";

export interface ReorderInput {
  totalDoses: number | null;
  dosesPerWeek: number | null;
  leadTimeDays: number;
  bufferDays: number;
  today: Date;
}

export interface ReorderResult {
  status: ReorderStatus;
  coverageDays: number | null;
  depletionDate: string | null; // yyyy-mm-dd local
  reorderByDate: string | null; // yyyy-mm-dd local
  leadTimeDays: number;
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

export function assessReorder(input: ReorderInput): ReorderResult {
  const { totalDoses, dosesPerWeek, leadTimeDays, bufferDays, today } = input;
  if (totalDoses == null || dosesPerWeek == null || dosesPerWeek <= 0) {
    return { status: "unknown", coverageDays: null, depletionDate: null, reorderByDate: null, leadTimeDays };
  }
  const coverageDays = Math.round((totalDoses / dosesPerWeek) * 7);
  const depletion = addDays(today, coverageDays);
  const reorderBy = addDays(depletion, -leadTimeDays);
  const status: ReorderStatus = coverageDays <= leadTimeDays + bufferDays ? "reorder_now" : "ok";
  return {
    status,
    coverageDays,
    depletionDate: dayKey(depletion),
    reorderByDate: dayKey(reorderBy),
    leadTimeDays,
  };
}
