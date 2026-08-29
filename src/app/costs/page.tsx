/**
 * Costs — what the protocol actually costs, and what drives it.
 *
 * Spend is windowed on the order date; cost per dose is attributed by delivered
 * mass from the vial the dose came from. Coverage gaps (vials with no invoice
 * line) are shown rather than hidden, because an incomplete ledger understating
 * spend by 40% looks exactly like a cheap protocol.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/owner";
import { getCostAnalytics, getPurchases } from "@/lib/costs";
import { fmtMoney, fmtRate } from "@/lib/costs-core";
import { BackButton } from "@/components/BackButton";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { PitstopHeading } from "@/components/PitstopHeading";
import { activeDesign } from "@/lib/design";
import { PAGE_MAIN } from "@/lib/layout";
import { deletePurchase } from "@/app/actions/purchases";
import { prisma } from "@/lib/db";
import { splitCostByComponent } from "@/lib/blend-cost";
import type { BlendComponent } from "@/lib/blends-core";

export const dynamic = "force-dynamic";

const WINDOWS = [
  { key: "3", months: 3, label: "3m" },
  { key: "6", months: 6, label: "6m" },
  { key: "12", months: 12, label: "12m" },
  { key: "all", months: null, label: "All" },
] as const;

const CARD = "rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={CARD}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const chosen = WINDOWS.find((w) => w.key === sp.window) ?? WINDOWS[2];
  const [data, purchases] = await Promise.all([
    getCostAnalytics(user.id, { months: chosen.months }),
    getPurchases(user.id),
  ]);
  const cur = data.currency;

  // Blend composition: a blend is bought as ONE vial at ONE price, so its spend is
  // re-sliced across components by label mass fraction. Derived — never new spend.
  const blendRows = await prisma.blendComponent.findMany({
    where: { peptide: { userId: user.id } },
    include: { componentPeptide: { select: { name: true } } },
    orderBy: { sortIndex: "asc" },
  });
  const blendComponents = new Map<string, BlendComponent[]>();
  for (const r of blendRows) {
    const list = blendComponents.get(r.peptideId) ?? [];
    list.push({
      componentPeptideId: r.componentPeptideId,
      componentName: r.componentPeptide.name,
      massMg: Number(r.massMg.toString()),
      source: r.source as BlendComponent["source"],
      sortIndex: r.sortIndex,
    });
    blendComponents.set(r.peptideId, list);
  }
  const design = activeDesign();

  const uncostedVials = data.coverage.vialsTotal - data.coverage.vialsCosted;
  const uncostedDoses = data.coverage.dosesInWindow - data.coverage.dosesCosted;
  const maxMonth = Math.max(1, ...data.spendByMonth.map((m) => Number(m.total)));

  return (
    <main className={PAGE_MAIN}>
      <BackButton fallback="/more" />

      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <PitstopHeading title="Costs" index={12} design={design} className="text-3xl font-semibold tracking-tight" split={["CO", "STS"]} />
          <p className="text-muted">Landed cost per vial, per mg and per dose — shipping and sundries included.</p>
          <p className="text-xs text-muted">Bookkeeping only. Not medical advice.</p>
        </div>
        <Link href="/costs/new" className="shrink-0 rounded-control bg-accent px-3 py-2 text-sm font-medium text-onAccent">+ Invoice</Link>
      </div>

      {/* ── Window picker ────────────────────────────────────────────────── */}
      <nav className="mb-4 flex gap-1" aria-label="Reporting window">
        {WINDOWS.map((w) => (
          <Link
            key={w.key}
            href={`/costs?window=${w.key}`}
            aria-current={w.key === chosen.key ? "page" : undefined}
            className={`rounded-control px-3 py-1.5 text-xs font-medium ring-1 ring-line/15 ${
              w.key === chosen.key ? "bg-accent text-onAccent" : "bg-surface text-muted"
            }`}
          >
            {w.label}
          </Link>
        ))}
      </nav>

      {data.mixedCurrency && (
        <p className="mb-4 rounded-control bg-warn/10 px-3 py-2 text-xs font-medium text-warn">
          This window mixes currencies. Totals add different currencies together and are not meaningful — split the invoices or convert them.
        </p>
      )}

      {purchases.length === 0 ? (
        <div className={CARD}>
          <p className="text-sm font-medium">No invoices yet</p>
          <p className="mt-1 text-sm text-muted">
            Add an order to start tracking landed cost. Put shipping on the invoice, not on a line — it gets shared across everything the order delivered.
          </p>
          <Link href="/costs/new" className="mt-3 inline-block rounded-control bg-accent px-4 py-2 text-sm font-medium text-onAccent">Add the first invoice</Link>
        </div>
      ) : (
        <>
          {/* ── Headline ─────────────────────────────────────────────────── */}
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-semibold">{chosen.months == null ? "All time" : `Last ${chosen.months} months`}</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                label="Total spend"
                value={fmtMoney(data.totals.accountedTotal, cur)}
                sub={
                  Number(data.totals.prescriptionEstimated) > 0
                    ? `${data.totals.purchaseCount} invoice${data.totals.purchaseCount === 1 ? "" : "s"} + ${fmtMoney(data.totals.prescriptionEstimated, cur)} from scripts`
                    : `${data.totals.purchaseCount} invoice${data.totals.purchaseCount === 1 ? "" : "s"}`
                }
              />
              <Stat
                label="Cost per dose"
                value={fmtRate(data.perDose.total, cur)}
                sub={
                  data.perDose.consumableBasis
                    ? `peptide ${fmtRate(data.perDose.peptide, cur)} + sundries ${fmtRate(data.perDose.consumable, cur)} (${data.perDose.consumableBasis})`
                    : "peptide only — no sundries recorded"
                }
              />
              <Stat label="Shipping &amp; fees" value={fmtMoney((Number(data.totals.shipping) + Number(data.totals.tax) + Number(data.totals.fees)).toFixed(2), cur)} sub={`shipping ${fmtMoney(data.totals.shipping, cur)}`} />
              <Stat
                label="Run rate"
                value={data.runRate.perMonth ? `${fmtMoney(data.runRate.perMonth, cur)} /mo` : "—"}
                sub={`over ${data.runRate.monthsOfData} month${data.runRate.monthsOfData === 1 ? "" : "s"} of use`}
              />
            </div>
          </section>

          {/* ── Coverage warning ─────────────────────────────────────────── */}
          {/* Also fires on prescription-estimated vials: an estimate must be
              disclosed even when nothing else is incomplete, or a figure derived
              from a script silently reads as an invoiced price. */}
          {(uncostedVials > 0 || uncostedDoses > 0 || data.coverage.vialsFromPrescription > 0 || data.coverage.purchasesWithUnallocatedOverhead > 0) && (
            <section className="mb-6">
              <div className="rounded-card bg-warn/10 p-4 ring-1 ring-warn/20">
                <p className="text-sm font-medium text-warn">{uncostedVials > 0 || uncostedDoses > 0 ? "Figures are partial" : "How these figures were derived"}</p>
                <ul className="mt-1 space-y-0.5 text-xs text-warn/90">
                  {uncostedVials > 0 && <li>{uncostedVials} of {data.coverage.vialsTotal} vials have no invoice line and no prescription cost — their doses are excluded, not counted as free.</li>}
                  {data.coverage.vialsFromPrescription > 0 && (
                    <li>
                      {data.coverage.vialsFromPrescription} vial{data.coverage.vialsFromPrescription === 1 ? " is" : "s are"} priced from the prescription rather than an invoice
                      ({fmtMoney(data.totals.prescriptionEstimated, cur)}) — an estimate that carries no shipping.
                    </li>
                  )}
                  {uncostedDoses > 0 && <li>{uncostedDoses} of {data.coverage.dosesInWindow} doses in this window came from an uncosted or unlinked vial.</li>}
                  {data.coverage.purchasesWithUnallocatedOverhead > 0 && <li>{data.coverage.purchasesWithUnallocatedOverhead} invoice(s) keep shipping unallocated ({fmtMoney(data.totals.unallocatedOverhead, cur)} not in any per-vial cost).</li>}
                </ul>
              </div>
            </section>
          )}

          <div className="lg:mb-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
            {/* ── Per peptide ────────────────────────────────────────────── */}
            <section className="mb-6 lg:mb-0">
              <h2 className="mb-2 text-sm font-semibold">By peptide</h2>
              <div className={CARD + " overflow-x-auto"}>
                {data.byPeptide.length === 0 ? (
                  <p className="text-sm text-muted">Nothing bought or dosed in this window.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th className="pb-2 font-medium">Peptide</th>
                        <th className="pb-2 text-right font-medium">Spend</th>
                        <th className="pb-2 text-right font-medium">Per dose</th>
                        <th className="pb-2 text-right font-medium">Per mg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byPeptide.flatMap((r) => [
                        <tr key={r.peptideId} className="border-t border-line/10">
                          <td className="py-2">
                            {r.peptideName}
                            <span className="block text-xs text-muted">
                              {r.doseCount} dose{r.doseCount === 1 ? "" : "s"}
                              {r.uncostedDoses > 0 && ` · ${r.uncostedDoses} uncosted`}
                            </span>
                          </td>
                          {/* A peptide with no invoice line has UNKNOWN spend, not
                              zero spend — rendering "$0.00" would read as "this
                              one was free", which is the exact misreading this
                              screen exists to prevent. */}
                          <td className="py-2 text-right tabular-nums">{Number(r.spend) > 0 ? fmtMoney(r.spend, cur) : "—"}</td>
                          <td className="py-2 text-right tabular-nums">{fmtRate(r.costPerDose, cur)}</td>
                          <td className="py-2 text-right tabular-nums">{fmtRate(r.costPerMg, cur)}</td>
                        </tr>,
                        /* A blend's spend split across its components by label mass
                           fraction. Derived — it re-slices money already counted on
                           the row above, and must never be summed with it. */
                        ...splitCostByComponent(
                          Number(r.spend) > 0 ? r.spend : null,
                          blendComponents.get(r.peptideId) ?? [],
                        ).map((c) => (
                          <tr key={`${r.peptideId}:${c.componentPeptideId}`} className="text-xs text-muted">
                            <td className="py-1 pl-4">↳ {c.componentName}</td>
                            <td className="py-1 text-right tabular-nums">
                              {fmtMoney(String(c.cost), cur)} (derived, {c.source})
                            </td>
                            <td className="py-1 text-right">—</td>
                            <td className="py-1 text-right">—</td>
                          </tr>
                        )),
                      ])}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {/* ── Monthly spend ──────────────────────────────────────────── */}
            <section className="mb-6 lg:mb-0">
              <h2 className="mb-2 text-sm font-semibold">Spend by month</h2>
              <div className={CARD}>
                {data.spendByMonth.length === 0 ? (
                  <p className="text-sm text-muted">No invoices in this window.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.spendByMonth.map((m) => (
                      <li key={m.monthKey}>
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="text-muted">{m.monthKey}</span>
                          <span className="font-medium tabular-nums">{fmtMoney(m.total, cur)}</span>
                        </div>
                        {/* Stacked bar: peptides · sundries · shipping+fees. */}
                        <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-line/[0.08]" style={{ width: `${Math.max(4, (Number(m.total) / maxMonth) * 100)}%` }}>
                          <div className="bg-accent" style={{ width: `${pct(m.peptide, m.total)}%` }} />
                          <div className="bg-accentStrong/60" style={{ width: `${pct(m.consumable, m.total)}%` }} />
                          <div className="bg-warn/70" style={{ width: `${pct(m.overhead, m.total)}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted">
                  <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-accent" aria-hidden /> Peptides</span>
                  <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-accentStrong/60" aria-hidden /> Sundries</span>
                  <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-warn/70" aria-hidden /> Shipping &amp; fees</span>
                </p>
              </div>
            </section>
          </div>

          <div className="lg:mb-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
            {/* ── Sundries ───────────────────────────────────────────────── */}
            <section className="mb-6 lg:mb-0">
              <h2 className="mb-2 text-sm font-semibold">Sundries &amp; consumables</h2>
              <div className={CARD}>
                {data.consumables.byCategory.length === 0 ? (
                  <p className="text-sm text-muted">
                    None recorded. Add needles, swabs, pen tips or a sharps container as consumable lines on an invoice to see their share of each injection.
                  </p>
                ) : (
                  <>
                    <dl className="space-y-2 text-sm">
                      {data.consumables.byCategory.map((c) => (
                        <div key={c.category} className="flex items-baseline justify-between gap-3">
                          <dt>
                            {c.label}
                            <span className="block text-xs text-muted">{c.pieces} piece{c.pieces === 1 ? "" : "s"} · {fmtRate(c.costPerPiece, cur)} each</span>
                          </dt>
                          <dd className="font-medium tabular-nums">{fmtMoney(c.spend, cur)}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-3 border-t border-line/10 pt-3 text-sm">
                      <div className="flex items-baseline justify-between">
                        <span className="text-muted">Per injection</span>
                        <span className="font-semibold tabular-nums">{fmtRate(data.consumables.modelledPerDose ?? data.consumables.amortisedPerDose, cur)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        {data.consumables.modelledPerDose != null
                          ? "Modelled from the units-per-dose you set on each line."
                          : "Amortised: total sundry spend ÷ doses in the window. Set a units-per-dose on a line for a modelled figure."}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </section>

            {/* ── Waste ──────────────────────────────────────────────────── */}
            <section className="mb-6 lg:mb-0">
              <h2 className="mb-2 text-sm font-semibold">Wasted product</h2>
              <div className={CARD}>
                <p className="text-xl font-semibold tabular-nums">{fmtMoney(data.waste.total, cur)}</p>
                <p className="mt-0.5 text-xs text-muted">
                  Value of mass never delivered from vials marked finished or discarded. Sealed and in-use vials are inventory, not waste.
                </p>
                {data.waste.byVial.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {data.waste.byVial.slice(0, 6).map((w) => (
                      <li key={w.vialId} className="flex items-baseline justify-between gap-3">
                        <span>
                          {w.peptideName}
                          <span className="block text-xs text-muted">{w.wastePct}% unused · {w.status}</span>
                        </span>
                        <span className="font-medium tabular-nums">{fmtMoney(w.wasteCost, cur)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          {/* ── Invoice ledger ───────────────────────────────────────────── */}
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-semibold">Invoices</h2>
            <ul className="grid gap-3 lg:grid-cols-2">
              {purchases.map((p) => (
                <li key={p.id} className={CARD}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{p.vendor ?? "Order"}</p>
                      <p className="text-sm text-muted">
                        {p.orderedAt}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </p>
                    </div>
                    <p className="shrink-0 text-lg font-semibold tabular-nums">{fmtMoney(p.totals.total, p.currency)}</p>
                  </div>

                  <ul className="mt-3 space-y-1 text-sm">
                    {p.items.map((i) => (
                      <li key={i.id} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0">
                          <span className="truncate">{i.quantity}× {i.description}</span>
                          <span className="block text-xs text-muted">
                            {fmtMoney(i.subtotal, p.currency)} + {fmtMoney(i.allocated, p.currency)} ship
                            {i.kind === "peptide" && ` · ${i.vialIds.length} vial${i.vialIds.length === 1 ? "" : "s"} matched`}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums">{fmtRate(i.landedUnit, p.currency)} ea</span>
                      </li>
                    ))}
                  </ul>

                  {p.vialsLinked < p.vialsExpected && (
                    <p className="mt-2 text-xs text-muted">
                      {p.vialsExpected - p.vialsLinked} vial{p.vialsExpected - p.vialsLinked === 1 ? "" : "s"} on this invoice not yet matched to inventory.
                    </p>
                  )}

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <ConfirmDeleteButton
                      action={deletePurchase}
                      id={p.id}
                      ariaLabel="Delete this invoice"
                      confirmMessage="Delete this invoice? The vials it bought are kept and just become uncosted."
                    />
                    <Link href={`/costs/${p.id}/edit`} className="text-xs font-medium text-accentStrong">Edit</Link>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

/** Share of a stacked bar, clamped so a rounding wobble can't overflow the row. */
function pct(part: string, total: string): number {
  const t = Number(total);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return Math.max(0, Math.min(100, (Number(part) / t) * 100));
}
