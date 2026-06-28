"use client";

import { Pill } from "lucide-react";

import { useState } from "react";
import Decimal from "decimal.js";
import type { DoseUnit } from "@/lib/dosing/types";
import { logDose } from "@/app/actions/doses";
import { enqueue } from "@/lib/offline/outbox";
import { RebasePrompt } from "./RebasePrompt";

interface Props {
  protocolId?: string;
  peptideId: string;
  peptideName: string;
  /** Prefill the "time taken" — used when logging for a day other than today. */
  defaultTakenAtISO?: string;
  initialDoseValue: string;
  initialDoseUnit: DoseUnit;
}

/** Oral doses are mass-only — no volume/needle units, no syringe, no site. */
const ORAL_UNITS: DoseUnit[] = ["mcg", "mg"];

function toLocalInput(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/**
 * Simplified log form for an ORAL / non-injection medication: dose amount + unit
 * (mcg/mg), date/time, notes. No preparation picker, no syringe, no body-map, no
 * reconstitution — those are injection-only. Posts to the same `logDose` server
 * action with `route: "oral"` (which skips computeDraw + the vial decrement) and
 * the same offline-outbox fallback + planned-dose linking the injection form uses.
 */
export function OralLogForm({ protocolId, peptideId, peptideName, defaultTakenAtISO, initialDoseValue, initialDoseUnit }: Props) {
  const [doseValue, setDoseValue] = useState(initialDoseValue);
  const [doseUnit, setDoseUnit] = useState<DoseUnit>(ORAL_UNITS.includes(initialDoseUnit) ? initialDoseUnit : "mg");
  const [notes, setNotes] = useState("");
  const [takenAt, setTakenAt] = useState(toLocalInput(defaultTakenAtISO ? new Date(defaultTakenAtISO) : new Date()));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rebase, setRebase] = useState<{ protocolId: string; plannedDateISO: string; actualDateISO: string; suggestedDays: string[] } | undefined>();

  const valid = doseValue !== "" && (() => { try { return new Decimal(doseValue).gt(0); } catch { return false; } })();

  async function onConfirm() {
    setBusy(true);
    setError(null);

    const uuid = crypto.randomUUID();
    const input = {
      protocolId,
      route: "oral" as const,
      peptideId,
      doseValue,
      doseUnit,
      notes: notes || undefined,
      takenAtISO: new Date(takenAt).toISOString(),
      clientUuid: uuid,
    };

    let res: Awaited<ReturnType<typeof logDose>>;
    try {
      res = await logDose(input);
    } catch {
      // Network failure or offline — enqueue for replay when reconnected.
      await enqueue({ ...input, clientUuid: uuid });
      setBusy(false);
      setDone(true); // optimistic: show success; the outbox will sync on reconnect
      return;
    }

    setBusy(false);
    if (res.ok) { setDone(true); if (res.rebase) setRebase(res.rebase); }
    else setError(res.error ?? "Could not log dose");
  }

  if (done) {
    return (
      <div className="space-y-2">
        <p className="rounded-control bg-ok/10 px-3 py-2 text-sm font-medium text-ok">Logged ✓ {peptideName}</p>
        {rebase && <RebasePrompt rebase={rebase} />}
      </div>
    );
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
        onClick={onConfirm}
        disabled={busy || !valid}
        className="w-full rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40"
      >
        <Pill className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />{busy ? "Logging…" : `Confirm & log ${peptideName}`}
      </button>
    </div>
  );
}
