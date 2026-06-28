"use client";

import { Pencil, Trash2, Save, X, Plus } from "lucide-react";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSyringe, deleteSyringe, type SyringeInput } from "@/app/actions/syringes";

interface Syringe {
  id: string;
  name: string;
  graduationType: string;
  unitsPerMl: string;
  capacityMl: string;
  capacityUnits: string;
  increment: string;
}

const BLANK: SyringeInput = {
  name: "",
  graduationType: "units",
  unitsPerMl: "100",
  capacityMl: "1",
  capacityUnits: "100",
  increment: "1",
};

const input = "w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";

export function SyringeManager({ syringes }: { syringes: Syringe[] }) {
  const router = useRouter();
  const [form, setForm] = useState<SyringeInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof SyringeInput>(k: K, v: SyringeInput[K]) {
    setForm((f) => ({ ...(f ?? BLANK), [k]: v }));
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    const res = await saveSyringe(form);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    const res = await deleteSyringe(id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {syringes.map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded-card bg-surface px-4 py-3 text-sm shadow-sm ring-1 ring-line/10">
            <div>
              <p className="font-medium">{s.name}</p>
              <p className="text-xs text-muted">{s.graduationType} · {s.capacityMl} mL / {s.capacityUnits}u · step {s.increment}</p>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setForm({ ...s })} className="inline-flex items-center gap-1 text-xs font-medium text-accentStrong"><Pencil className="h-3.5 w-3.5" aria-hidden /> Edit</button>
              <button type="button" onClick={() => remove(s.id)} disabled={busy} className="inline-flex items-center gap-1 text-xs font-medium text-danger"><Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete</button>
            </div>
          </li>
        ))}
      </ul>

      {form ? (
        <div className="space-y-2 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
          <p className="text-sm font-medium">{form.id ? "Edit syringe" : "New syringe"}</p>
          <input className={input} placeholder="Name (e.g. 1 mL U-100 insulin)" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <select className={input} value={form.graduationType} onChange={(e) => set("graduationType", e.target.value)} aria-label="Graduation type">
            <option value="units">unit-graduated (insulin)</option>
            <option value="ml">mL-graduated</option>
          </select>
          <div className="flex gap-2">
            <input className={input} inputMode="decimal" placeholder="Units/mL" value={form.unitsPerMl} onChange={(e) => set("unitsPerMl", e.target.value)} />
            <input className={input} inputMode="decimal" placeholder="Capacity mL" value={form.capacityMl} onChange={(e) => set("capacityMl", e.target.value)} />
          </div>
          <div className="flex gap-2">
            <input className={input} inputMode="decimal" placeholder="Capacity units" value={form.capacityUnits} onChange={(e) => set("capacityUnits", e.target.value)} />
            <input className={input} inputMode="decimal" placeholder="Smallest mark" value={form.increment} onChange={(e) => set("increment", e.target.value)} />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-accent px-4 py-2 text-sm font-medium text-onAccent disabled:opacity-40">{busy ? "…" : <><Save className="h-4 w-4" aria-hidden /> Save</>}</button>
            <button type="button" onClick={() => { setForm(null); setError(null); }} className="inline-flex items-center gap-1.5 rounded-control bg-bg px-4 py-2 text-sm ring-1 ring-line/15"><X className="h-4 w-4" aria-hidden /> Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setForm({ ...BLANK })} className="flex w-full items-center justify-center gap-1.5 rounded-control bg-bg px-4 py-2 text-sm font-medium text-accentStrong ring-1 ring-line/15"><Plus className="h-4 w-4" aria-hidden /> Add syringe</button>
      )}
      {error && !form && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
