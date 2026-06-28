"use client";

import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import { computeConcentrationMcgPerMl, computeDraw, dosesPerVial } from "@/lib/dosing/engine";
import type { DoseUnit } from "@/lib/dosing/types";

const input = "w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm tabular-nums text-ink";

// A neutral U-100 reference syringe for the "syringe units" readout. The
// calculator is a reference tool, not a logging path — the user's real syringes
// live in Settings and are used when actually preparing/logging a dose.
const REF_SYRINGE = {
  name: "U-100 (reference)",
  graduationType: "units" as const,
  unitsPerMl: 100,
  capacityMl: "1",
  capacityUnits: 100,
  increment: "1",
};

/** Parse "2 mL = ~1.67 mg/mL" style hints into the two numbers, best-effort. */
function parseRatio(ratio: string | null | undefined): { bacWaterMl?: string } {
  if (!ratio) return {};
  const ml = ratio.match(/([\d.]+)\s*mL/i);
  return ml ? { bacWaterMl: ml[1] } : {};
}

interface Props {
  peptideName: string;
  /** Default vial strength (mg) — e.g. from the library entry / source. */
  defaultVialMg?: string;
  /** Reconstitution ratio hint, e.g. "2 mL = ~10.0 mg/mL". */
  reconstitutionRatio?: string | null;
  /** Default target dose + unit (e.g. a template's headline figure). */
  defaultDose?: string;
  defaultDoseUnit?: DoseUnit;
}

/**
 * Reference dose / reconstitution calculator. Reuses the dosing engine
 * (computeConcentrationMcgPerMl / computeDraw / dosesPerVial) — no new maths.
 * Pure client-side: nothing is saved. Reference only, not medical advice.
 */
export function EnrichmentCalculator({ peptideName, defaultVialMg, reconstitutionRatio, defaultDose, defaultDoseUnit }: Props) {
  const ratio = parseRatio(reconstitutionRatio);
  const [vialMg, setVialMg] = useState(defaultVialMg ?? "5");
  const [bacMl, setBacMl] = useState(ratio.bacWaterMl ?? "2");
  const [dose, setDose] = useState(defaultDose ?? "");
  const [doseUnit, setDoseUnit] = useState<DoseUnit>(defaultDoseUnit ?? "mcg");

  const concentration = useMemo<Decimal | null>(() => {
    try {
      if (!vialMg || !bacMl) return null;
      return computeConcentrationMcgPerMl({ totalMassMg: vialMg, bacWaterMl: bacMl });
    } catch {
      return null;
    }
  }, [vialMg, bacMl]);

  const draw = useMemo(() => {
    if (!concentration || !dose) return null;
    try {
      return computeDraw({
        dose: { value: dose, unit: doseUnit },
        preparation: { prepType: "reconstituted", concentrationMcgPerMl: concentration },
        syringe: { ...REF_SYRINGE },
      });
    } catch {
      return null;
    }
  }, [concentration, dose, doseUnit]);

  const dosesInVial = useMemo<number | null>(() => {
    if (!draw || !bacMl || draw.targetVolumeMl.lte(0)) return null;
    try {
      return dosesPerVial({ totalVolumeMl: bacMl, doseVolumeMl: draw.targetVolumeMl }).toNumber();
    } catch {
      return null;
    }
  }, [draw, bacMl]);

  return (
    <div className="space-y-3 rounded-control bg-bg p-3 ring-1 ring-line/15">
      <p className="text-xs font-medium text-muted">Dose calculator — {peptideName}</p>

      <div className="flex gap-2">
        <label className="block flex-1 text-xs text-muted">Vial strength
          <div className="mt-1 flex items-center gap-1">
            <input className={input} inputMode="decimal" value={vialMg} onChange={(e) => setVialMg(e.target.value)} aria-label="Vial strength mg" />
            <span className="text-xs text-muted">mg</span>
          </div>
        </label>
        <label className="block flex-1 text-xs text-muted">BAC water
          <div className="mt-1 flex items-center gap-1">
            <input className={input} inputMode="decimal" value={bacMl} onChange={(e) => setBacMl(e.target.value)} aria-label="BAC water mL" />
            <span className="text-xs text-muted">mL</span>
          </div>
        </label>
      </div>

      <div className="rounded-control bg-accent/10 p-3 text-center">
        <p className="text-[11px] font-medium text-accentStrong">Concentration</p>
        <p className="text-2xl font-semibold tabular-nums text-accentStrong">
          {concentration ? concentration.div(1000).toDecimalPlaces(2).toString() : "—"}
          <span className="text-sm"> mg/mL</span>
        </p>
      </div>

      <div className="flex gap-2">
        <label className="block flex-1 text-xs text-muted">Target dose
          <input className={input + " mt-1"} inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 250" aria-label="Target dose" />
        </label>
        <label className="block w-24 text-xs text-muted">Unit
          <select className={input + " mt-1"} value={doseUnit} onChange={(e) => setDoseUnit(e.target.value as DoseUnit)} aria-label="Dose unit">
            {(["mcg", "mg", "ml", "units"] as DoseUnit[]).map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
      </div>

      {draw && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-control bg-surface p-2 ring-1 ring-line/10">
            <p className="text-[11px] text-muted">Draw</p>
            <p className="text-sm font-medium tabular-nums">{draw.targetVolumeMl.toDecimalPlaces(3).toString()} mL</p>
          </div>
          <div className="rounded-control bg-surface p-2 ring-1 ring-line/10">
            <p className="text-[11px] text-muted">Syringe units</p>
            <p className="text-sm font-medium tabular-nums">{draw.markingValue.toString()} u</p>
          </div>
          <div className="rounded-control bg-surface p-2 ring-1 ring-line/10">
            <p className="text-[11px] text-muted">Doses / vial</p>
            <p className="text-sm font-medium tabular-nums">{dosesInVial != null ? `~${dosesInVial}` : "—"}</p>
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted">Syringe units shown on a U-100 reference barrel. Reference only — not medical advice.</p>
    </div>
  );
}
