/**
 * Pure domain-value parsers — dependency-light (decimal.js only), no I/O. Server
 * actions feed raw client strings through these to coerce + validate before
 * persisting; each returns the canonical value or null (or an `{ ok }` result for
 * date ordering) so the caller can map a null to its own `{ ok: false, error }`.
 */
import Decimal from "decimal.js";

/** A finite, strictly-positive decimal → its canonical string; else null. Blank → null. */
export function parsePositiveDecimal(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  try {
    const d = new Decimal(s);
    return d.isFinite() && d.gt(0) ? d.toString() : null;
  } catch {
    return null;
  }
}

/** A finite, non-negative (>= 0) decimal → its canonical string; else null. Blank → null. */
export function parseNonNegativeDecimal(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  try {
    const d = new Decimal(s);
    return d.isFinite() && d.gte(0) ? d.toString() : null;
  } catch {
    return null;
  }
}

/** `v` if it is one of `allowed`, else null. Generic so callers keep the literal type. */
export function parseEnum<T extends string>(
  v: string | null | undefined,
  allowed: readonly T[],
): T | null {
  if (v == null) return null;
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

export type DateOrderResult = { ok: true } | { ok: false; error: string };

/** Coerce a Date or date-string to a valid Date, or null. */
function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Both inputs must parse to valid Dates with `start <= end`. A missing/invalid
 * date or a reversed range fails. Returns `{ ok: true }` when the order holds.
 */
export function parseDateOrder(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
): DateOrderResult {
  const s = toDate(start);
  const e = toDate(end);
  if (!s || !e) return { ok: false, error: "Both a valid start and end date are required." };
  if (s.getTime() > e.getTime()) {
    return { ok: false, error: "Start date must be on or before the end date." };
  }
  return { ok: true };
}
