/**
 * Cost engine — pure. No I/O, no Prisma, decimal.js only. Everything the cost
 * screen shows is DERIVED here from invoices + dose logs; nothing is stored.
 *
 * The three problems this solves, in order:
 *
 *  1. **Shipping is a property of the ORDER, not of an item.** One $22 courier
 *     charge covering five vials is not $22 of any vial's cost. It is allocated
 *     across the invoice's lines — pro-rata on value by default, optionally
 *     equal per unit — so each vial carries its honest share. Allocation is
 *     exact: rounding residual is pushed onto the largest line so the shares sum
 *     to the overhead to the cent, never $0.01 short.
 *
 *  2. **A line can cover several vials.** The unit of cost is the LINE's landed
 *     cost divided by its quantity, so "3 × BPC-157 10mg @ $38 + $7.33 shipping
 *     share" gives every one of the three vials $40.44, whether or not all three
 *     vial rows have been created yet.
 *
 *  3. **What did a dose cost?** Not "invoice total / doses" — that is wrong the
 *     moment a vial is half-used or a titration changes the dose. Cost is
 *     attributed by delivered MASS: costPerMcg = landedUnitCost / labelMcg, and
 *     each DoseLog's cost is its own doseMcg × that rate. Unused mass in a
 *     finished/discarded vial is waste, and is reported as such rather than
 *     silently inflating the cost of the doses that were taken.
 *
 * Money is carried as decimal strings end-to-end and only rounded at the
 * currency scale where a real payment would round (allocation shares, and
 * presentation). Rates (cost per mcg) stay unrounded.
 */
import Decimal from "decimal.js";

/** How invoice-level overhead is spread across the invoice's lines. */
export type AllocationMethod = "value" | "quantity" | "none";

export const ALLOCATION_METHODS: readonly AllocationMethod[] = ["value", "quantity", "none"];

/** Consumable taxonomy. `null` category on a consumable line falls back to "other". */
export const CONSUMABLE_CATEGORIES = [
  "needle",
  "syringe",
  "swab",
  "sharps_container",
  "pen_tip",
  "bac_water",
  "other",
] as const;
export type ConsumableCategory = (typeof CONSUMABLE_CATEGORIES)[number];

export const CONSUMABLE_CATEGORY_LABELS: Record<ConsumableCategory, string> = {
  needle: "Needles",
  syringe: "Syringes",
  swab: "Alcohol swabs",
  sharps_container: "Sharps / disposal",
  pen_tip: "Pen tips",
  bac_water: "Bacteriostatic water",
  other: "Other sundries",
};

const ZERO = new Decimal(0);

/** Currency scale — the number of decimal places a payment settles at. */
const MONEY_DP = 2;

function d(v: string | number | null | undefined, fallback: Decimal = ZERO): Decimal {
  if (v == null || v === "") return fallback;
  try {
    const x = new Decimal(v);
    return x.isFinite() ? x : fallback;
  } catch {
    return fallback;
  }
}

/** Round to the currency scale, half-up (what an invoice does). */
function money(x: Decimal): Decimal {
  return x.toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);
}

// ── Allocation ──────────────────────────────────────────────────────────────

export interface CostLineInput {
  id: string;
  kind: "peptide" | "consumable";
  /** Units bought on this line: vials, or packs of a consumable. */
  quantity: number;
  /** Price of ONE unit, before any invoice-level overhead. */
  unitCost: string;
}

export interface AllocationInput {
  lines: CostLineInput[];
  shippingCost?: string | null;
  taxCost?: string | null;
  otherFees?: string | null;
  /** Subtracted from the allocatable overhead; may push it negative. */
  discount?: string | null;
  method: AllocationMethod;
}

export interface AllocatedLine {
  id: string;
  /** quantity × unitCost */
  subtotal: string;
  /** this line's share of the invoice overhead */
  allocated: string;
  /** subtotal + allocated */
  landed: string;
  /** landed ÷ quantity — the cost of ONE vial / ONE pack. Null when quantity ≤ 0. */
  landedUnit: string | null;
}

export interface AllocationResult {
  lines: AllocatedLine[];
  /** Sum of every line subtotal. */
  subtotal: string;
  /** shipping + tax + fees − discount. */
  overhead: string;
  /** subtotal + overhead — what the invoice actually cost, always. */
  total: string;
  /** Overhead that reached no line (method "none", or no basis to spread on). */
  unallocated: string;
  /**
   * The method actually applied. "quantity-fallback" means value-allocation was
   * asked for but every line was $0, so units were used instead — reported so
   * the UI can say why, rather than silently changing the answer.
   */
  effectiveMethod: AllocationMethod | "quantity-fallback";
}

/**
 * Spread an invoice's shipping/tax/fees (less discount) across its lines.
 *
 * Exactness matters more than it looks: with three lines and $10 shipping,
 * naive per-line rounding yields 3 × $3.33 = $9.99 and the invoice no longer
 * reconciles. The residual is added to the line with the largest basis (ties →
 * first), so Σ allocated == overhead exactly, at the currency scale.
 */
export function allocateOverhead(input: AllocationInput): AllocationResult {
  const { lines, method } = input;

  const overhead = d(input.shippingCost)
    .plus(d(input.taxCost))
    .plus(d(input.otherFees))
    .minus(d(input.discount));

  const subtotals = lines.map((l) => d(l.unitCost).times(new Decimal(l.quantity ?? 0)));
  const subtotal = subtotals.reduce((a, b) => a.plus(b), ZERO);

  const zeroed = (effectiveMethod: AllocationResult["effectiveMethod"]): AllocationResult => ({
    lines: lines.map((l, i) => {
      const st = subtotals[i];
      const qty = new Decimal(l.quantity ?? 0);
      return {
        id: l.id,
        subtotal: money(st).toFixed(MONEY_DP),
        allocated: "0.00",
        landed: money(st).toFixed(MONEY_DP),
        landedUnit: qty.gt(0) ? st.div(qty).toString() : null,
      };
    }),
    subtotal: money(subtotal).toFixed(MONEY_DP),
    overhead: money(overhead).toFixed(MONEY_DP),
    total: money(subtotal.plus(overhead)).toFixed(MONEY_DP),
    unallocated: money(overhead).toFixed(MONEY_DP),
    effectiveMethod,
  });

  if (method === "none" || lines.length === 0 || overhead.isZero()) {
    const r = zeroed(method);
    // A zero overhead is fully allocated by definition — nothing is left over.
    return overhead.isZero() && method !== "none" ? { ...r, unallocated: "0.00" } : r;
  }

  // Choose the basis. Value allocation needs a non-zero subtotal; if every line
  // is free (a sampler order that only cost shipping), fall back to unit count
  // so the shipping still lands somewhere honest.
  let effectiveMethod: AllocationResult["effectiveMethod"] = method;
  let bases: Decimal[];
  if (method === "value" && subtotal.gt(0)) {
    bases = subtotals;
  } else {
    if (method === "value") effectiveMethod = "quantity-fallback";
    bases = lines.map((l) => new Decimal(Math.max(0, l.quantity ?? 0)));
  }
  const basisTotal = bases.reduce((a, b) => a.plus(b), ZERO);

  // No basis at all (no units, no value) — nothing can be allocated honestly.
  if (basisTotal.lte(0)) return zeroed(effectiveMethod);

  const allocated = bases.map((b) => money(overhead.times(b).div(basisTotal)));

  // Push the rounding residual onto the largest-basis line so Σ == overhead.
  const residual = money(overhead).minus(allocated.reduce((a, b) => a.plus(b), ZERO));
  if (!residual.isZero()) {
    let biggest = 0;
    for (let i = 1; i < bases.length; i++) if (bases[i].gt(bases[biggest])) biggest = i;
    allocated[biggest] = allocated[biggest].plus(residual);
  }

  return {
    lines: lines.map((l, i) => {
      const landed = subtotals[i].plus(allocated[i]);
      const qty = new Decimal(l.quantity ?? 0);
      return {
        id: l.id,
        subtotal: money(subtotals[i]).toFixed(MONEY_DP),
        allocated: allocated[i].toFixed(MONEY_DP),
        landed: money(landed).toFixed(MONEY_DP),
        landedUnit: qty.gt(0) ? landed.div(qty).toString() : null,
      };
    }),
    subtotal: money(subtotal).toFixed(MONEY_DP),
    overhead: money(overhead).toFixed(MONEY_DP),
    total: money(subtotal.plus(overhead)).toFixed(MONEY_DP),
    unallocated: "0.00",
    effectiveMethod,
  };
}

// ── Per-vial cost ───────────────────────────────────────────────────────────

/** Where a vial's cost came from. Invoice is authoritative; prescription is an estimate. */
export type CostSource = "invoice" | "prescription";

export interface VialCostInput {
  vialId: string;
  peptideId: string;
  peptideName: string;
  labelStrengthMg: string;
  status: string; // sealed | in_use | finished | discarded
  /** Landed cost of ONE vial. Null = uncosted. */
  landedUnitCost: string | null;
  /** How that figure was obtained. Null when uncosted. */
  costSource?: CostSource | null;
}

/**
 * Pick a vial's unit cost: the INVOICE always wins, and the prescription's
 * recorded cost only fills a gap.
 *
 * That ordering is what makes the fallback safe. A prescription's recorded cost
 * and an invoice line are frequently the same money entered twice — the script
 * is filed when it is written, the invoice when the order arrives — so adding
 * them would double-count. Taking the prescription only when no invoice line is
 * matched makes double counting impossible by construction rather than by
 * discipline.
 *
 * `Prescription.cost` is read as the cost of ONE vial, not the script total. A
 * script covering a two-cartridge order records the per-cartridge price, so
 * dividing by `quantity` would halve it. The result is tagged `prescription` so
 * callers can present it as the estimate it is rather than as a settled price.
 */
export function resolveVialUnitCost(args: {
  invoiceLandedUnit: string | null | undefined;
  prescriptionCost: string | null | undefined;
}): { value: string | null; source: CostSource | null } {
  const inv = args.invoiceLandedUnit;
  if (inv != null && inv !== "") {
    const d0 = d(inv, new Decimal(NaN));
    if (d0.isFinite()) return { value: d0.toString(), source: "invoice" };
  }
  const rx = args.prescriptionCost;
  if (rx != null && rx !== "") {
    const d1 = d(rx, new Decimal(NaN));
    if (d1.isFinite() && d1.gt(0)) return { value: d1.toString(), source: "prescription" };
  }
  return { value: null, source: null };
}

export interface VialCost {
  vialId: string;
  peptideId: string;
  peptideName: string;
  status: string;
  landedCost: string | null;
  /** Cost of one microgram of this vial's contents. Null when uncosted. */
  costPerMcg: string | null;
  /** Presentational: cost per mg. Null when uncosted. */
  costPerMg: string | null;
  labelMcg: string;
  /** Invoice (authoritative) or prescription (estimate). Null when uncosted. */
  costSource: CostSource | null;
}

/**
 * Cost rate for a vial. costPerMcg is the rate every dose from this vial is
 * charged at, so a 10mg vial at $40.44 charges a 250mcg dose $1.011 — the same
 * whether it is the first dose or the last.
 */
export function vialCost(v: VialCostInput): VialCost {
  const labelMcg = d(v.labelStrengthMg).times(1000);
  const landed = v.landedUnitCost == null ? null : d(v.landedUnitCost);
  const costPerMcg = landed && labelMcg.gt(0) ? landed.div(labelMcg) : null;
  return {
    vialId: v.vialId,
    peptideId: v.peptideId,
    peptideName: v.peptideName,
    status: v.status,
    landedCost: landed ? landed.toString() : null,
    costPerMcg: costPerMcg ? costPerMcg.toString() : null,
    costPerMg: costPerMcg ? costPerMcg.times(1000).toString() : null,
    labelMcg: labelMcg.toString(),
    costSource: landed == null ? null : v.costSource ?? "invoice",
  };
}

// ── Dose-level attribution ──────────────────────────────────────────────────

export interface DoseCostInput {
  doseLogId: string;
  peptideId: string;
  /** The vial the dose came from (via its preparation). Null for oral/unlinked. */
  vialId: string | null;
  /** Tracking day, "YYYY-MM-DD". */
  dayKey: string;
  doseMcg: string;
}

export interface DoseCost extends DoseCostInput {
  /** doseMcg × the vial's costPerMcg. Null when the vial is uncosted/unknown. */
  cost: string | null;
}

/** Charge every dose at its own vial's rate, by delivered mass. */
export function attributeDoseCosts(doses: DoseCostInput[], vials: VialCost[]): DoseCost[] {
  const rate = new Map(vials.map((v) => [v.vialId, v.costPerMcg]));
  return doses.map((dose) => {
    const r = dose.vialId ? rate.get(dose.vialId) ?? null : null;
    return { ...dose, cost: r ? d(dose.doseMcg).times(d(r)).toString() : null };
  });
}

export interface VialWaste {
  vialId: string;
  peptideName: string;
  status: string;
  unusedMcg: string;
  wasteCost: string;
  /** 0–100. Share of the vial's mass that was never delivered. */
  wastePct: number;
}

/**
 * A vial that delivered more than this share of its mass is not counted as waste
 * at all, however much is left in it.
 *
 * Every vial leaves something behind — dead volume in the hub, a last draw that
 * will not fill a syringe, the gap between label and actual fill. Reporting that
 * as "waste" buries the losses that matter (a vial ruined learning to
 * reconstitute, one abandoned before a trip) under a tail of unavoidable
 * residue. The rule: if more than 70% of the product was used, it was not
 * wasted.
 *
 * The threshold gates the WHOLE vial, not the shortfall — a vial that delivered
 * 60% contributes all 40% of its unused mass, not the 10% below the line. It
 * answers "was this vial abandoned?", not "how much is deductible?".
 */
export const WASTE_UTILISATION_THRESHOLD_PCT = 70;

/**
 * Value of mass never delivered from vials that are done (finished/discarded),
 * counting only vials that ended more than WASTE_THRESHOLD_PCT unused.
 * In-use and sealed vials are excluded: their unused mass is inventory, not
 * waste. Overdraw (delivered > label, from reconstitution slop) clamps at zero
 * rather than reporting negative waste.
 */
export function vialWaste(args: {
  vials: VialCost[];
  doses: DoseCost[];
}): { total: string; byVial: VialWaste[] } {
  const deliveredByVial = new Map<string, Decimal>();
  for (const dose of args.doses) {
    if (!dose.vialId) continue;
    deliveredByVial.set(dose.vialId, (deliveredByVial.get(dose.vialId) ?? ZERO).plus(d(dose.doseMcg)));
  }

  const byVial: VialWaste[] = [];
  let total = ZERO;
  for (const v of args.vials) {
    if (v.status !== "finished" && v.status !== "discarded") continue;
    if (v.costPerMcg == null) continue;
    const label = d(v.labelMcg);
    if (label.lte(0)) continue;
    const delivered = deliveredByVial.get(v.vialId) ?? ZERO;
    const unused = Decimal.max(ZERO, label.minus(delivered));
    if (unused.lte(0)) continue;
    // A well-used vial is not waste, whatever is left in it — see
    // WASTE_UTILISATION_THRESHOLD_PCT.
    const pct = unused.div(label).times(100);
    const usedPct = delivered.div(label).times(100);
    if (usedPct.gt(WASTE_UTILISATION_THRESHOLD_PCT)) continue;
    const cost = unused.times(d(v.costPerMcg));
    total = total.plus(cost);
    byVial.push({
      vialId: v.vialId,
      peptideName: v.peptideName,
      status: v.status,
      unusedMcg: unused.toString(),
      wasteCost: money(cost).toFixed(MONEY_DP),
      wastePct: pct.toDecimalPlaces(1).toNumber(),
    });
  }
  byVial.sort((a, b) => Number(b.wasteCost) - Number(a.wasteCost));
  return { total: money(total).toFixed(MONEY_DP), byVial };
}

// ── Consumables ─────────────────────────────────────────────────────────────

export interface ConsumableLineInput {
  category: string | null;
  description: string;
  /** Packs bought. */
  quantity: number;
  /** Pieces in one pack (100 needles per box). Null → 1 piece per pack. */
  unitsPerPack: number | null;
  /** Pieces consumed per injection. Null → this line is amortised only. */
  unitsPerDose: string | null;
  /** Landed cost of the whole line (subtotal + its shipping share). */
  landed: string;
}

export interface ConsumableCategoryTotal {
  category: ConsumableCategory;
  label: string;
  spend: string;
  pieces: number;
  /** landed ÷ pieces. Null when the piece count is unknown/zero. */
  costPerPiece: string | null;
}

export interface ConsumableSummary {
  totalSpend: string;
  byCategory: ConsumableCategoryTotal[];
  /**
   * Cost of the consumables ONE injection consumes, from lines that declare a
   * unitsPerDose. Null when no line declares one — an unmodelled stack gets the
   * amortised figure instead of a made-up one.
   */
  modelledPerDose: string | null;
  /** Consumable spend in the window ÷ doses in the window. Null when no doses. */
  amortisedPerDose: string | null;
}

function normaliseCategory(c: string | null): ConsumableCategory {
  return (CONSUMABLE_CATEGORIES as readonly string[]).includes(c ?? "")
    ? (c as ConsumableCategory)
    : "other";
}

export function summariseConsumables(args: {
  lines: ConsumableLineInput[];
  /** Doses logged in the same window the lines were bought in. */
  doseCount: number;
}): ConsumableSummary {
  const byCat = new Map<ConsumableCategory, { spend: Decimal; pieces: Decimal }>();
  let totalSpend = ZERO;
  let modelled = ZERO;
  let anyModelled = false;

  for (const l of args.lines) {
    const landed = d(l.landed);
    const packs = new Decimal(Math.max(0, l.quantity ?? 0));
    const perPack = new Decimal(l.unitsPerPack != null && l.unitsPerPack > 0 ? l.unitsPerPack : 1);
    const pieces = packs.times(perPack);

    totalSpend = totalSpend.plus(landed);
    const cat = normaliseCategory(l.category);
    const cur = byCat.get(cat) ?? { spend: ZERO, pieces: ZERO };
    byCat.set(cat, { spend: cur.spend.plus(landed), pieces: cur.pieces.plus(pieces) });

    if (l.unitsPerDose != null && pieces.gt(0)) {
      const perDoseUnits = d(l.unitsPerDose);
      if (perDoseUnits.gt(0)) {
        anyModelled = true;
        modelled = modelled.plus(landed.div(pieces).times(perDoseUnits));
      }
    }
  }

  const byCategory: ConsumableCategoryTotal[] = [...byCat.entries()]
    .map(([category, v]) => ({
      category,
      label: CONSUMABLE_CATEGORY_LABELS[category],
      spend: money(v.spend).toFixed(MONEY_DP),
      pieces: v.pieces.toNumber(),
      costPerPiece: v.pieces.gt(0) ? v.spend.div(v.pieces).toString() : null,
    }))
    .sort((a, b) => Number(b.spend) - Number(a.spend));

  return {
    totalSpend: money(totalSpend).toFixed(MONEY_DP),
    byCategory,
    modelledPerDose: anyModelled ? modelled.toString() : null,
    amortisedPerDose: args.doseCount > 0 ? totalSpend.div(args.doseCount).toString() : null,
  };
}

// ── Roll-ups ────────────────────────────────────────────────────────────────

export interface PeptideCostRow {
  peptideId: string;
  peptideName: string;
  /** Landed spend on this peptide's lines in the window. */
  spend: string;
  /** Mass delivered in the window, mg. */
  deliveredMg: string;
  /** Cost of the doses delivered in the window (usage-attributed, not spend). */
  deliveredCost: string;
  doseCount: number;
  /** deliveredCost ÷ doseCount. Null with no costed doses. */
  costPerDose: string | null;
  /** deliveredCost ÷ deliveredMg. Null with no costed doses. */
  costPerMg: string | null;
  /** Doses in the window whose vial had no cost data. */
  uncostedDoses: number;
}

export function rollUpByPeptide(args: {
  doses: DoseCost[];
  /** Landed spend per peptide from the invoice lines in the window. */
  spendByPeptide: Map<string, string>;
  names: Map<string, string>;
}): PeptideCostRow[] {
  const acc = new Map<
    string,
    { mcg: Decimal; cost: Decimal; costed: number; uncosted: number }
  >();
  const touch = (id: string) => {
    let a = acc.get(id);
    if (!a) acc.set(id, (a = { mcg: ZERO, cost: ZERO, costed: 0, uncosted: 0 }));
    return a;
  };

  for (const dose of args.doses) {
    const a = touch(dose.peptideId);
    if (dose.cost == null) {
      a.uncosted++;
      continue;
    }
    a.mcg = a.mcg.plus(d(dose.doseMcg));
    a.cost = a.cost.plus(d(dose.cost));
    a.costed++;
  }
  for (const id of args.spendByPeptide.keys()) touch(id);

  const rows: PeptideCostRow[] = [...acc.entries()].map(([peptideId, a]) => {
    const mg = a.mcg.div(1000);
    return {
      peptideId,
      peptideName: args.names.get(peptideId) ?? "Unknown",
      spend: money(d(args.spendByPeptide.get(peptideId))).toFixed(MONEY_DP),
      deliveredMg: mg.toDecimalPlaces(3).toString(),
      deliveredCost: money(a.cost).toFixed(MONEY_DP),
      doseCount: a.costed,
      costPerDose: a.costed > 0 ? a.cost.div(a.costed).toString() : null,
      costPerMg: mg.gt(0) ? a.cost.div(mg).toString() : null,
      uncostedDoses: a.uncosted,
    };
  });

  rows.sort((x, y) => Number(y.spend) - Number(x.spend) || x.peptideName.localeCompare(y.peptideName));
  return rows;
}

export interface MonthSpend {
  monthKey: string; // YYYY-MM
  peptide: string;
  consumable: string;
  overhead: string;
  total: string;
}

export interface MonthSpendInput {
  monthKey: string;
  peptideSubtotal: string;
  consumableSubtotal: string;
  overhead: string;
}

/** Monthly spend, ascending by month, with zero-months omitted (no data ≠ $0). */
export function spendByMonth(rows: MonthSpendInput[]): MonthSpend[] {
  const acc = new Map<string, { p: Decimal; c: Decimal; o: Decimal }>();
  for (const r of rows) {
    const cur = acc.get(r.monthKey) ?? { p: ZERO, c: ZERO, o: ZERO };
    acc.set(r.monthKey, {
      p: cur.p.plus(d(r.peptideSubtotal)),
      c: cur.c.plus(d(r.consumableSubtotal)),
      o: cur.o.plus(d(r.overhead)),
    });
  }
  return [...acc.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([monthKey, v]) => ({
      monthKey,
      peptide: money(v.p).toFixed(MONEY_DP),
      consumable: money(v.c).toFixed(MONEY_DP),
      overhead: money(v.o).toFixed(MONEY_DP),
      total: money(v.p.plus(v.c).plus(v.o)).toFixed(MONEY_DP),
    }));
}

/**
 * Headline cost of one injection: the peptide charged at delivered mass, plus
 * the consumables it burns. Prefers the modelled consumable cost (derived from
 * declared units-per-dose) and falls back to amortising the window's consumable
 * spend over the window's doses. Returns nulls rather than zeros when a
 * component is unknown, so "no data" never renders as "free".
 */
export function costPerDose(args: {
  peptideCost: string;
  doseCount: number;
  consumables: ConsumableSummary;
}): {
  peptide: string | null;
  consumable: string | null;
  consumableBasis: "modelled" | "amortised" | null;
  total: string | null;
} {
  const peptide = args.doseCount > 0 ? d(args.peptideCost).div(args.doseCount) : null;
  const modelled = args.consumables.modelledPerDose;
  const amortised = args.consumables.amortisedPerDose;
  const consumable = modelled ?? amortised;
  const basis = modelled != null ? "modelled" : amortised != null ? "amortised" : null;
  const total =
    peptide != null || consumable != null
      ? (peptide ?? ZERO).plus(d(consumable)).toString()
      : null;
  return {
    peptide: peptide ? peptide.toString() : null,
    consumable: consumable ?? null,
    consumableBasis: basis,
    total,
  };
}

/**
 * How many months of USE a run-rate should be divided by.
 *
 * Not the window length: a 12-month window holding one week of dosing must not
 * report a monthly run rate 52× too low. The divisor is the span from the first
 * dose to the last (or to today, whichever is later — a stack stopped a month
 * ago still spent nothing since), capped at the window and floored at one month
 * so a single week reports "about a month's worth", never a fraction that
 * inflates the rate instead.
 */
export function usageMonths(args: {
  firstDayKey: string | null;
  todayKey: string;
  windowMonths: number | null;
}): number {
  const { firstDayKey, todayKey, windowMonths } = args;
  if (!firstDayKey) return windowMonths ?? 1;
  const first = Date.parse(`${firstDayKey}T00:00:00Z`);
  const today = Date.parse(`${todayKey}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(today) || today < first) return 1;
  const spanMonths = (today - first) / (86_400_000 * 30.436875);
  const capped = windowMonths == null ? spanMonths : Math.min(spanMonths, windowMonths);
  return Math.max(1, Math.round(capped));
}

/** Format a decimal string as currency for display. Never throws. */
export function fmtMoney(v: string | number | null | undefined, currency = "AUD"): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${currency} ${n.toFixed(2)}`;
}

/** Format small per-unit rates, which round to $0.00 at 2dp. */
export function fmtRate(v: string | number | null | undefined, currency = "AUD"): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const dp = Math.abs(n) > 0 && Math.abs(n) < 1 ? 3 : 2;
  return `${currency} ${n.toFixed(dp)}`;
}
