"use client";

import { Syringe } from "lucide-react";

import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import { computeDraw } from "@/lib/dosing/engine";
import { doseUnitBreakdown } from "@/lib/dosing/unit-breakdown";
import type { DoseUnit } from "@/lib/dosing/types";
import { logDose } from "@/app/actions/doses";
import { enqueue } from "@/lib/offline/outbox";
import { VisualSyringe } from "./VisualSyringe";
import { RebasePrompt } from "./RebasePrompt";
import { assessTiming } from "@/lib/halflife";
import { suggestNextSite } from "@/lib/sites";
import { BodyMap } from "./BodyMap";

interface SyringeDTO {
  id: string;
  name: string;
  graduationType: "units" | "ml";
  unitsPerMl: number;
  capacityMl: string;
  capacityUnits: number;
  increment: string;
}

interface Props {
  protocolId?: string;
  peptideName: string;
  preparation: { id: string; concentrationMcgPerMl: string; remainingMl: string };
  syringes: SyringeDTO[];
  defaultSyringeId?: string;
  /** Prefill the "time taken" — used when logging for a day other than today. */
  defaultTakenAtISO?: string;
  initialDoseValue: string;
  initialDoseUnit: DoseUnit;
  /** Hours since the most recent dose for this peptide. null = no prior dose. */
  hoursSinceLast?: number | null;
  /** Peptide.halfLifeHours as a number, or null when unset. */
  halfLifeHours?: number | null;
  /** Peptide.minIntervalHours as a number, or null when unset. */
  minIntervalHours?: number | null;
  /** Raw recent-site codes, most-recent-first, for the BodyMap component. */
  recentSites: string[];
}

const UNITS: DoseUnit[] = ["mcg", "mg", "ml", "units"];

function toLocalInput(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function LogDoseForm({ protocolId, peptideName, preparation, syringes, defaultSyringeId, defaultTakenAtISO, initialDoseValue, initialDoseUnit, hoursSinceLast, halfLifeHours, minIntervalHours, recentSites }: Props) {
  const [doseValue, setDoseValue] = useState(initialDoseValue);
  const [doseUnit, setDoseUnit] = useState<DoseUnit>(initialDoseUnit);
  const [syringeId, setSyringeId] = useState(defaultSyringeId ?? syringes[0]?.id ?? "");
  const [site, setSite] = useState(() => suggestNextSite(recentSites));
  const [notes, setNotes] = useState("");
  const [takenAt, setTakenAt] = useState(toLocalInput(defaultTakenAtISO ? new Date(defaultTakenAtISO) : new Date()));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rebase, setRebase] = useState<{ protocolId: string; plannedDateISO: string; actualDateISO: string; suggestedDays: string[] } | undefined>();

  const timing =
    hoursSinceLast != null
      ? assessTiming({
          halfLifeHours: halfLifeHours ?? null,
          minIntervalHours: minIntervalHours ?? null,
          hoursSinceLast,
        })
      : null;

  const syringe = syringes.find((s) => s.id === syringeId) ?? syringes[0];

  const draw = useMemo(() => {
    if (!syringe || !doseValue || new Decimal(doseValue || 0).lte(0)) return null;
    try {
      return computeDraw({
        dose: { value: doseValue, unit: doseUnit },
        preparation: { prepType: "premixed", concentrationMcgPerMl: new Decimal(preparation.concentrationMcgPerMl) },
        syringe: { ...syringe },
        remainingMl: preparation.remainingMl,
      });
    } catch {
      return null;
    }
  }, [doseValue, doseUnit, preparation, syringe]);

  const blocked = draw?.warnings.some((w) => w.severity === "block") ?? false;

  // Four-unit breakdown of the TARGET dose. Recomputed with the draw, so it
  // tracks the selected syringe (units = rawUnits = volume × unitsPerMl).
  const multiUnit = useMemo(
    () => (draw && syringe ? doseUnitBreakdown(draw, { ...syringe }) : undefined),
    [draw, syringe],
  );

  async function onConfirm() {
    if (!syringe) return;
    setBusy(true);
    setError(null);

    const uuid = crypto.randomUUID();
    const input = {
      protocolId,
      preparationId: preparation.id,
      syringeId: syringe.id,
      doseValue,
      doseUnit,
      injectionSite: site || undefined,
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

  if (!syringe) {
    return <p className="text-sm text-muted">No syringe yet — add one in Settings.</p>;
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
          {UNITS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>

      <label className="block text-sm text-muted">
        Syringe
        <select value={syringeId} onChange={(e) => setSyringeId(e.target.value)} className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-ink" aria-label="Syringe">
          {syringes.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>

      <p className="text-xs text-muted">
        Concentration {new Decimal(preparation.concentrationMcgPerMl).div(1000).toDecimalPlaces(2).toString()} mg/mL · {new Decimal(preparation.remainingMl).toDecimalPlaces(2).toString()} mL left in vial
      </p>

      {draw && (
        <>
          <VisualSyringe
            capacityMl={Number(syringe.capacityMl)}
            fillMl={draw.targetVolumeMl.toNumber()}
            markingLabel={
              draw.markingScale === "units"
                ? `${draw.markingValue.toString()} units`
                : `${draw.markingValue.toDecimalPlaces(2).toString()} mL`
            }
            overfill={blocked}
            multiUnit={multiUnit}
          />
          <dl className="grid grid-cols-3 gap-2 text-center text-sm">
            <div><dt className="text-xs text-muted">Volume</dt><dd className="tabular-nums">{draw.targetVolumeMl.toDecimalPlaces(3).toString()} mL</dd></div>
            <div><dt className="text-xs text-muted">Delivers</dt><dd className="tabular-nums">{draw.deliveredMassMcg.toDecimalPlaces(1).toString()} mcg</dd></div>
            <div><dt className="text-xs text-muted">Rounding</dt><dd className="tabular-nums">{draw.roundingErrorMcg.toDecimalPlaces(1).toString()} mcg</dd></div>
          </dl>

          {draw.warnings.map((w) => (
            <p key={w.code} className={`rounded-control px-3 py-2 text-sm ${w.severity === "block" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn"}`}>
              {w.severity === "block" ? "⛔ " : "⚠ "}{w.message}
            </p>
          ))}
        </>
      )}

      <label className="block text-sm text-muted">
        Time taken
        <input type="datetime-local" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-ink" />
      </label>
      <div className="space-y-1">
        <p className="text-sm text-muted">Injection site</p>
        <BodyMap
          value={site || null}
          onChange={setSite}
          recentSites={recentSites}
        />
      </div>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional, encrypted)" className="w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm" />

      {error && <p className="text-sm text-danger">{error}</p>}

      {timing && timing.message && (
        <p className={`rounded-control px-3 py-2 text-sm ${timing.tooSoon ? "bg-warn/10 text-warn" : "bg-surface text-muted"}`}>
          {timing.tooSoon ? "⚠ " : ""}{timing.message}
        </p>
      )}

      <button
        type="button"
        onClick={onConfirm}
        disabled={busy || blocked || !draw}
        className="w-full rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40"
      >
        <Syringe className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />{busy ? "Logging…" : `Confirm & log ${peptideName}`}
      </button>
    </div>
  );
}
