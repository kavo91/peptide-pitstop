/**
 * Supply-tile copy. Pure, so the wording is testable without React.
 *
 * Every string here is a supply/schedule FACT. None of it says whether to dose,
 * order, stop or continue — the product is tracking + neutral literature only.
 *
 * Dates go through `fmtCycleDay`, never raw ISO and never `Intl`: these strings
 * are built on the server, shipped to client components and asserted in tests,
 * so they must be byte-identical on every runtime (see cycle/format.ts).
 */
import { fmtCycleDay } from "./cycle/format";
import type { CoverageBasis, ReorderStatus } from "./reorder-forecast";

export interface SupplyCopyInput {
  status: ReorderStatus;
  coverageBasis: CoverageBasis | null;
  reorderByDate: string | null;
  courseEndDate: string | null;
  coverageDays: number | null;
  phaseToday: "on" | "off" | null;
  notStarted: boolean;
  firstDoseDate?: string | null;
}

/** "2026-08-20" → Date in LOCAL calendar fields (never UTC-parsed). */
function fromDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const fmt = (key: string | null): string | null => (key ? fmtCycleDay(fromDayKey(key)) : null);

/**
 * The qualifier appended when the protocol is not consuming today. Kept
 * separate from the main line so both design packs share one rule.
 */
export function supplyQualifier(item: SupplyCopyInput): string | null {
  if (item.notStarted && item.firstDoseDate) return `starts ${fmt(item.firstDoseDate)}`;
  if (item.notStarted) return "not started";
  if (item.phaseToday === "off") return "off week";
  return null;
}

/** Third line of the default (neon) pack. */
export function supplyLine(item: SupplyCopyInput): string {
  const base = (() => {
    // "for next cycle" is a supply fact, not advice: the demand the date keys
    // to is the PROJECTED restart of a repeating course (R30), and saying so is
    // what stops "Reorder by 12 Sep" reading as a mistake beside a tile that
    // also says the current cycle is covered.
    if (item.status === "reorder_now") {
      return item.coverageBasis === "projected_restart" ? "Reorder now for next cycle" : "Reorder now";
    }
    if (item.status === "unknown") return "Coverage unknown";
    if (item.status === "covered") {
      if (item.coverageBasis === "cycle_end" && item.courseEndDate) {
        return `Covers this cycle, to ${fmt(item.courseEndDate)}`;
      }
      if (item.coverageBasis === "course_end" && item.courseEndDate) {
        return `Covers doses to ${fmt(item.courseEndDate)}`;
      }
      // Only claim a year when the walk actually reached one. A schedule dense
      // enough to hit the slot cap is simulated for less than that, and
      // "beyond 12 months" beside a 266-day figure is a contradiction.
      if ((item.coverageDays ?? 0) >= 360) return "Covers doses beyond 12 months";
      if (item.courseEndDate) return `Covers doses to ${fmt(item.courseEndDate)}`;
      return "Covers doses beyond 12 months";
    }
    // ok — keeps its existing invariant: a real reorder-by date.
    if (item.reorderByDate) {
      return item.coverageBasis === "projected_restart"
        ? `Reorder by ${fmt(item.reorderByDate)} for next cycle`
        : `Reorder by ${fmt(item.reorderByDate)}`;
    }
    if (item.coverageDays != null) return `~${item.coverageDays} days remaining`;
    return "Coverage unknown";
  })();

  const q = supplyQualifier(item);
  return q ? `${base} · ${q}` : base;
}

/**
 * Pitstop sub-line suffix (after the peptide name). "soonest" is dropped once
 * nothing is queued — it means nothing when there is no reorder to be soonest.
 */
export function supplySuffix(item: SupplyCopyInput): string {
  const q = supplyQualifier(item);
  const basis = supplyBasis(item);
  // Append, never replace: returning the qualifier alone dropped the coverage
  // claim entirely on this pack, so the two designs disagreed about what the
  // same item said.
  return q ? (basis ? `${basis} · ${q}` : q) : (basis ?? "soonest");
}

function supplyBasis(item: SupplyCopyInput): string | null {
  if (item.status === "unknown") return "coverage unknown";
  // Both packs must state the same R30 fact, or the two designs disagree about
  // what the same item says — the exact drift this module exists to prevent.
  if (item.coverageBasis === "projected_restart" && item.reorderByDate) {
    return `next cycle — by ${fmt(item.reorderByDate)}`;
  }
  if (item.status === "covered") {
    if (item.coverageBasis === "cycle_end" && item.courseEndDate) {
      return `this cycle, to ${fmt(item.courseEndDate)}`;
    }
    if (item.coverageBasis === "course_end" && item.courseEndDate) {
      return `covered to ${fmt(item.courseEndDate)}`;
    }
    if ((item.coverageDays ?? 0) >= 360) return "12-month horizon";
    if (item.courseEndDate) return `covered to ${fmt(item.courseEndDate)}`;
    return "12-month horizon";
  }
  return null;
}

/** Accessible name for the tile — the `—` state otherwise announces nothing. */
export function supplyAriaLabel(name: string, item: SupplyCopyInput): string {
  return `Supply: ${name} — ${supplyLine(item)}`;
}
