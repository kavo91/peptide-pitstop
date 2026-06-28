"use client";

import { Save } from "lucide-react";
import Link from "next/link";

import { useState } from "react";
import { saveVial, type VialInput } from "@/app/actions/vials";

interface Opt { id: string; name: string }

const input = "w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";

export function VialForm({
  peptides,
  prescriptions,
  initial,
}: {
  peptides: Opt[];
  prescriptions: Opt[];
  initial?: VialInput;
}) {
  const [form, setForm] = useState<VialInput>(
    initial ?? { peptideId: peptides[0]?.id ?? "", labelStrengthMg: "", status: "sealed" },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof VialInput>(k: K, v: VialInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveVial(form);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    window.location.href = "/inventory";
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm text-muted">Peptide
        <select className={input + " mt-1"} value={form.peptideId} onChange={(e) => set("peptideId", e.target.value)}>
          {peptides.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="block text-sm text-muted">Label strength (mg)
        <input className={input + " mt-1"} inputMode="decimal" value={form.labelStrengthMg} onChange={(e) => set("labelStrengthMg", e.target.value)} placeholder="e.g. 15" />
      </label>
      <label className="block text-sm text-muted">Prescription (optional)
        <select className={input + " mt-1"} value={form.prescriptionId ?? ""} onChange={(e) => set("prescriptionId", e.target.value)}>
          <option value="">— none —</option>
          {prescriptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <div className="flex gap-2">
        <label className="block flex-1 text-sm text-muted">Lot
          <input className={input + " mt-1"} value={form.lot ?? ""} onChange={(e) => set("lot", e.target.value)} />
        </label>
        <label className="block flex-1 text-sm text-muted">Expiry
          <input type="date" className={input + " mt-1"} value={form.expiry ?? ""} onChange={(e) => set("expiry", e.target.value)} />
        </label>
      </div>
      <label className="block text-sm text-muted">Storage location
        <input className={input + " mt-1"} value={form.storageLocation ?? ""} onChange={(e) => set("storageLocation", e.target.value)} placeholder="e.g. fridge door" />
      </label>
      {initial?.id && (
        <label className="block text-sm text-muted">Status
          <select className={input + " mt-1"} value={form.status ?? "sealed"} onChange={(e) => set("status", e.target.value)}>
            {["sealed", "in_use", "finished", "discarded"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
        </label>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40">{busy ? "…" : <><Save className="h-4 w-4" aria-hidden /> Save vial</>}</button>
        <Link href="/inventory" className="rounded-control bg-bg px-4 py-3 text-sm ring-1 ring-line/15">Cancel</Link>
      </div>
    </div>
  );
}
