"use client";

import { ChevronLeft, Save, Eye } from "lucide-react";

import { useEffect, useMemo, useState } from "react";
import Decimal from "decimal.js";
import { computeDraw } from "@/lib/dosing/engine";
import { reconcileDoseEditRemaining } from "@/lib/dosing/recompute";
import type { DoseUnit } from "@/lib/dosing/types";
import { isPump, type DeviceType } from "@/lib/device-type";
import { pumpsToMl, mlToPumps, formatPumps } from "@/lib/dosing/nasal";
import { editDoseLog } from "@/app/actions/doses";
import { trackingDayOf, deviceTimeZone, toDeviceDatetimeLocal } from "@/lib/local-day";
import { VisualSyringe } from "./VisualSyringe";

interface SyringeDTO {
  id: string;
  name: string;
  graduationType: "units" | "ml";
  deviceType: DeviceType;
  unitsPerMl: number;
  capacityMl: string;
  capacityUnits: number;
  increment: string;
}

/** The dose-amount unit shown in the form. "pumps" is UI-only — see the pumps→mL conversion below. */
type FormDoseUnit = DoseUnit | "pumps";
const INJECTION_UNITS: FormDoseUnit[] = ["mcg", "mg", "ml", "units"];
const PUMP_UNITS: FormDoseUnit[] = ["pumps", "mcg", "mg"];

interface Props {
  dose: {
    id: string;
    /** The amount originally entered, in its input unit — prefilled verbatim. */
    amount: string;
    doseInputUnit: DoseUnit;
    /** The current drawn volume on record (mL) — the old volume for reconciliation. */
    volumeMl: string;
    /** datetime-local value "yyyy-MM-ddTHH:mm" for the takenAt prefill (SERVER TZ — swapped for the device-zone rendering on mount). */
    takenAtLocal: string;
    /** ISO instant backing the prefill — the mount-time device-zone re-render source. */
    takenAtISO: string;
    injectionSite: string;
    notes: string;
  };
  /** Null for an ORAL dose — no preparation / volume / syringe to reconcile. */
  prep: {
    id: string;
    prepType: "reconstituted" | "premixed";
    concentrationMcgPerMl: string;
    remainingMl: string;
    fillCapMl: string;
  } | null;
  syringe: SyringeDTO | null;
  peptideName: string;
}

export function EditDoseForm({ dose, prep, syringe, peptideName }: Props) {
  const pumpDevice = syringe != null && isPump(syringe.deviceType);
  // A dose entered in pumps is persisted as `{ doseInputUnit: "ml", amount: <mL> }`
  // (see LogDoseForm). Show it back as pumps, the pump dropdown's only volume
  // unit, rather than a raw mL amount the pump unit list does not have.
  const initialIsPumpVolume = pumpDevice && dose.doseInputUnit === "ml";
  const [doseValue, setDoseValue] = useState(() =>
    initialIsPumpVolume && syringe ? mlToPumps(dose.amount, syringe.increment).toString() : dose.amount,
  );
  const [doseUnit, setDoseUnit] = useState<FormDoseUnit>(() => (initialIsPumpVolume ? "pumps" : dose.doseInputUnit));
  const [takenAt, setTakenAt] = useState(dose.takenAtLocal);
  // Only a TOUCHED time field is submitted: an untouched edit (site/notes only)
  // must keep the stored takenAt AND its frozen localDay/tz — re-sending the
  // server-TZ prefill would re-bucket a travel-day dose (see editDoseLog).
  const [takenAtTouched, setTakenAtTouched] = useState(false);
  // Swap the server-TZ prefill for the DEVICE-zone rendering of the same
  // instant on mount (post-hydration, so no SSR mismatch): the value is parsed
  // back with new Date() in the device zone on save, so display zone must
  // equal parse zone or a touched edit made abroad shifts the instant by the
  // zone offset and mis-stamps localDay.
  useEffect(() => {
    setTakenAt(toDeviceDatetimeLocal(new Date(dose.takenAtISO)));
  }, [dose.takenAtISO]);
  const [site, setSite] = useState(dose.injectionSite);
  const [notes, setNotes] = useState(dose.notes);

  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "pumps" is UI-only — computeDraw (and the server) only ever see a real
  // DoseUnit. Convert pumps × increment → mL before anything downstream sees it.
  const effectiveDose = useMemo(() => {
    if (!doseValue) return null;
    if (doseUnit === "pumps") {
      if (!syringe) return null;
      try {
        return { value: pumpsToMl(doseValue, syringe.increment).toString(), unit: "ml" as DoseUnit };
      } catch {
        return null;
      }
    }
    return { value: doseValue, unit: doseUnit };
  }, [doseValue, doseUnit, syringe]);

  const draw = useMemo(() => {
    if (!prep || !syringe || !effectiveDose) return null;
    try {
      if (new Decimal(effectiveDose.value).lte(0)) return null;
      return computeDraw({
        dose: effectiveDose,
        preparation: { prepType: prep.prepType, concentrationMcgPerMl: new Decimal(prep.concentrationMcgPerMl) },
        syringe: { ...syringe },
        remainingMl: prep.remainingMl,
      });
    } catch {
      return null;
    }
  }, [effectiveDose, prep, syringe]);

  const blocked = draw?.warnings.some((w) => w.severity === "block") ?? false;

  // Impact on the vial: add back the old draw, subtract the new draw.
  const impact = useMemo(() => {
    if (!prep || !draw) return null;
    return reconcileDoseEditRemaining({
      remainingMl: prep.remainingMl,
      oldVolumeMl: dose.volumeMl,
      newVolumeMl: draw.deliveredVolumeMl.toString(),
      fillCapMl: prep.fillCapMl,
    });
  }, [draw, prep, dose.volumeMl]);

  // Oral doses are edited via OralEditDoseForm (rendered by the page), so this
  // component only ever receives a non-null prep. Guard after the hooks so the
  // rules-of-hooks order is preserved and the injection JSX can assume prep.
  if (!prep) return null;

  const oldRemaining = new Decimal(prep.remainingMl);

  async function confirm() {
    if (!effectiveDose) {
      setError("Enter a valid dose amount.");
      return;
    }
    const when = new Date(takenAt);
    if (Number.isNaN(when.getTime())) {
      setError("Enter a valid date and time.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await editDoseLog({
      id: dose.id,
      doseValue: effectiveDose.value,
      doseUnit: effectiveDose.unit,
      // `when` parses the datetime-local string in the DEVICE zone, so the
      // stamp freezes the day the editor actually typed.
      ...(takenAtTouched
        ? { takenAtISO: when.toISOString(), localDay: trackingDayOf(when), tz: deviceTimeZone() ?? undefined }
        : {}),
      // A pump has no injection site.
      injectionSite: pumpDevice ? null : site || null,
      notes: notes || null,
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      window.location.href = "/";
    } else {
      setError(res.error ?? "Could not save the edit.");
      setReviewing(false);
    }
  }

  if (done) {
    return <p className="rounded-control bg-ok/10 px-3 py-2 text-sm font-medium text-ok">Saved ✓ {peptideName}</p>;
  }

  if (!syringe) {
    return <p className="text-sm text-muted">Original syringe missing — cannot edit this dose&rsquo;s amount.</p>;
  }

  if (reviewing && draw && impact) {
    return (
      <div>
        <h3 className="mb-4 text-lg font-medium">Review changes</h3>
        <div className="mb-3 space-y-2.5">
          <div className="rounded-control bg-bg p-3">
            <p className="text-xs text-muted">Delivers</p>
            <p className="text-lg font-medium tabular-nums">{draw.deliveredMassMcg.toDecimalPlaces(1).toString()} <span className="text-xs">mcg</span></p>
          </div>
          <div className="rounded-control bg-bg p-3">
            <p className="text-xs text-muted">Remaining in vial</p>
            <p className="text-lg font-medium tabular-nums">
              {oldRemaining.toDecimalPlaces(2).toString()} → {new Decimal(impact.remainingMl).toDecimalPlaces(2).toString()} <span className="text-xs">mL</span>
            </p>
          </div>
        </div>

        {impact.clamped && (
          <p className="mb-3 rounded-control bg-warn/10 px-3 py-2 text-sm text-warn">
            ⚠ Remaining was clamped to the vial&rsquo;s fill range.
          </p>
        )}
        {draw.warnings.map((w) => (
          <p key={w.code} className={`mb-2 rounded-control px-3 py-2 text-sm ${w.severity === "block" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn"}`}>
            {w.severity === "block" ? "⛔ " : "⚠ "}{w.message}
          </p>
        ))}
        {error && <p className="mb-2 text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={() => setReviewing(false)} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-bg px-4 py-3 font-medium text-ink ring-1 ring-line/15 disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden /> Back</button>
          <button type="button" onClick={confirm} disabled={busy || blocked} className="flex flex-1 items-center justify-center gap-2 rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40"><Save className="h-4 w-4" aria-hidden /> {busy ? "Saving…" : "Confirm & save"}</button>
        </div>
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
          onChange={(e) => setDoseUnit(e.target.value as FormDoseUnit)}
          className="rounded-control border border-line/15 bg-bg px-3 py-2"
          aria-label="Dose unit"
        >
          {(pumpDevice ? PUMP_UNITS : INJECTION_UNITS).map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>

      <p className="text-xs text-muted">
        Concentration {new Decimal(prep.concentrationMcgPerMl).div(1000).toDecimalPlaces(2).toString()} mg/mL · {new Decimal(prep.remainingMl).toDecimalPlaces(2).toString()} mL left in vial · {syringe.name}
      </p>

      {draw && (
        <>
          <VisualSyringe
            device={syringe.deviceType}
            capacityMl={Number(syringe.capacityMl)}
            fillMl={draw.targetVolumeMl.toNumber()}
            markingLabel={
              draw.markingScale === "units"
                ? `${draw.markingValue.toString()} units`
                : pumpDevice
                  ? `${formatPumps(mlToPumps(draw.markingValue, syringe.increment))} (${draw.markingValue.toDecimalPlaces(2).toString()} mL)`
                  : `${draw.markingValue.toDecimalPlaces(2).toString()} mL`
            }
            overfill={blocked}
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
        <input type="datetime-local" value={takenAt} onChange={(e) => { setTakenAt(e.target.value); setTakenAtTouched(true); }} className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-ink" />
      </label>

      {!pumpDevice && (
        <label className="block text-sm text-muted">
          Injection site
          <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="e.g. left abdomen" className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-ink" />
        </label>
      )}

      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional, encrypted)" className="w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm" />

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="button"
        onClick={() => { setError(null); setReviewing(true); }}
        disabled={blocked || !draw}
        className="w-full rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40"
      >
        <Eye className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />Review changes
      </button>
    </div>
  );
}
