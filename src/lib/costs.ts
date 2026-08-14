/**
 * Cost analytics — the server half. Reads invoices, vials and dose logs, then
 * hands everything to the pure engine in `costs-core` to derive landed costs,
 * cost per dose, consumable burn and waste. Nothing derived is persisted.
 *
 * Two different windows are in play and they are deliberately not the same:
 *   • SPEND is windowed on `Purchase.orderedAt` — when money left the account.
 *   • USAGE (cost per dose, cost per mg, waste) is windowed on the dose's
 *     tracking day — when the peptide was actually delivered.
 * A $400 order in July that is dosed through September should show as July
 * spend and September usage; averaging one into the other is what makes naive
 * "spend ÷ doses" cost-per-dose numbers wrong.
 *
 * Coverage is reported, never assumed: a vial with no purchase line is UNCOSTED,
 * and its doses are counted separately rather than averaged in at $0.
 */
import "server-only";
import { prisma } from "@/lib/db";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import { dayKey } from "@/lib/today-overrides";
import {
  allocateOverhead,
  attributeDoseCosts,
  costPerDose,
  resolveVialUnitCost,
  rollUpByPeptide,
  spendByMonth,
  summariseConsumables,
  usageMonths,
  vialCost,
  vialWaste,
  type AllocationMethod,
  type AllocationResult,
  type ConsumableLineInput,
  type ConsumableSummary,
  type DoseCostInput,
  type MonthSpend,
  type PeptideCostRow,
  type VialCost,
  type VialWaste,
} from "@/lib/costs-core";

export interface PurchaseItemView {
  id: string;
  kind: "peptide" | "consumable";
  peptideId: string | null;
  peptideName: string | null;
  category: string | null;
  description: string;
  quantity: number;
  unitCost: string;
  unitsPerPack: number | null;
  unitsPerDose: string | null;
  /** Vials this line bought (may be fewer than `quantity`). */
  vialIds: string[];
  subtotal: string;
  allocated: string;
  landed: string;
  landedUnit: string | null;
}

export interface PurchaseView {
  id: string;
  vendor: string | null;
  reference: string | null;
  orderedAt: string; // yyyy-mm-dd
  receivedAt: string | null;
  currency: string;
  shippingCost: string;
  taxCost: string;
  otherFees: string;
  discount: string;
  allocationMethod: AllocationMethod;
  notes: string | null;
  items: PurchaseItemView[];
  totals: AllocationResult;
  /** Vials expected from peptide lines vs vial rows actually linked. */
  vialsExpected: number;
  vialsLinked: number;
}

export interface CostAnalytics {
  currency: string;
  /** True when the window mixes currencies — totals are then not meaningful. */
  mixedCurrency: boolean;
  window: { fromKey: string; toKey: string; label: string };
  /**
   * peptideSpend and consumableSpend are LANDED — each already carries its share
   * of the invoice overhead. shipping/tax/fees/discount are memo lines showing
   * what that overhead was made of, NOT extra spend to add on top. The identity
   * that always holds is:
   *     peptideSpend + consumableSpend + unallocatedOverhead == grandTotal
   */
  totals: {
    peptideSpend: string;
    consumableSpend: string;
    shipping: string;
    tax: string;
    fees: string;
    discount: string;
    unallocatedOverhead: string;
    /** Vials priced from a prescription because no invoice line covers them. */
    prescriptionEstimated: string;
    /** Invoice totals only. */
    grandTotal: string;
    /** grandTotal + prescriptionEstimated — everything the ledger can account for. */
    accountedTotal: string;
    purchaseCount: number;
  };
  spendByMonth: MonthSpend[];
  byPeptide: PeptideCostRow[];
  consumables: ConsumableSummary;
  perDose: ReturnType<typeof costPerDose>;
  waste: { total: string; byVial: VialWaste[] };
  coverage: {
    vialsTotal: number;
    vialsCosted: number;
    /** Of vialsCosted, how many came from an invoice vs a prescription estimate. */
    vialsFromInvoice: number;
    vialsFromPrescription: number;
    dosesInWindow: number;
    dosesCosted: number;
    /** Invoices whose overhead reached no line (allocation "none" or no basis). */
    purchasesWithUnallocatedOverhead: number;
  };
  /** Monthly run-rate over the window, from usage-attributed dose cost. */
  runRate: { perMonth: string | null; monthsOfData: number };
}

const MS_PER_DAY = 86_400_000;

function toDateInput(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString().slice(0, 10) : null;
}

/** UTC-midnight day key for a date-only field (MIGRATIONS.md rule 3). */
function dateOnlyKey(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

function asMethod(v: string): AllocationMethod {
  return v === "quantity" || v === "none" ? v : "value";
}

function toItemInputs(items: { id: string; kind: string; quantity: number; unitCost: unknown }[]) {
  return items.map((i) => ({
    id: i.id,
    kind: (i.kind === "consumable" ? "consumable" : "peptide") as "peptide" | "consumable",
    quantity: i.quantity,
    unitCost: i.unitCost?.toString() ?? "0",
  }));
}

/**
 * Every invoice with its lines, allocated. Ordered newest first. This is both
 * the ledger view and the source the analytics roll-up reads.
 */
export async function getPurchases(userId: string): Promise<PurchaseView[]> {
  const rows = await prisma.purchase.findMany({
    where: { userId },
    include: {
      items: {
        orderBy: [{ sortIndex: "asc" }],
        include: { peptide: { select: { id: true, name: true } }, vials: { select: { id: true } } },
      },
    },
    orderBy: [{ orderedAt: "desc" }, { createdAt: "desc" }],
  });

  return rows.map((p) => {
    const totals = allocateOverhead({
      lines: toItemInputs(p.items),
      shippingCost: p.shippingCost.toString(),
      taxCost: p.taxCost.toString(),
      otherFees: p.otherFees.toString(),
      discount: p.discount.toString(),
      method: asMethod(p.allocationMethod),
    });
    const byId = new Map(totals.lines.map((l) => [l.id, l]));

    const items: PurchaseItemView[] = p.items.map((i) => {
      const a = byId.get(i.id);
      return {
        id: i.id,
        kind: i.kind === "consumable" ? "consumable" : "peptide",
        peptideId: i.peptideId,
        peptideName: i.peptide?.name ?? null,
        category: i.category,
        description: i.description,
        quantity: i.quantity,
        unitCost: i.unitCost.toString(),
        unitsPerPack: i.unitsPerPack,
        unitsPerDose: i.unitsPerDose?.toString() ?? null,
        vialIds: i.vials.map((v) => v.id),
        subtotal: a?.subtotal ?? "0.00",
        allocated: a?.allocated ?? "0.00",
        landed: a?.landed ?? "0.00",
        landedUnit: a?.landedUnit ?? null,
      };
    });

    const peptideLines = items.filter((i) => i.kind === "peptide");
    return {
      id: p.id,
      vendor: p.vendor,
      reference: decryptField(p.reference),
      orderedAt: dateOnlyKey(p.orderedAt),
      receivedAt: toDateInput(p.receivedAt),
      currency: p.currency,
      shippingCost: p.shippingCost.toString(),
      taxCost: p.taxCost.toString(),
      otherFees: p.otherFees.toString(),
      discount: p.discount.toString(),
      allocationMethod: asMethod(p.allocationMethod),
      notes: decryptField(p.notes),
      items,
      totals,
      vialsExpected: peptideLines.reduce((n, i) => n + Math.max(0, i.quantity), 0),
      vialsLinked: peptideLines.reduce((n, i) => n + i.vialIds.length, 0),
    };
  });
}

export interface CostWindow {
  /** Whole months back from today; null = all time. */
  months: number | null;
}

export const DEFAULT_COST_WINDOW: CostWindow = { months: 12 };

/**
 * The cost dashboard. `now` is injectable so tests and the UAT harness can pin
 * the window instead of racing the clock.
 */
export async function getCostAnalytics(
  userId: string,
  window: CostWindow = DEFAULT_COST_WINDOW,
  now: Date = new Date(),
): Promise<CostAnalytics> {
  const from = window.months == null ? new Date(0) : monthsAgo(now, window.months);
  const fromKey = dayKey(from);
  const toKey = dayKey(now);
  const label = window.months == null ? "All time" : `Last ${window.months} months`;

  const purchases = await getPurchases(userId);
  const inWindow = purchases.filter((p) => p.orderedAt >= fromKey && p.orderedAt <= toKey);

  // ── Spend side ────────────────────────────────────────────────────────────
  const currencies = new Set(inWindow.map((p) => p.currency));
  const currency = inWindow[0]?.currency ?? "AUD";

  let peptideSpend = 0;
  let consumableSpend = 0;
  let shipping = 0;
  let tax = 0;
  let fees = 0;
  let discount = 0;
  let unallocatedOverhead = 0;
  let unallocatedCount = 0;
  const spendByPeptide = new Map<string, number>();
  const consumableLines: ConsumableLineInput[] = [];
  const monthRows: { monthKey: string; peptideSubtotal: string; consumableSubtotal: string; overhead: string }[] = [];

  for (const p of inWindow) {
    shipping += Number(p.shippingCost);
    tax += Number(p.taxCost);
    fees += Number(p.otherFees);
    discount += Number(p.discount);
    unallocatedOverhead += Number(p.totals.unallocated);
    if (Number(p.totals.unallocated) !== 0) unallocatedCount++;

    let mPep = 0;
    let mCon = 0;
    for (const i of p.items) {
      if (i.kind === "peptide") {
        peptideSpend += Number(i.landed);
        mPep += Number(i.subtotal);
        if (i.peptideId) spendByPeptide.set(i.peptideId, (spendByPeptide.get(i.peptideId) ?? 0) + Number(i.landed));
      } else {
        consumableSpend += Number(i.landed);
        mCon += Number(i.subtotal);
        consumableLines.push({
          category: i.category,
          description: i.description,
          quantity: i.quantity,
          unitsPerPack: i.unitsPerPack,
          unitsPerDose: i.unitsPerDose,
          landed: i.landed,
        });
      }
    }
    // Monthly bars split the invoice into its three pre-allocation parts, so
    // peptide + consumable + overhead == the invoice total exactly. These are
    // SUBTOTALS (not landed) precisely so the overhead can be shown as its own
    // band without being counted twice.
    monthRows.push({
      monthKey: p.orderedAt.slice(0, 7),
      peptideSubtotal: mPep.toFixed(2),
      consumableSubtotal: mCon.toFixed(2),
      overhead: Number(p.totals.overhead).toFixed(2),
    });
  }

  // ── Vial cost rates ───────────────────────────────────────────────────────
  const vials = await prisma.vial.findMany({
    where: { userId },
    select: {
      id: true,
      peptideId: true,
      labelStrengthMg: true,
      status: true,
      purchaseItemId: true,
      peptide: { select: { name: true } },
      prescription: { select: { cost: true, dateWritten: true } },
    },
  });
  // Landed UNIT cost per line, across ALL invoices (not just the window): a vial
  // bought last year and dosed this month must still cost what it cost.
  const landedUnitByItem = new Map<string, string | null>();
  for (const p of purchases) for (const i of p.items) landedUnitByItem.set(i.id, i.landedUnit);

  // Invoice first, prescription only as a gap-filler — see resolveVialUnitCost
  // for why that ordering is what prevents the same money being counted twice.
  const vialCosts: VialCost[] = vials.map((v) => {
    const resolved = resolveVialUnitCost({
      invoiceLandedUnit: v.purchaseItemId ? landedUnitByItem.get(v.purchaseItemId) ?? null : null,
      prescriptionCost: v.prescription?.cost?.toString() ?? null,
    });
    return vialCost({
      vialId: v.id,
      peptideId: v.peptideId,
      peptideName: v.peptide.name,
      labelStrengthMg: v.labelStrengthMg.toString(),
      status: v.status,
      landedUnitCost: resolved.value,
      costSource: resolved.source,
    });
  });

  // Vials priced from a prescription are real spend that no invoice covers, so
  // they are added to the totals — but kept as their own line, never merged into
  // the invoiced figure, because they are an estimate and carry no shipping.
  //
  // Windowed on the script's dateWritten so it lines up with invoice spend,
  // which is windowed on the order date. A script with no dateWritten is
  // included rather than dropped — omitting real money because a date field is
  // blank would understate spend, which is the failure mode this whole screen
  // exists to avoid.
  const rxDateByVial = new Map(
    vials.map((v) => [v.id, v.prescription?.dateWritten ? dayKey(v.prescription.dateWritten) : null]),
  );
  const inSpendWindow = (vialId: string) => {
    const k = rxDateByVial.get(vialId) ?? null;
    return k == null || (k >= fromKey && k <= toKey);
  };
  let prescriptionEstimated = 0;
  for (const v of vialCosts) {
    if (v.costSource !== "prescription" || !inSpendWindow(v.vialId)) continue;
    prescriptionEstimated += Number(v.landedCost ?? 0);
    spendByPeptide.set(v.peptideId, (spendByPeptide.get(v.peptideId) ?? 0) + Number(v.landedCost ?? 0));
  }

  // ── Usage side ────────────────────────────────────────────────────────────
  const logs = await prisma.doseLog.findMany({
    where: { userId, takenAt: { gte: addDays(from, -2) } },
    select: {
      id: true,
      takenAt: true,
      localDay: true,
      doseMcg: true,
      protocolId: true,
      preparation: { select: { vialId: true, vial: { select: { peptideId: true } } } },
      protocol: { select: { peptideId: true } },
    },
  });

  const doseInputs: DoseCostInput[] = [];
  for (const l of logs) {
    const key = l.localDay ?? dayKey(l.takenAt);
    if (key < fromKey || key > toKey) continue;
    const peptideId = l.preparation?.vial?.peptideId ?? l.protocol?.peptideId ?? "";
    if (!peptideId) continue;
    doseInputs.push({
      doseLogId: l.id,
      peptideId,
      vialId: l.preparation?.vialId ?? null,
      dayKey: key,
      doseMcg: l.doseMcg.toString(),
    });
  }

  const doses = attributeDoseCosts(doseInputs, vialCosts);
  const dosesCosted = doses.filter((d) => d.cost != null).length;
  const deliveredCost = doses.reduce((t, d) => t + Number(d.cost ?? 0), 0);

  const peptideNames = new Map(vials.map((v) => [v.peptideId, v.peptide.name]));
  for (const p of purchases)
    for (const i of p.items) if (i.peptideId && i.peptideName) peptideNames.set(i.peptideId, i.peptideName);

  const consumables = summariseConsumables({ lines: consumableLines, doseCount: doses.length });

  // Run rate is per month of USE, so the divisor is how long dosing has actually
  // been running inside the window — not the window itself.
  //
  // The span must come from the SAME doses as the numerator: deliveredCost only
  // counts costed doses, so spanning over all doses (including a year of
  // uncosted history) divides a week's spend by twelve months.
  const costedKeys = doses.filter((x) => x.cost != null).map((x) => x.dayKey).sort();
  const firstDoseKey = costedKeys[0] ?? null;
  const monthsOfData = usageMonths({ firstDayKey: firstDoseKey, todayKey: toKey, windowMonths: window.months });

  return {
    currency,
    mixedCurrency: currencies.size > 1,
    window: { fromKey, toKey, label },
    totals: {
      peptideSpend: peptideSpend.toFixed(2),
      consumableSpend: consumableSpend.toFixed(2),
      shipping: shipping.toFixed(2),
      tax: tax.toFixed(2),
      fees: fees.toFixed(2),
      discount: discount.toFixed(2),
      unallocatedOverhead: unallocatedOverhead.toFixed(2),
      prescriptionEstimated: prescriptionEstimated.toFixed(2),
      grandTotal: inWindow.reduce((t, p) => t + Number(p.totals.total), 0).toFixed(2),
      accountedTotal: (inWindow.reduce((t, p) => t + Number(p.totals.total), 0) + prescriptionEstimated).toFixed(2),
      purchaseCount: inWindow.length,
    },
    spendByMonth: spendByMonth(monthRows),
    byPeptide: rollUpByPeptide({
      doses,
      spendByPeptide: new Map([...spendByPeptide].map(([k, v]) => [k, v.toFixed(2)])),
      names: peptideNames,
    }),
    consumables,
    perDose: costPerDose({ peptideCost: deliveredCost.toFixed(4), doseCount: dosesCosted, consumables }),
    waste: vialWaste({ vials: vialCosts, doses }),
    coverage: {
      vialsTotal: vials.length,
      vialsCosted: vialCosts.filter((v) => v.costPerMcg != null).length,
      vialsFromInvoice: vialCosts.filter((v) => v.costSource === "invoice").length,
      vialsFromPrescription: vialCosts.filter((v) => v.costSource === "prescription").length,
      dosesInWindow: doses.length,
      dosesCosted,
      purchasesWithUnallocatedOverhead: unallocatedCount,
    },
    runRate: {
      perMonth: monthsOfData > 0 && deliveredCost > 0 ? (deliveredCost / monthsOfData).toFixed(2) : null,
      monthsOfData,
    },
  };
}

function monthsAgo(now: Date, months: number): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

/**
 * Everything the invoice editor needs: the user's peptides, and the vials that
 * can be matched to a line. A vial is offered when it is unlinked, or already
 * linked to the invoice being edited (so editing does not drop its own links).
 */
export async function getPurchaseEditorData(userId: string, purchaseId?: string) {
  const [peptides, vials] = await Promise.all([
    prisma.peptide.findMany({
      where: { OR: [{ userId }, { userId: null }] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.vial.findMany({
      where: { userId },
      select: {
        id: true,
        peptideId: true,
        labelStrengthMg: true,
        status: true,
        lot: true,
        expiry: true,
        purchaseItemId: true,
        peptide: { select: { name: true } },
        purchaseItem: { select: { purchaseId: true } },
      },
      orderBy: [{ status: "asc" }, { peptide: { name: "asc" } }],
    }),
  ]);

  return {
    peptides,
    vials: vials
      .filter((v) => v.purchaseItemId == null || (purchaseId != null && v.purchaseItem?.purchaseId === purchaseId))
      .map((v) => ({
        id: v.id,
        peptideId: v.peptideId,
        peptideName: v.peptide.name,
        labelStrengthMg: v.labelStrengthMg.toString(),
        status: v.status,
        lot: v.lot,
        expiry: toDateInput(v.expiry),
        purchaseItemId: v.purchaseItemId,
      })),
  };
}
