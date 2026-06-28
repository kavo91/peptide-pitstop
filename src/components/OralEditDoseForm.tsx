"use client";

import { Save } from "lucide-react";

import { useState } from "react";
import Decimal from "decimal.js";
import type { DoseUnit } from "@/lib/dosing/types";
import { editDoseLog } from "@/app/actions/doses";

interface Props {
  dose: {
    id: string;
    /** The recorded mass in its input unit (mg = mcg/1000) — prefilled. */
    amount: string;
    doseInputUnit: DoseUnit;
    /** datetime-local value "yyyy-MM-ddTHH:mm" for the takenAt prefill. */
    takenAtLocal: string;
    notes: string;
  };
  peptideName: string;
}

/** Oral doses are mass-only — no volume/needle units. */
const ORAL_UNITS: DoseUnit[] = ["mcg", "mg"];

/**
 * Edit an ORAL dose: amount (mcg/mg) + time + notes. No preparation, no syringe,
 * no body-site, no volume/needle maths. Submits to the same `editDoseLog` server
 * action, which branches on the dose having no preparation.
 */
export function OralEditDoseForm({ dose, peptideName }: Props) {
  const [doseValue, setDoseValue] = useState(dose.amount);
  const [doseUnit, setDoseUnit] = useState<DoseUnit>(
    ORAL_UNITS.includes(dose.doseInputUnit) ? dose.doseInputUnit : "mg",
  );
  const [takenAt, setTakenAt] = useState(dose.takenAtLocal);
  const [notes, setNotes] = useState(dose.notes);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const when = new Date(takenAt);
    if (Number.isNaN(when.getTime())) {
      setError("Enter a valid date and time.");
      return;
    }
    if (!doseValue || new Decimal(doseValue || 0).lte(0)) {
      setError("Enter a dose greater than zero.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await editDoseLog({
      id: dose.id,
      doseValue,
      doseUnit,
      takenAtISO: when.toISOString(),
      notes: notes || null,
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      window.location.href = "/";
    } else {
      setError(res.error ?? "Could not save the edit.");
    }
  }

  if (done) {
    return <p className="rounded-control bg-ok/10 px-3 py-2 text-sm font-medium text-ok">Saved ✓ {peptideName}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          inputMode="decimal"
          value={doseValue}
          onChange={(e) => setDoseValue(e.target.value)}
          className="w-28 rounded-control border border-line/15 bg-bg px-3 py-2 tabular-nums"
          aria-label="Dose amount"
        />
        <select
          value={doseUnit}
          onChange={(e) => setDoseUnit(e.target.value as DoseUnit)}
          className="rounded-control border border-line/15 bg-bg px-3 py-2"
          aria-label="Dose unit"
        >
          {ORAL_UNITS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>

      <label className="block text-sm text-muted">
        Time taken
        <input type="datetime-local" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-ink" />
      </label>

      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional, encrypted)" className="w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm" />

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="w-full rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40"
      >
        <Save className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />{busy ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}
