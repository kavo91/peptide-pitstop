"use client";

/**
 * Invoice editor. One invoice → many lines → many vials.
 *
 * The allocation preview is the point of this screen: shipping, tax and fees
 * are entered ONCE at the invoice level, and every line shows the share it
 * carries and the resulting per-vial landed cost, live, before saving. The
 * preview runs the same `allocateOverhead` the server and the analytics use, so
 * what is shown here is what gets stored — there is no second implementation to
 * drift.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Save, Plus, X } from "lucide-react";
import { savePurchase, type PurchaseInput, type PurchaseItemInput } from "@/app/actions/purchases";
import {
  allocateOverhead,
  fmtMoney,
  CONSUMABLE_CATEGORIES,
  CONSUMABLE_CATEGORY_LABELS,
  type AllocationMethod,
} from "@/lib/costs-core";

const input = "w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";

export interface VialOption {
  id: string;
  peptideId: string;
  peptideName: string;
  labelStrengthMg: string;
  status: string;
  lot: string | null;
  expiry: string | null;
}

interface Props {
  peptides: { id: string; name: string }[];
  vials: VialOption[];
  initial?: PurchaseInput;
}

type Line = PurchaseItemInput & { key: string };

let seq = 0;
const nextKey = () => `l${++seq}`;

function blankLine(kind: "peptide" | "consumable", peptideId?: string): Line {
  return kind === "peptide"
    ? { key: nextKey(), kind, peptideId: peptideId ?? "", description: "", quantity: "1", unitCost: "", vialIds: [] }
    : { key: nextKey(), kind, category: "needle", description: "", quantity: "1", unitCost: "", unitsPerPack: "", unitsPerDose: "", vialIds: [] };
}

const METHOD_LABEL: Record<AllocationMethod, string> = {
  value: "Pro-rata by line value",
  quantity: "Equal per unit",
  none: "Don't allocate (keep separate)",
};

export function PurchaseForm({ peptides, vials, initial }: Props) {
  const [head, setHead] = useState<Omit<PurchaseInput, "items">>({
    id: initial?.id,
    vendor: initial?.vendor ?? "",
    reference: initial?.reference ?? "",
    orderedAt: initial?.orderedAt ?? new Date().toISOString().slice(0, 10),
    receivedAt: initial?.receivedAt ?? "",
    currency: initial?.currency ?? "AUD",
    shippingCost: initial?.shippingCost ?? "",
    taxCost: initial?.taxCost ?? "",
    otherFees: initial?.otherFees ?? "",
    discount: initial?.discount ?? "",
    allocationMethod: initial?.allocationMethod ?? "value",
    notes: initial?.notes ?? "",
  });
  const [lines, setLines] = useState<Line[]>(
    initial?.items?.length
      ? initial.items.map((i) => ({ ...i, key: nextKey() }))
      : [blankLine("peptide", peptides[0]?.id)],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = head.currency || "AUD";

  function setH<K extends keyof typeof head>(k: K, v: (typeof head)[K]) {
    setHead((h) => ({ ...h, [k]: v }));
  }
  function setLine(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  // Live allocation preview — the same engine the server persists against.
  const preview = useMemo(
    () =>
      allocateOverhead({
        lines: lines.map((l) => ({
          id: l.key,
          kind: l.kind,
          quantity: Number(l.quantity) || 0,
          unitCost: l.unitCost || "0",
        })),
        shippingCost: head.shippingCost,
        taxCost: head.taxCost,
        otherFees: head.otherFees,
        discount: head.discount,
        method: (head.allocationMethod as AllocationMethod) ?? "value",
      }),
    [lines, head.shippingCost, head.taxCost, head.otherFees, head.discount, head.allocationMethod],
  );
  const previewById = new Map(preview.lines.map((l) => [l.id, l]));

  // A vial is offered to a line when it matches the line's peptide and is not
  // already ticked on another line — a vial is bought exactly once.
  const claimedElsewhere = (key: string) =>
    new Set(lines.filter((l) => l.key !== key).flatMap((l) => l.vialIds ?? []));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await savePurchase({
      ...head,
      orderedAt: head.orderedAt,
      items: lines.map(({ key: _key, ...rest }) => rest),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    window.location.href = "/costs";
  }

  return (
    <div className="space-y-4">
      {/* ── Invoice header ─────────────────────────────────────────────── */}
      <section className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
        <h2 className="mb-3 text-sm font-semibold">Invoice</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-muted">Supplier
            <input className={input + " mt-1"} value={head.vendor ?? ""} onChange={(e) => setH("vendor", e.target.value)} placeholder="e.g. your supplier" />
          </label>
          <label className="block text-sm text-muted">Invoice / order no.
            <input className={input + " mt-1"} value={head.reference ?? ""} onChange={(e) => setH("reference", e.target.value)} />
          </label>
          <label className="block text-sm text-muted">Ordered
            <input type="date" className={input + " mt-1"} value={head.orderedAt} onChange={(e) => setH("orderedAt", e.target.value)} />
          </label>
          <label className="block text-sm text-muted">Received
            <input type="date" className={input + " mt-1"} value={head.receivedAt ?? ""} onChange={(e) => setH("receivedAt", e.target.value)} />
          </label>
        </div>
      </section>

      {/* ── Shipping & fees ────────────────────────────────────────────── */}
      <section className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
        <h2 className="text-sm font-semibold">Shipping &amp; fees</h2>
        <p className="mb-3 mt-0.5 text-xs text-muted">
          Charged once on the order, then shared across the lines below — so a single courier fee is spread over every vial it delivered.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <label className="block text-sm text-muted">Shipping
            <input className={input + " mt-1"} inputMode="decimal" value={head.shippingCost ?? ""} onChange={(e) => setH("shippingCost", e.target.value)} placeholder="0.00" />
          </label>
          <label className="block text-sm text-muted">Tax / GST
            <input className={input + " mt-1"} inputMode="decimal" value={head.taxCost ?? ""} onChange={(e) => setH("taxCost", e.target.value)} placeholder="0.00" />
          </label>
          <label className="block text-sm text-muted">Other fees
            <input className={input + " mt-1"} inputMode="decimal" value={head.otherFees ?? ""} onChange={(e) => setH("otherFees", e.target.value)} placeholder="0.00" />
          </label>
          <label className="block text-sm text-muted">Discount
            <input className={input + " mt-1"} inputMode="decimal" value={head.discount ?? ""} onChange={(e) => setH("discount", e.target.value)} placeholder="0.00" />
          </label>
          <label className="block text-sm text-muted">Currency
            <input className={input + " mt-1"} value={head.currency ?? "AUD"} onChange={(e) => setH("currency", e.target.value)} />
          </label>
        </div>
        <label className="mt-3 block text-sm text-muted">Share shipping &amp; fees
          <select className={input + " mt-1"} value={head.allocationMethod ?? "value"} onChange={(e) => setH("allocationMethod", e.target.value)}>
            {(Object.keys(METHOD_LABEL) as AllocationMethod[]).map((m) => (
              <option key={m} value={m}>{METHOD_LABEL[m]}</option>
            ))}
          </select>
        </label>
        {preview.effectiveMethod === "quantity-fallback" && (
          <p className="mt-2 text-xs text-warn">
            Every line is $0, so there is no value to share by — shipping was split equally per unit instead.
          </p>
        )}
        {Number(preview.unallocated) !== 0 && (
          <p className="mt-2 text-xs text-muted">
            {fmtMoney(preview.unallocated, currency)} stays unallocated and is reported separately.
          </p>
        )}
      </section>

      {/* ── Lines ──────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Lines</h2>
          <div className="flex gap-2">
            <button type="button" onClick={() => setLines((l) => [...l, blankLine("peptide", peptides[0]?.id)])} className="flex items-center gap-1 rounded-control bg-bg px-3 py-2 text-xs font-medium ring-1 ring-line/15">
              <Plus className="h-3 w-3" aria-hidden /> Peptide
            </button>
            <button type="button" onClick={() => setLines((l) => [...l, blankLine("consumable")])} className="flex items-center gap-1 rounded-control bg-bg px-3 py-2 text-xs font-medium ring-1 ring-line/15">
              <Plus className="h-3 w-3" aria-hidden /> Consumable
            </button>
          </div>
        </div>

        {lines.map((l, idx) => {
          const p = previewById.get(l.key);
          const taken = claimedElsewhere(l.key);
          const candidates = l.kind === "peptide" ? vials.filter((v) => v.peptideId === l.peptideId && !taken.has(v.id)) : [];
          const picked = new Set(l.vialIds ?? []);

          return (
            <div key={l.key} className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
              <div className="mb-3 flex items-center justify-between">
                <span className="rounded-full bg-line/[0.06] px-2 py-0.5 text-xs font-medium capitalize text-muted">
                  {l.kind} · line {idx + 1}
                </span>
                {lines.length > 1 && (
                  <button type="button" aria-label={`Remove line ${idx + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="text-muted hover:text-danger">
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {l.kind === "peptide" ? (
                  <label className="block text-sm text-muted">Peptide
                    <select className={input + " mt-1"} value={l.peptideId ?? ""} onChange={(e) => setLine(l.key, { peptideId: e.target.value, vialIds: [] })}>
                      <option value="">Choose…</option>
                      {peptides.map((pp) => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <label className="block text-sm text-muted">Category
                    <select className={input + " mt-1"} value={l.category ?? "other"} onChange={(e) => setLine(l.key, { category: e.target.value })}>
                      {CONSUMABLE_CATEGORIES.map((c) => <option key={c} value={c}>{CONSUMABLE_CATEGORY_LABELS[c]}</option>)}
                    </select>
                  </label>
                )}
                <label className="block text-sm text-muted">Description
                  <input className={input + " mt-1"} value={l.description ?? ""} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder={l.kind === "peptide" ? "e.g. BPC-157 10mg vial" : "e.g. 29g × 100 box"} />
                </label>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="block text-sm text-muted">{l.kind === "peptide" ? "Vials" : "Packs"}
                  <input className={input + " mt-1"} inputMode="numeric" value={l.quantity ?? ""} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                </label>
                <label className="block text-sm text-muted">Unit cost
                  <input className={input + " mt-1"} inputMode="decimal" value={l.unitCost ?? ""} onChange={(e) => setLine(l.key, { unitCost: e.target.value })} placeholder="0.00" />
                </label>
                {l.kind === "consumable" && (
                  <>
                    <label className="block text-sm text-muted">Per pack
                      <input className={input + " mt-1"} inputMode="numeric" value={l.unitsPerPack ?? ""} onChange={(e) => setLine(l.key, { unitsPerPack: e.target.value })} placeholder="e.g. 100" />
                    </label>
                    <label className="block text-sm text-muted">Used per dose
                      <input className={input + " mt-1"} inputMode="decimal" value={l.unitsPerDose ?? ""} onChange={(e) => setLine(l.key, { unitsPerDose: e.target.value })} placeholder="e.g. 1" />
                    </label>
                  </>
                )}
              </div>

              {/* Live landed-cost readout for this line. */}
              {p && (
                <dl className="mt-3 grid grid-cols-3 gap-2 rounded-control bg-bg px-3 py-2 text-xs">
                  <div>
                    <dt className="text-muted">Line</dt>
                    <dd className="font-medium tabular-nums">{fmtMoney(p.subtotal, currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">+ shipping share</dt>
                    <dd className="font-medium tabular-nums">{fmtMoney(p.allocated, currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Landed each</dt>
                    <dd className="font-semibold tabular-nums text-accentStrong">{fmtMoney(p.landedUnit, currency)}</dd>
                  </div>
                </dl>
              )}

              {/* ── Vial matching ───────────────────────────────────────── */}
              {l.kind === "peptide" && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-muted">
                    Match vials ({picked.size} of {Number(l.quantity) || 0})
                  </p>
                  {!l.peptideId ? (
                    <p className="mt-1 text-xs text-muted">Choose a peptide to see its vials.</p>
                  ) : candidates.length === 0 ? (
                    <p className="mt-1 text-xs text-muted">
                      No unmatched vials for this peptide. Add them in Inventory, then link them here — the line&apos;s cost per vial applies either way.
                    </p>
                  ) : (
                    <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                      {candidates.map((v) => (
                        <li key={v.id}>
                          <label className="flex items-center gap-2 rounded-control bg-bg px-3 py-2 text-xs ring-1 ring-line/10">
                            <input
                              type="checkbox"
                              checked={picked.has(v.id)}
                              onChange={(e) => {
                                const next = new Set(picked);
                                if (e.target.checked) next.add(v.id);
                                else next.delete(v.id);
                                setLine(l.key, { vialIds: [...next] });
                              }}
                            />
                            <span className="flex-1">
                              {v.labelStrengthMg}mg
                              {v.lot ? ` · lot ${v.lot}` : ""}
                              <span className="text-muted"> · {v.status.replace("_", " ")}</span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  {picked.size > (Number(l.quantity) || 0) && (
                    <p className="mt-1 text-xs text-warn">
                      More vials matched than the line bought — raise the vial count or untick one.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* ── Invoice total ──────────────────────────────────────────────── */}
      <section className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted">Lines</dt>
            <dd className="font-medium tabular-nums">{fmtMoney(preview.subtotal, currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Shipping &amp; fees</dt>
            <dd className="font-medium tabular-nums">{fmtMoney(preview.overhead, currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Invoice total</dt>
            <dd className="text-base font-semibold tabular-nums">{fmtMoney(preview.total, currency)}</dd>
          </div>
        </dl>
        <label className="mt-3 block text-sm text-muted">Notes
          <input className={input + " mt-1"} value={head.notes ?? ""} onChange={(e) => setH("notes", e.target.value)} />
        </label>
      </section>

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40">
          {busy ? "…" : <><Save className="h-4 w-4" aria-hidden /> Save invoice</>}
        </button>
        <Link href="/costs" className="rounded-control bg-bg px-4 py-3 text-sm ring-1 ring-line/15">Cancel</Link>
      </div>
    </div>
  );
}
