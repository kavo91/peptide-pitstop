"use client";

import { Save } from "lucide-react";
import Link from "next/link";

import { useState } from "react";
import { savePrescription, type PrescriptionInput } from "@/app/actions/prescriptions";
import { addStackPrescription } from "@/app/actions/stacks";

interface Opt { id: string; name: string }

const input = "w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";
const STACK = "stack:";

export function PrescriptionForm({ peptides, stacks = [], initial }: { peptides: Opt[]; stacks?: Opt[]; initial?: PrescriptionInput }) {
  const [form, setForm] = useState<PrescriptionInput>(
    initial ?? { peptideId: peptides[0]?.id ?? "", currency: "AUD", status: "active" },
  );
  // Selected target: a peptide id, or `stack:<id>` for a grouped stack prescription.
  const [target, setTarget] = useState<string>(initial?.peptideId ?? peptides[0]?.id ?? (stacks[0] ? `${STACK}${stacks[0].id}` : ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isStack = target.startsWith(STACK);

  function set<K extends keyof PrescriptionInput>(k: K, v: PrescriptionInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = isStack
      ? await addStackPrescription({
          stackId: target.slice(STACK.length),
          source: form.source,
          prescriber: form.prescriber,
          pharmacy: form.pharmacy,
          doseInstructions: form.doseInstructions,
          refillsAuthorized: form.refillsAuthorized,
          refillsRemaining: form.refillsRemaining,
          nextRefill: form.nextRefill,
          expiration: form.expiration,
          dateWritten: form.dateWritten,
          cost: form.cost,
          quantity: form.quantity,
          leadTimeDays: form.leadTimeDays,
        })
      : await savePrescription({ ...form, peptideId: target });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    window.location.href = "/prescriptions";
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm text-muted">{stacks.length > 0 ? "Peptide or stack" : "Peptide"}
        <select className={input + " mt-1"} value={target} onChange={(e) => setTarget(e.target.value)} disabled={!!initial?.id}>
          <optgroup label="Peptides">
            {peptides.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
          {stacks.length > 0 && (
            <optgroup label="Stacks">
              {stacks.map((s) => <option key={s.id} value={`${STACK}${s.id}`}>{s.name} (stack)</option>)}
            </optgroup>
          )}
        </select>
      </label>
      {isStack && <p className="-mt-1 text-xs text-muted">One grouped script covering all the stack&apos;s compounds; it links every component vial.</p>}
      <div className="flex gap-2">
        <label className="block flex-1 text-sm text-muted">Source
          <input className={input + " mt-1"} value={form.source ?? ""} onChange={(e) => set("source", e.target.value)} placeholder="e.g. GetLimitless" />
        </label>
        <label className="block flex-1 text-sm text-muted">Pharmacy
          <input className={input + " mt-1"} value={form.pharmacy ?? ""} onChange={(e) => set("pharmacy", e.target.value)} />
        </label>
      </div>
      <label className="block text-sm text-muted">Prescriber
        <input className={input + " mt-1"} value={form.prescriber ?? ""} onChange={(e) => set("prescriber", e.target.value)} />
      </label>
      <label className="block text-sm text-muted">Dose instructions
        <input className={input + " mt-1"} value={form.doseInstructions ?? ""} onChange={(e) => set("doseInstructions", e.target.value)} placeholder="e.g. 0.5 mL three times a week" />
      </label>
      <div className="flex gap-2">
        <label className="block flex-1 text-sm text-muted">Cost
          <input className={input + " mt-1"} inputMode="decimal" value={form.cost ?? ""} onChange={(e) => set("cost", e.target.value)} />
        </label>
        <label className="block w-24 text-sm text-muted">Currency
          <input className={input + " mt-1"} value={form.currency ?? "AUD"} onChange={(e) => set("currency", e.target.value)} />
        </label>
        <label className="block w-24 text-sm text-muted">Qty
          <input className={input + " mt-1"} inputMode="numeric" value={form.quantity ?? ""} onChange={(e) => set("quantity", e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <label className="block flex-1 text-sm text-muted">Refills auth.
          <input className={input + " mt-1"} inputMode="numeric" value={form.refillsAuthorized ?? ""} onChange={(e) => set("refillsAuthorized", e.target.value)} />
        </label>
        <label className="block flex-1 text-sm text-muted">Refills left
          <input className={input + " mt-1"} inputMode="numeric" value={form.refillsRemaining ?? ""} onChange={(e) => set("refillsRemaining", e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <label className="block flex-1 text-sm text-muted">Date written
          <input type="date" className={input + " mt-1"} value={form.dateWritten ?? ""} onChange={(e) => set("dateWritten", e.target.value)} />
        </label>
        <label className="block flex-1 text-sm text-muted">Next refill
          <input type="date" className={input + " mt-1"} value={form.nextRefill ?? ""} onChange={(e) => set("nextRefill", e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <label className="block flex-1 text-sm text-muted">Expiry
          <input type="date" className={input + " mt-1"} value={form.expiration ?? ""} onChange={(e) => set("expiration", e.target.value)} />
        </label>
        <label className="block flex-1 text-sm text-muted">Reorder lead time (days)
          <input className={input + " mt-1"} inputMode="numeric" min="0" value={form.leadTimeDays ?? ""} onChange={(e) => set("leadTimeDays", e.target.value)} placeholder="e.g. 14" />
        </label>
      </div>
      {initial?.id && (
        <label className="block text-sm text-muted">Status
          <select className={input + " mt-1"} value={form.status ?? "active"} onChange={(e) => set("status", e.target.value)}>
            {["active", "expired", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40">{busy ? "…" : <><Save className="h-4 w-4" aria-hidden /> Save prescription</>}</button>
        <Link href="/prescriptions" className="rounded-control bg-bg px-4 py-3 text-sm ring-1 ring-line/15">Cancel</Link>
      </div>
    </div>
  );
}
