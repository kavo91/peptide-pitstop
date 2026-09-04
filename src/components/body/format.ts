/**
 * Shared presentational helpers for the /body cards. Pure — no I/O, no hooks —
 * so both server and client components can import them.
 *
 * Copy rule: this view shows measurements and what was logged alongside them.
 * Nothing in here attributes a change to any compound, food, training or event.
 */
import type { ChangeTier, Comparability, DeltaFlag, Precision } from "@/lib/body-comp-core";
import { BODY_COPY } from "@/lib/bodycomp-copy";

export const CARD = "rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10";
export const SECTION_TITLE = "mb-3 text-sm font-medium text-muted";
export const PILL = "inline-block whitespace-nowrap rounded-control px-1.5 py-0.5 text-[10px] font-medium";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Locale-independent date label (avoids SSR/browser locale hydration mismatch). */
export function fmtDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function fmtDateShort(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
}

/** Number → fixed string; em dash for null/NaN. */
export function num(n: number | null | undefined, digits = 1): string {
  return n == null || !Number.isFinite(n) ? "—" : n.toFixed(digits);
}

/** Signed number with a true minus sign. */
export function signed(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n.toFixed(digits);
  if (n > 0) return `+${s}`;
  return s.startsWith("-") ? `−${s.slice(1)}` : s;
}

export function pct(n: number | null | undefined, digits = 0): string {
  return n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(digits)} %`;
}

/**
 * Three-tier change pill. Deliberately grey / amber / blue — never green or red,
 * because a change beyond the noise band is not a verdict in either direction.
 */
export function tierPill(tier: ChangeTier): { cls: string; label: string } {
  switch (tier) {
    case "within_noise":
      return { cls: `${PILL} bg-line/[0.08] text-muted`, label: "within noise" };
    case "indeterminate":
      return { cls: `${PILL} bg-warn/10 text-warn`, label: "indeterminate" };
    case "exceeds_lsc":
      return { cls: `${PILL} bg-accent/10 text-accentStrong`, label: "exceeds LSC" };
  }
}

/**
 * Flag label for a `DeltaFlag`. A flag demoted for reduced comparability is
 * labelled from the tier its numbers give plus "(demoted)" — the same string on
 * the page and in the PDF — so no surface prints "within noise" beside a
 * multiple that exceeds the band.
 */
export function flagLabel(f: DeltaFlag): string {
  const tier = f.demoted && f.rawTier ? f.rawTier : f.tier;
  return f.demoted ? `${tierPill(tier).label} (${BODY_COPY.flagDemoted})` : tierPill(tier).label;
}

/** Pill for a `DeltaFlag`: demoted flags take the amber (indeterminate) styling whatever their raw tier. */
export function flagPill(f: DeltaFlag): { cls: string; label: string; title?: string } {
  if (!f.demoted) return tierPill(f.tier);
  return { cls: tierPill("indeterminate").cls, label: flagLabel(f), title: `${tierPill(f.rawTier ?? f.tier).label} on the numbers; read as ${tierPill(f.tier).label} — ${BODY_COPY.reducedComparability}` };
}

export function comparabilityPill(c: Comparability): { cls: string; label: string; title?: string } {
  if (c.hidden) return { cls: `${PILL} bg-danger/10 text-danger`, label: BODY_COPY.notComparable, title: c.reasons.join("; ") };
  if (c.demote) return { cls: `${PILL} bg-warn/10 text-warn`, label: BODY_COPY.reducedComparability, title: c.reasons.join("; ") };
  return { cls: `${PILL} bg-line/[0.08] text-muted`, label: "comparable" };
}

/** Lab flag badge — the same classes the bloodwork page uses. */
export function labFlagBadge(flag: string | null): { cls: string; label: string } | null {
  switch (flag) {
    case "low": return { cls: "bg-danger/10 text-danger", label: "Low" };
    case "high": return { cls: "bg-danger/10 text-danger", label: "High" };
    case "borderline": return { cls: "bg-warn/10 text-warn", label: "Borderline" };
    case "normal": return { cls: "bg-ok/10 text-ok", label: "Normal" };
    default: return null;
  }
}

/** Where the LSC bands come from — "default LSC" until an own/clinic row exists. */
export function precisionLabel(p: Precision): string {
  switch (p.source) {
    case "clinic_supplied": return "clinic-supplied precision";
    case "measured_own": return "own repeat-scan precision";
    case "iscd_min": return "ISCD minimum acceptable precision";
    default: return BODY_COPY.defaultLsc;
  }
}

export function methodLabel(method: string): string {
  switch (method) {
    case "ic_vo2_only": return "indirect calorimetry · VO2 only";
    case "ic_vo2_vco2": return "indirect calorimetry · VO2 + VCO2";
    default: return method.replace(/_/g, " ");
  }
}

/** A scanner serial is shown masked: enough to tell two machines apart, never the whole id. */
export function maskSerial(serial: string | null): string {
  if (!serial) return "serial not recorded";
  return serial.length <= 4 ? `serial ${serial}` : `serial …${serial.slice(-4)}`;
}

export function tri(v: boolean | null): string {
  return v == null ? "unknown" : v ? "yes" : "no";
}
