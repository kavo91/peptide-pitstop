"use client";

/**
 * Inline prescription link on an inventory vial. Pick an existing prescription
 * for this vial's peptide, or create one on the spot (prescriber / pharmacy /
 * dose instructions) and link it — so a stack's compounding-pharmacy script can
 * be recorded per vial without leaving Inventory.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, X } from "lucide-react";
import { linkVialPrescription } from "@/app/actions/vials";

const field = "rounded-control border border-line/15 bg-bg px-2.5 py-1.5 text-sm text-ink";

interface PrescriptionOpt {
  id: string;
  name: string;
}

export function VialPrescription({
  vialId,
  options,
  current,
}: {
  vialId: string;
  options: PrescriptionOpt[]; // prescriptions for THIS vial's peptide
  current: { id: string; label: string } | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pick, setPick] = useState(current?.id ?? "");
  const [form, setForm] = useState({ source: "", prescriber: "", pharmacy: "", doseInstructions: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(args: Parameters<typeof linkVialPrescription>[0]) {
    setBusy(true);
    setError(null);
    const res = await linkVialPrescription(args);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setEditing(false);
    setCreating(false);
    router.refresh();
  }

  // Collapsed state: show the linked Rx (or an "Add prescription" affordance).
  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <FileText className="h-3.5 w-3.5 text-muted" aria-hidden />
        {current ? (
          <>
            <span className="text-muted">Rx: <span className="text-ink">{current.label}</span></span>
            <button type="button" onClick={() => setEditing(true)} className="font-medium text-accentStrong">Change</button>
          </>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="font-medium text-accentStrong">+ Add prescription</button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-control bg-bg p-2.5 text-xs ring-1 ring-line/10">
      {!creating ? (
        <>
          <div className="flex items-center gap-2">
            <select className={`${field} min-w-0 flex-1`} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Prescription">
              <option value="">No prescription</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => run({ vialId, prescriptionId: pick })}
              disabled={busy}
              className="shrink-0 rounded-control bg-accent px-2.5 py-1.5 font-medium text-onAccent disabled:opacity-40"
            >
              {busy ? "…" : "Save"}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 font-medium text-accentStrong">
              <Plus className="h-3.5 w-3.5" aria-hidden /> New prescription
            </button>
            <button type="button" onClick={() => { setEditing(false); setError(null); }} className="inline-flex items-center gap-1 text-muted">
              <X className="h-3.5 w-3.5" aria-hidden /> Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="font-medium">New prescription</p>
          <input className={`${field} w-full`} placeholder="Source (e.g. Compounding pharmacy)" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
          <input className={`${field} w-full`} placeholder="Prescriber" value={form.prescriber} onChange={(e) => setForm({ ...form, prescriber: e.target.value })} />
          <input className={`${field} w-full`} placeholder="Pharmacy" value={form.pharmacy} onChange={(e) => setForm({ ...form, pharmacy: e.target.value })} />
          <input className={`${field} w-full`} placeholder="Dose instructions (e.g. 0.2 ml/day)" value={form.doseInstructions} onChange={(e) => setForm({ ...form, doseInstructions: e.target.value })} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => run({ vialId, create: form })}
              disabled={busy}
              className="flex-1 rounded-control bg-accent px-2.5 py-1.5 font-medium text-onAccent disabled:opacity-40"
            >
              {busy ? "…" : "Create & link"}
            </button>
            <button type="button" onClick={() => setCreating(false)} className="rounded-control bg-surface px-2.5 py-1.5 ring-1 ring-line/15">Back</button>
          </div>
        </>
      )}
      {error && <p className="text-danger">{error}</p>}
    </div>
  );
}
