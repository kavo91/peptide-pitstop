"use client";

import { ChevronLeft, ArrowRight, FlaskConical } from "lucide-react";

import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import { computeConcentrationMcgPerMl, computeDraw } from "@/lib/dosing/engine";
import type { DoseUnit } from "@/lib/dosing/types";
import { createPreparation } from "@/app/actions/reconstitution";
import { VisualSyringe } from "./VisualSyringe";

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
  vialId: string;
  peptideName: string;
  labelStrengthMg: string;
  /** Target dose for the review preview (from the protocol). */
  targetDose?: string;
  targetUnit?: DoseUnit;
  syringe?: SyringeDTO | null;
  beyondUseDays?: number;
}

type PrepType = "reconstituted" | "premixed";
const BAC_PRESETS = ["1", "2", "3", "5"];

export function ReconWizard({ vialId, peptideName, labelStrengthMg, targetDose, targetUnit, syringe, beyondUseDays = 28 }: Props) {
  const [step, setStep] = useState(1);
  const [prepType, setPrepType] = useState<PrepType>("reconstituted");
  const [totalMg, setTotalMg] = useState(labelStrengthMg);
  const [bacWaterMl, setBacWaterMl] = useState("2");
  const [premixConc, setPremixConc] = useState("");
  const [vialVolumeMl, setVialVolumeMl] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const concentration = useMemo<Decimal | null>(() => {
    try {
      if (prepType === "reconstituted") {
        if (!totalMg || !bacWaterMl) return null;
        return computeConcentrationMcgPerMl({ totalMassMg: totalMg, bacWaterMl });
      }
      return premixConc ? new Decimal(premixConc).times(1000) : null;
    } catch {
      return null;
    }
  }, [prepType, totalMg, bacWaterMl, premixConc]);

  const remainingMl = useMemo<Decimal | null>(() => {
    try {
      if (prepType === "reconstituted") return bacWaterMl ? new Decimal(bacWaterMl) : null;
      return vialVolumeMl ? new Decimal(vialVolumeMl) : null;
    } catch {
      return null;
    }
  }, [prepType, bacWaterMl, vialVolumeMl]);

  const preview = useMemo(() => {
    if (!concentration || !syringe || !targetDose || !targetUnit) return null;
    try {
      return computeDraw({
        dose: { value: targetDose, unit: targetUnit },
        preparation: { prepType, concentrationMcgPerMl: concentration },
        syringe: { ...syringe },
        remainingMl: remainingMl?.toString(),
      });
    } catch {
      return null;
    }
  }, [concentration, syringe, targetDose, targetUnit, prepType, remainingMl]);

  const dosesInVial = useMemo(() => {
    if (!remainingMl || !preview || preview.targetVolumeMl.lte(0)) return null;
    return remainingMl.div(preview.targetVolumeMl).floor().toNumber();
  }, [remainingMl, preview]);

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await createPreparation({
      vialId,
      prepType,
      totalMg: prepType === "reconstituted" ? totalMg : undefined,
      bacWaterMl: prepType === "reconstituted" ? bacWaterMl : undefined,
      concentrationMcgPerMl: prepType === "premixed" ? concentration?.toString() : undefined,
      vialVolumeMl: prepType === "premixed" ? vialVolumeMl : undefined,
      beyondUseDateISO: new Date(Date.now() + beyondUseDays * 86_400_000).toISOString(),
    });
    setBusy(false);
    if (res.ok) setDone(true);
    else setError(res.error ?? "Could not save preparation");
  }

  if (done) {
    return (
      <p className="rounded-control bg-ok/10 px-3 py-2 text-sm font-medium text-ok">
        Vial prepared ✓ — {concentration?.div(1000).toDecimalPlaces(2).toString()} mg/mL
      </p>
    );
  }

  return (
    <div>
      {/* progress */}
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          className={`text-muted ${step > 1 ? "visible" : "invisible"}`}
          aria-label="Back"
        >
          <ChevronLeft className="inline h-5 w-5 align-[-0.125em]" aria-hidden />
        </button>
        <div className="flex flex-1 gap-1.5">
          {[1, 2, 3].map((i) => (
            <span key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-line/15"}`} />
          ))}
        </div>
      </div>

      {/* Step 1 — vial type */}
      {step === 1 && (
        <div>
          <h3 className="text-lg font-medium">How does this vial come?</h3>
          <p className="mb-4 mt-1 text-sm text-muted">{peptideName} — choose how it's prepared.</p>
          {([
            { t: "reconstituted", title: "Dry powder", sub: "Add BAC water to mix", icon: "🧪" },
            { t: "premixed", title: "Premixed", sub: "Ready to use, known concentration", icon: "💧" },
          ] as { t: PrepType; title: string; sub: string; icon: string }[]).map((o) => (
            <button
              key={o.t}
              type="button"
              onClick={() => { setPrepType(o.t); setStep(2); }}
              className={`mb-2.5 flex w-full items-center gap-3 rounded-card bg-bg p-3.5 text-left ${prepType === o.t ? "ring-2 ring-accent" : "ring-1 ring-line/15"}`}
            >
              <span className="text-2xl" aria-hidden>{o.icon}</span>
              <span>
                <span className="block font-medium">{o.title}</span>
                <span className="block text-sm text-muted">{o.sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Step 2 — mix (reconstituted) or label details (premixed) */}
      {step === 2 && (
        <div>
          <h3 className="mb-4 text-lg font-medium">{prepType === "reconstituted" ? "Mix it up" : "What's in the vial"}</h3>

          {prepType === "reconstituted" ? (
            <>
              <label className="block text-sm text-muted">Powder in the vial</label>
              <div className="mb-4 mt-1 flex items-center gap-2">
                <input inputMode="decimal" value={totalMg} onChange={(e) => setTotalMg(e.target.value)} className="w-24 rounded-control border border-line/15 bg-bg px-3 py-2 text-center text-lg tabular-nums text-ink" aria-label="Vial strength mg" />
                <span className="text-muted">mg</span>
              </div>

              <label className="block text-sm text-muted">BAC water to add</label>
              <div className="mb-5 mt-1 flex flex-wrap gap-2">
                {BAC_PRESETS.map((v) => (
                  <button key={v} type="button" onClick={() => setBacWaterMl(v)} className={`rounded-control px-4 py-2 text-sm ${bacWaterMl === v ? "bg-accent text-onAccent" : "bg-bg ring-1 ring-line/15"}`}>{v} mL</button>
                ))}
                <input inputMode="decimal" value={bacWaterMl} onChange={(e) => setBacWaterMl(e.target.value)} className="w-20 rounded-control border border-line/15 bg-bg px-3 py-2 text-sm tabular-nums text-ink" aria-label="Custom BAC water mL" />
              </div>
            </>
          ) : (
            <>
              <p className="mb-4 text-sm text-muted">Copy these two numbers straight off the label.</p>
              <label className="block text-sm text-muted">Volume in the vial</label>
              <div className="mb-4 mt-1 flex items-center gap-2">
                <input inputMode="decimal" value={vialVolumeMl} onChange={(e) => setVialVolumeMl(e.target.value)} placeholder="e.g. 5" className="w-24 rounded-control border border-line/15 bg-bg px-3 py-2 text-center text-lg tabular-nums text-ink" aria-label="Vial volume mL" />
                <span className="text-muted">mL</span>
              </div>

              <label className="block text-sm text-muted">Concentration on the label</label>
              <div className="mb-5 mt-1 flex items-center gap-2">
                <input inputMode="decimal" value={premixConc} onChange={(e) => setPremixConc(e.target.value)} placeholder="e.g. 3" className="w-32 rounded-control border border-line/15 bg-bg px-3 py-2 text-center text-lg tabular-nums text-ink" aria-label="Concentration mg/mL" />
                <span className="text-muted">mg/mL</span>
              </div>
            </>
          )}

          <div className="rounded-card bg-accent/10 p-4 text-center">
            <p className="text-xs font-medium text-accentStrong">Concentration</p>
            <p className="text-3xl font-semibold tabular-nums text-accentStrong">
              {concentration ? `${concentration.div(1000).toDecimalPlaces(2).toString()}` : "—"}
              <span className="text-base"> mg/mL</span>
            </p>
          </div>
        </div>
      )}

      {/* Step 3 — review */}
      {step === 3 && (
        <div>
          <h3 className="mb-4 text-lg font-medium">Looks good?</h3>
          <div className="mb-3 grid grid-cols-2 gap-2.5">
            <div className="rounded-control bg-bg p-3"><p className="text-xs text-muted">Concentration</p><p className="text-lg font-medium tabular-nums">{concentration?.div(1000).toDecimalPlaces(2).toString()} <span className="text-xs">mg/mL</span></p></div>
            <div className="rounded-control bg-bg p-3"><p className="text-xs text-muted">Doses in vial</p><p className="text-lg font-medium tabular-nums">{dosesInVial != null ? `~${dosesInVial}` : "—"}</p></div>
          </div>

          {preview && (
            <div className="mb-2 rounded-card bg-bg p-3.5">
              <p className="mb-2 text-sm text-muted">Your {targetDose} {targetUnit} dose will be</p>
              <VisualSyringe
                capacityMl={Number(syringe!.capacityMl)}
                fillMl={preview.targetVolumeMl.toNumber()}
                markingLabel={preview.markingScale === "units" ? `${preview.markingValue.toString()} units` : `${preview.markingValue.toDecimalPlaces(2).toString()} mL`}
                overfill={preview.warnings.some((w) => w.severity === "block")}
              />
            </div>
          )}
          <p className="text-center text-xs text-muted">Use within {beyondUseDays} days · keep refrigerated</p>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
      )}

      {/* footer action */}
      {step < 3 ? (
        step === 2 && (
          <button type="button" onClick={() => setStep(3)} disabled={!concentration || !remainingMl} className="mt-5 w-full rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40">Continue <ArrowRight className="inline h-4 w-4 align-[-0.125em]" aria-hidden /></button>
        )
      ) : (
        <button type="button" onClick={confirm} disabled={busy || !concentration || !remainingMl} className="mt-5 w-full rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40">
          <FlaskConical className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />{busy ? "Saving…" : `Prepare ${peptideName}`}
        </button>
      )}
    </div>
  );
}
