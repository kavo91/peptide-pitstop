"use client";

/**
 * Build a stack: a named group of already-reconstituted (premixed) vials, each
 * created as a real volume-dosed protocol. One save → peptide + vial(s) + premixed
 * prep + protocol per component, linked under the stack.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Plus, Save, X } from "lucide-react";
import { createStack } from "@/app/actions/stacks";
import { perInjectionMcg, vialLabelStrengthMg } from "@/lib/stacks/compute";

const field = "rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";
const input = `w-full ${field}`;

interface Row {
  name: string;
  conc: string; // mcg/ml
  vialMl: string; // vial size
  qty: string;
  doseMl: string;
}
const emptyRow = (): Row => ({ name: "", conc: "", vialMl: "5", qty: "1", doseMl: "0.2" });

export function StackBuilder({ options }: { options: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function reset() {
    setName("");
    setRows([emptyRow(), emptyRow()]);
    setError(null);
  }

  async function save() {
    setError(null);
    const nm = name.trim();
    if (!nm) return setError("Give the stack a name.");
    const components = rows
      .filter((r) => r.name.trim() && vialLabelStrengthMg(r.conc, r.vialMl) && perInjectionMcg(r.doseMl, r.conc))
      .map((r) => ({
        peptideName: r.name.trim(),
        concentrationMcgPerMl: r.conc.trim(),
        vialSizeMl: r.vialMl.trim(),
        qty: r.qty.trim() || "1",
        doseMl: r.doseMl.trim(),
      }));
    if (components.length === 0) return setError("Add at least one component with a concentration and dose.");
    setBusy(true);
    const res = await createStack({ name: nm, components });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    reset();
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-control bg-bg px-4 py-2 text-sm font-medium text-accentStrong ring-1 ring-line/15"
      >
        <span className="inline-flex items-center gap-1.5">
          <Layers className="h-4 w-4" aria-hidden /> Build a stack
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      <p className="text-sm font-medium">Build a stack</p>
      <p className="text-xs text-muted">
        Group already-reconstituted (premixed) vials taken together. Reference only — not medical advice.
      </p>
      <input className={input} placeholder="Stack name (e.g. BPC + TB)" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="space-y-3">
        {rows.map((r, i) => {
          const mcg = perInjectionMcg(r.doseMl, r.conc);
          const vialMg = vialLabelStrengthMg(r.conc, r.vialMl);
          return (
            <div key={i} className="space-y-1.5 rounded-control bg-bg p-2.5 ring-1 ring-line/10">
              <div className="flex items-center gap-2">
                <select
                  className={`${field} min-w-0 flex-1`}
                  value={r.name}
                  onChange={(e) => setRow(i, { name: e.target.value })}
                  aria-label={`Component ${i + 1}`}
                >
                  <option value="">Choose a peptide…</option>
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <span className="shrink-0 rounded-control bg-surface px-2 py-1 text-xs text-muted ring-1 ring-line/15">Premixed</span>
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  disabled={rows.length <= 1}
                  className="shrink-0 rounded-control bg-surface p-2 ring-1 ring-line/15 disabled:opacity-30"
                  aria-label={`Remove component ${i + 1}`}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  className={`${field} w-24 shrink-0`}
                  inputMode="decimal"
                  placeholder="mcg/ml"
                  value={r.conc}
                  onChange={(e) => setRow(i, { conc: e.target.value })}
                  aria-label={`Component ${i + 1} concentration mcg/ml`}
                />
                <input
                  className={`${field} w-20 shrink-0`}
                  inputMode="decimal"
                  placeholder="vial ml"
                  value={r.vialMl}
                  onChange={(e) => setRow(i, { vialMl: e.target.value })}
                  aria-label={`Component ${i + 1} vial ml`}
                />
                <input
                  className={`${field} w-16 shrink-0`}
                  inputMode="numeric"
                  placeholder="qty"
                  value={r.qty}
                  onChange={(e) => setRow(i, { qty: e.target.value })}
                  aria-label={`Component ${i + 1} quantity`}
                />
                <input
                  className={`${field} w-20 shrink-0`}
                  inputMode="decimal"
                  placeholder="dose ml"
                  value={r.doseMl}
                  onChange={(e) => setRow(i, { doseMl: e.target.value })}
                  aria-label={`Component ${i + 1} dose ml`}
                />
              </div>
              <p className="text-xs text-muted">
                {mcg ? `${r.doseMl} ml → ${mcg} mcg` : "enter mcg/ml + dose"}
                {vialMg ? ` · ${vialMg} mg/vial` : ""}
              </p>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, emptyRow()])}
          className="inline-flex items-center gap-1 text-xs font-medium text-accentStrong"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add component
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-accent px-4 py-2 text-sm font-medium text-onAccent disabled:opacity-40"
        >
          {busy ? "…" : (
            <>
              <Save className="h-4 w-4" aria-hidden /> Create stack
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="inline-flex items-center gap-1.5 rounded-control bg-bg px-4 py-2 text-sm ring-1 ring-line/15"
        >
          <X className="h-4 w-4" aria-hidden /> Cancel
        </button>
      </div>
    </div>
  );
}
