/**
 * Reorder forecast — pure simulation, no I/O.
 *
 * Replaces the flat-rate extrapolation in `reorder-core.ts`. Instead of dividing
 * a dose count by a nominal weekly rate, this walks the protocol's REAL future
 * slots and draws each one from inventory until the stock cannot serve a slot.
 *
 * Rulings behind the non-obvious choices live in
 * docs/reorder-forecast-rulings.md; the ids
 * (R11, R14 …) are cited inline. The four that will look wrong without them:
 *
 *  - R14  A dose costs what the LOGGER charges — `computeDraw().deliveredVolumeMl`,
 *         the syringe-rounded volume that `actions/doses.ts` actually decrements —
 *         not the nominal volume. 2 mL @ 7500 mcg/mL at 500 mcg is 28 doses, not 30.
 *  - R16  All arithmetic in Decimal. `pool=0.3, need=0.1` in floats yields 2 doses,
 *         not 3. Note the engine import below is load-bearing beyond `computeDraw`:
 *         `Decimal` is a module singleton and `engine.ts` sets `precision: 40` at
 *         module scope, so importing it guarantees that config is applied before
 *         anything here runs. Dropping that import as "unused" would silently drop
 *         this module to decimal.js's default precision of 20.
 *  - R11  A reconstituted vial dies at its beyond-use date. Without this gate a
 *         365-day walk drains one prep across a year and reports comfort where the
 *         user will run dry — the worse direction to fail for this product.
 *  - R23  Planned off-weeks are NOT skipped. `today.ts` still renders those doses
 *         as due and the user injects them, so the forecast must cost them.
 */
import Decimal from "decimal.js";
import { computeDraw } from "./dosing/engine"; // side effect: Decimal precision 40
import type { DoseUnit, Syringe } from "./dosing/types";

export type ReorderStatus = "ok" | "reorder_now" | "covered" | "unknown";

/** Why coverage ended. Carried as data so the status set stays small (R1). */
export type CoverageBasis = "depletion" | "cycle_end" | "course_end" | "horizon";

export interface ForecastSlot {
  date: Date;
  /** From the resolver. `""` is its deliberate fail-safe sentinel (R12). */
  perInjectionValue: string;
  perInjectionUnit: DoseUnit;
}

export interface ForecastContainer {
  kind: "prep" | "sealed";
  /** in-use prep only */
  poolMl: Decimal | null;
  concentrationMcgPerMl: Decimal | null;
  /** sealed vial only — label strength in mcg */
  poolMcg: Decimal | null;
  /** Prep BUD, or a sealed vial's stamped expiry. Null = no known limit. */
  usableUntil: Date | null;
}

export interface ForecastInput {
  /** Ascending, already filtered to status ∈ {projected, pending} (R24). */
  slots: ForecastSlot[];
  containers: ForecastContainer[];
  syringe: Syringe;
  substanceClass: "mass" | "IU";
  /** False when parseSchedule yields nothing evaluable (R26). */
  scheduleEvaluable: boolean;
  /** Why the slot list stops, when it is not depletion. */
  stopReason: CoverageBasis;
  courseEndDate: Date | null;
  leadTimeDays: number;
  bufferDays: number;
  today: Date;
  /** BUD days applied to a sealed vial opened mid-walk (R11). */
  budDaysForSealed: number;
}

export interface ForecastResult {
  status: ReorderStatus;
  coverageDays: number | null;
  coverageBasis: CoverageBasis | null;
  depletionDate: string | null; // yyyy-mm-dd local
  reorderByDate: string | null;
  courseEndDate: string | null;
  leadTimeDays: number;
}

/** Local calendar day key, "yyyy-mm-dd". Exported for the DB layer. */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function addDays(d: Date, n: number): Date {
  const r = startOfDay(d);
  r.setDate(r.getDate() + n);
  return r;
}

const daysBetween = (a: Date, b: Date) =>
  Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);

/** A dose in mcg, or null when its unit needs a concentration we do not have. */
function doseToMcg(value: string, unit: DoseUnit): Decimal | null {
  const v = new Decimal(value);
  if (unit === "mcg") return v;
  if (unit === "mg") return v.times(1000);
  return null; // ml / units — a sealed vial has no concentration yet (D5)
}

/** Mutable per-container state for the walk. */
interface Live {
  container: ForecastContainer;
  poolMl: Decimal | null;
  poolMcg: Decimal | null;
  /** Set when a sealed vial is first drawn from — its BUD clock starts then. */
  expiresOn: Date | null;
  opened: boolean;
}

/**
 * Could this container price this dose at all, ignoring expiry and quantity?
 * A prep can size any unit (it has a concentration); a sealed vial can only
 * size a mass dose, since ml/units need a concentration it does not have yet.
 */
function canSize(c: Live, slot: ForecastSlot): boolean {
  if (c.container.kind === "prep") return c.poolMl != null && c.container.concentrationMcgPerMl != null;
  return doseToMcg(slot.perInjectionValue, slot.perInjectionUnit) != null;
}

const unknown = (leadTimeDays: number): ForecastResult => ({
  status: "unknown",
  coverageDays: null,
  coverageBasis: null,
  depletionDate: null,
  reorderByDate: null,
  courseEndDate: null,
  leadTimeDays,
});

export function forecastCoverage(input: ForecastInput): ForecastResult {
  const { slots, syringe, leadTimeDays, bufferDays, today } = input;

  // A schedule we cannot evaluate, or no future slots at all, is a DATA GAP.
  // Reporting it as "covered" would manufacture reassurance from missing
  // information — the worst available direction to fail (R3/R26).
  if (!input.scheduleEvaluable || slots.length === 0) return unknown(leadTimeDays);

  // IU substances are never mass-converted (R17; schema: "never auto-convert").
  if (input.substanceClass === "IU") return unknown(leadTimeDays);

  const live: Live[] = input.containers.map((c) => ({
    container: c,
    poolMl: c.poolMl ? new Decimal(c.poolMl) : null,
    poolMcg: c.poolMcg ? new Decimal(c.poolMcg) : null,
    expiresOn: c.usableUntil,
    opened: c.kind === "prep",
  }));

  let lastServed: Date | null = null;
  let depleted = false;

  for (const slot of slots) {
    // The resolver yields "" rather than guess a dose. Never build a Decimal
    // from it — `new Decimal("")` throws (R12).
    if (slot.perInjectionValue === "") return unknown(leadTimeDays);

    let served = false;
    // Did ANY container even understand this dose? A container that cannot be
    // evaluated (unmeasurable draw, ml dose against sealed stock, bad
    // concentration) must not veto a peptide that has perfectly good stock
    // behind it — but if NOTHING can evaluate the dose, that is a real
    // `unknown`, not a depletion.
    let evaluable = false;

    for (const c of live) {
      // Expired stock is not stock (R11) — but it is still stock we UNDERSTAND,
      // so it counts toward `evaluable`. Otherwise a peptide whose only vial has
      // passed its BUD would report "coverage unknown" instead of the truth,
      // which is that there is nothing usable left.
      if (c.expiresOn && startOfDay(slot.date) > startOfDay(c.expiresOn)) {
        if (canSize(c, slot)) evaluable = true;
        continue;
      }

      if (c.container.kind === "prep") {
        if (!c.poolMl || !c.container.concentrationMcgPerMl) continue;
        let deliveredMl: Decimal;
        try {
          // Cost the dose the way the write path does (R14). `need` is resolved
          // HERE, inside the container loop, because for an ml/units dose the
          // mass depends on THIS container's concentration (R13).
          deliveredMl = computeDraw({
            dose: { value: slot.perInjectionValue, unit: slot.perInjectionUnit },
            preparation: {
              prepType: "reconstituted",
              concentrationMcgPerMl: c.container.concentrationMcgPerMl,
            },
            syringe,
            remainingMl: c.poolMl,
          }).deliveredVolumeMl;
        } catch {
          continue; // this container cannot size the dose; try the next
        }
        if (deliveredMl.lte(0)) continue; // below measurable on this container
        evaluable = true;
        if (c.poolMl.gte(deliveredMl)) {
          c.poolMl = c.poolMl.minus(deliveredMl); // Decimal throughout (R16)
          served = true;
          break;
        }
        continue; // remainder stranded, try the next container
      }

      // Sealed vial: mass path. No concentration exists until reconstitution, so
      // an ml/units dose cannot be sized against it (D5) — and, unlike the prep
      // path above, the draw CANNOT go through `computeDraw`: syringe rounding is
      // a function of concentration, which this vial does not have yet. A sealed
      // vial is therefore costed at the nominal dose and is credited with the
      // rounding waste a real injection would strand (for 500 mcg @ 7500 mcg/mL,
      // 30 nominal doses against 28 real ones). Known optimistic bias, bounded by
      // the BUD gate below; revisit if sealed stock ever dominates a forecast.
      const needMcg = doseToMcg(slot.perInjectionValue, slot.perInjectionUnit);
      if (needMcg == null || needMcg.lte(0)) continue; // not sizable here
      if (!c.poolMcg) continue;
      evaluable = true;
      if (c.poolMcg.gte(needMcg)) {
        if (!c.opened) {
          // The BUD clock starts on the first REAL draw, not on the first
          // attempt: a vial too small for this dose must not burn shelf life it
          // never used. Take whichever of the stamped expiry and the BUD is
          // sooner. The open date is simulated because the true one is unknown.
          const bud = addDays(slot.date, input.budDaysForSealed);
          c.expiresOn = c.expiresOn && c.expiresOn < bud ? c.expiresOn : bud;
          c.opened = true;
        }
        c.poolMcg = c.poolMcg.minus(needMcg);
        served = true;
        break;
      }
    }

    if (!served) {
      // Nothing could even price the dose → data gap, not an empty shelf.
      if (!evaluable) return unknown(leadTimeDays);
      depleted = true;
      break;
    }
    lastServed = slot.date;
  }

  if (!depleted) {
    // Stock outlived the slot list. `covered` — never a null-shaped `ok`, so
    // `ok` keeps its existing invariant for every consumer (R2).
    //
    // The end is clamped to the LAST SLOT ACTUALLY WALKED. Reading it off the
    // protocol's endDate instead would let a course ending in 2029 report
    // "covers doses to 2029" on the strength of a 365-day simulation — a claim
    // the walk never tested, in the run-dry direction this whole design is
    // built to avoid. Negative days are clamped for the same reason: a
    // protocol whose end fell earlier this week still contributes a past
    // `pending` slot, and "-2 days" is not a coverage figure.
    const lastWalked = slots[slots.length - 1].date;
    const end = input.courseEndDate && input.courseEndDate < lastWalked ? input.courseEndDate : lastWalked;
    return {
      status: "covered",
      coverageDays: Math.max(0, daysBetween(today, end)),
      coverageBasis: input.stopReason,
      depletionDate: null,
      reorderByDate: null,
      courseEndDate: dayKey(end),
      leadTimeDays,
    };
  }

  // Depleted. With nothing ever served there is no stock at all, so coverage is
  // zero days from TODAY — not the date of the slot that went unfilled, which
  // would make an empty shelf indistinguishable from one dose in hand.
  const depletion = lastServed ?? today;
  const coverageDays = Math.max(0, daysBetween(today, depletion));
  // Dates are clamped to today too. A past `pending` slot can put the real
  // depletion behind us, and "reorder by 29 Jul" shown on 15 Aug is noise.
  const depletionDay = depletion < today ? today : depletion;
  const reorderBy = addDays(depletionDay, -leadTimeDays);
  return {
    status: coverageDays <= leadTimeDays + bufferDays ? "reorder_now" : "ok",
    coverageDays,
    coverageBasis: "depletion",
    depletionDate: dayKey(depletionDay),
    reorderByDate: dayKey(reorderBy < today ? today : reorderBy),
    courseEndDate: input.courseEndDate ? dayKey(input.courseEndDate) : null,
    leadTimeDays,
  };
}
