"use client";

import { Save } from "lucide-react";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createLabPanel, type LabResultInput } from "@/app/actions/bloodwork";

export interface BiomarkerOption {
  name: string;
  defaultUnit: string;
  category: string;
}

interface Row {
  /** Stable client-side key (rows can be added/removed). */
  key: number;
  biomarkerName: string;
  value: string;
  unit: string;
  referenceLow: string;
  referenceHigh: string;
}

function todayLocal(): string {
  const n = new Date();
  const off = n.getTimezoneOffset();
  return new Date(n.getTime() - off * 60000).toISOString().slice(0, 10);
}

let nextKey = 1;
function blankRow(biomarkers: BiomarkerOption[]): Row {
  const first = biomarkers[0];
  return {
    key: nextKey++,
    biomarkerName: first?.name ?? "",
    value: "",
    unit: first?.defaultUnit ?? "",
    referenceLow: "",
    referenceHigh: "",
  };
}

export function LabPanelForm({ biomarkers }: { biomarkers: BiomarkerOption[] }) {
  const router = useRouter();
  const [collectedDate, setCollectedDate] = useState(todayLocal());
  const [labSource, setLabSource] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [blankRow(biomarkers)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const unitFor = (name: string) => biomarkers.find((b) => b.name === name)?.defaultUnit ?? "";

  function patchRow(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function onPickBiomarker(key: number, name: string) {
    // Auto-fill the unit from the biomarker's default when the picker changes.
    patchRow(key, { biomarkerName: name, unit: unitFor(name) });
  }

  function addRow() {
    setRows((rs) => [...rs, blankRow(biomarkers)]);
  }
  function removeRow(key: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  }

  async function onSubmit() {
    setBusy(true);
    setError(null);

    const results: LabResultInput[] = rows
      .filter((r) => r.biomarkerName.trim() && r.value.trim())
      .map((r) => ({
        biomarkerName: r.biomarkerName.trim(),
        value: r.value.trim(),
        unit: r.unit.trim() || undefined,
        referenceLow: r.referenceLow.trim() || undefined,
        referenceHigh: r.referenceHigh.trim() || undefined,
      }));

    if (results.length === 0) {
      setBusy(false);
      setError("Enter at least one biomarker value.");
      return;
    }

    const res = await createLabPanel({
      collectedDate,
      labSource: labSource.trim() || undefined,
      notes: notes.trim() || undefined,
      results,
    });

    setBusy(false);
    if (res.ok) {
      setDone(true);
      setLabSource("");
      setNotes("");
      setRows([blankRow(biomarkers)]);
      router.refresh();
    } else {
      setError(res.error ?? "Could not save the lab panel.");
    }
  }

  const inputCls = "rounded-control border border-line/15 bg-bg px-3 py-2 text-sm";

  return (
    <div className="space-y-3 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Collected date
          <input
            type="date"
            value={collectedDate}
            onChange={(e) => setCollectedDate(e.target.value)}
            className={`mt-1 w-full ${inputCls}`}
          />
        </label>
        <label className="block text-sm">
          Lab / source
          <input
            value={labSource}
            onChange={(e) => setLabSource(e.target.value)}
            placeholder="e.g. Sonic, i-screen"
            className={`mt-1 w-full ${inputCls}`}
          />
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Results</p>
        {rows.map((r) => (
          <div key={r.key} className="rounded-control bg-bg/40 p-2 ring-1 ring-line/10">
            <div className="flex flex-wrap items-end gap-2">
              <label className="block flex-1 text-xs text-muted">
                Biomarker
                <select
                  value={r.biomarkerName}
                  onChange={(e) => onPickBiomarker(r.key, e.target.value)}
                  className={`mt-1 w-full ${inputCls}`}
                >
                  {biomarkers.map((b) => (
                    <option key={b.name} value={b.name}>{b.name}</option>
                  ))}
                </select>
              </label>
              <label className="block w-24 text-xs text-muted">
                Value
                <input
                  inputMode="text"
                  value={r.value}
                  onChange={(e) => patchRow(r.key, { value: e.target.value })}
                  placeholder="e.g. 5.2"
                  className={`mt-1 w-full tabular-nums ${inputCls}`}
                  aria-label="Result value"
                />
              </label>
              <label className="block w-24 text-xs text-muted">
                Unit
                <input
                  value={r.unit}
                  onChange={(e) => patchRow(r.key, { unit: e.target.value })}
                  className={`mt-1 w-full ${inputCls}`}
                  aria-label="Unit"
                />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="block w-24 text-xs text-muted">
                Ref. low
                <input
                  inputMode="decimal"
                  value={r.referenceLow}
                  onChange={(e) => patchRow(r.key, { referenceLow: e.target.value })}
                  className={`mt-1 w-full tabular-nums ${inputCls}`}
                  aria-label="Reference low"
                />
              </label>
              <label className="block w-24 text-xs text-muted">
                Ref. high
                <input
                  inputMode="decimal"
                  value={r.referenceHigh}
                  onChange={(e) => patchRow(r.key, { referenceHigh: e.target.value })}
                  className={`mt-1 w-full tabular-nums ${inputCls}`}
                  aria-label="Reference high"
                />
              </label>
              <button
                type="button"
                onClick={() => removeRow(r.key)}
                disabled={rows.length === 1}
                className="ml-auto rounded-control px-2 py-2 text-xs font-medium text-muted hover:text-danger disabled:opacity-30"
                aria-label="Remove result"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          className="rounded-control border border-line/15 px-3 py-2 text-sm font-medium text-accentStrong hover:bg-bg/40"
        >
          + Add result
        </button>
      </div>

      <label className="block text-sm">
        Notes
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional, encrypted"
          className={`mt-1 w-full ${inputCls}`}
        />
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}
      {done && <p className="rounded-control bg-ok/10 px-3 py-2 text-sm font-medium text-ok">Lab panel saved ✓</p>}

      <button
        type="button"
        onClick={onSubmit}
        disabled={busy}
        className="w-full rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40"
      >
        <Save className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />{busy ? "Saving…" : "Save lab panel"}
      </button>
    </div>
  );
}
