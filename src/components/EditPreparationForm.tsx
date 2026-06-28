"use client";

import { ChevronLeft, Save } from "lucide-react";

import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import { computeConcentrationMcgPerMl } from "@/lib/dosing/engine";
import { recomputeReconEdit } from "@/lib/dosing/recompute";
import { editPreparation } from "@/app/actions/reconstitution";

type PrepType = "reconstituted" | "premixed";

interface Props {
  prep: {
    id: string;
    prepType: PrepType;
    /** BAC water (mL) for reconstituted, else null/empty. */
    bacWaterMl: string | null;
    /** Vial strength snapshot (mg). */
    totalMg: string;
    concentrationMcgPerMl: string;
    /** Current remaining in the vial (mL). */
    remainingMl: string;
    /** Beyond-use date as a yyyy-mm-dd string (date input), or empty. */
    beyondUseDate: string;
    /** Decrypted notes for prefill, or empty. */
    notes: string;
  };
  /** Immovable physical draw volumes for every logged dose on this prep. */
  doseVolumesMl: string[];
  doseCount: number;
}

const BAC_PRESETS = ["1", "2", "3", "5"];

export function EditPreparationForm({ prep, doseVolumesMl, doseCount }: Props) {
  const [prepType, setPrepType] = useState<PrepType>(prep.prepType);
  const [totalMg, setTotalMg] = useState(prep.totalMg);
  const [bacWaterMl, setBacWaterMl] = useState(prep.bacWaterMl ?? "");
  // Stored concentration is mcg/mL; the premix input is mg/mL → seed it ÷1000
  // so an unchanged save round-trips with no 1000× drift.
  const [premixConc, setPremixConc] = useState(
    prepType === "premixed" ? new Decimal(prep.concentrationMcgPerMl).div(1000).toString() : "",
  );
  // Premixed vial volume = mass(mg)*1000 / conc, derived from the snapshot.
  const [vialVolumeMl, setVialVolumeMl] = useState(() => {
    if (prep.prepType !== "premixed") return "";
    try {
      const conc = new Decimal(prep.concentrationMcgPerMl);
      return conc.gt(0) ? new Decimal(prep.totalMg).times(1000).div(conc).toString() : "";
    } catch {
      return "";
    }
  });
  const [beyondUseDate, setBeyondUseDate] = useState(prep.beyondUseDate);
  const [notes, setNotes] = useState(prep.notes);

  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const concentration = useMemo<Decimal | null>(() => {
    try {
      if (prepType === "reconstituted") {
        if (!totalMg || !bacWaterMl) return null;
        return computeConcentrationMcgPerMl({ totalMassMg: totalMg, bacWaterMl });
      }
      return premixConc && new Decimal(premixConc).gt(0) ? new Decimal(premixConc).times(1000) : null;
    } catch {
      return null;
    }
  }, [prepType, totalMg, bacWaterMl, premixConc]);

  const newTotalMl = useMemo<Decimal | null>(() => {
    try {
      if (prepType === "reconstituted") return bacWaterMl ? new Decimal(bacWaterMl) : null;
      return vialVolumeMl && new Decimal(vialVolumeMl).gt(0) ? new Decimal(vialVolumeMl) : null;
    } catch {
      return null;
    }
  }, [prepType, bacWaterMl, vialVolumeMl]);

  const impact = useMemo(() => {
    if (!concentration || !newTotalMl) return null;
    return recomputeReconEdit({
      newConcentrationMcgPerMl: concentration.toString(),
      newTotalMl: newTotalMl.toString(),
      doses: doseVolumesMl.map((v, i) => ({ id: String(i), volumeMl: v })),
    });
  }, [concentration, newTotalMl, doseVolumesMl]);

  const oldConc = new Decimal(prep.concentrationMcgPerMl);
  const oldRemaining = new Decimal(prep.remainingMl);

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await editPreparation({
      prepId: prep.id,
      prepType,
      totalMg: prepType === "reconstituted" ? totalMg : undefined,
      bacWaterMl: prepType === "reconstituted" ? bacWaterMl : undefined,
      concentrationMcgPerMl: prepType === "premixed" ? concentration?.toString() : undefined,
      vialVolumeMl: prepType === "premixed" ? vialVolumeMl : undefined,
      beyondUseDateISO: beyondUseDate ? new Date(beyondUseDate + "T00:00:00").toISOString() : null,
      notes: notes || null,
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      window.location.href = "/inventory";
    } else {
      setError(res.error ?? "Could not save the edit.");
      setReviewing(false);
    }
  }

  if (done) {
    return (
      <p className="rounded-control bg-ok/10 px-3 py-2 text-sm font-medium text-ok">
        Saved ✓ — {concentration?.div(1000).toDecimalPlaces(2).toString()} mg/mL
      </p>
    );
  }

  if (reviewing && impact) {
    return (
      <div>
        <h3 className="mb-4 text-lg font-medium">Review changes</h3>
        <div className="mb-3 space-y-2.5">
          <div className="rounded-control bg-bg p-3">
            <p className="text-xs text-muted">Concentration</p>
            <p className="text-lg font-medium tabular-nums">
              {oldConc.div(1000).toDecimalPlaces(2).toString()} → {concentration!.div(1000).toDecimalPlaces(2).toString()} <span className="text-xs">mg/mL</span>
            </p>
          </div>
          <div className="rounded-control bg-bg p-3">
            <p className="text-xs text-muted">Remaining in vial</p>
            <p className="text-lg font-medium tabular-nums">
              {oldRemaining.toDecimalPlaces(2).toString()} → {new Decimal(impact.remainingMl).toDecimalPlaces(2).toString()} <span className="text-xs">mL</span>
            </p>
          </div>
          <div className="rounded-control bg-bg p-3">
            <p className="text-xs text-muted">Logged doses</p>
            <p className="text-lg font-medium tabular-nums">{doseCount} dose{doseCount === 1 ? "" : "s"} recompute</p>
          </div>
        </div>

        {impact.remainingClamped && (
          <p className="mb-3 rounded-control bg-warn/10 px-3 py-2 text-sm text-warn">
            ⚠ The recorded draws exceed this corrected fill — remaining is clamped to 0 mL.
          </p>
        )}
        {error && <p className="mb-2 text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={() => setReviewing(false)} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-bg px-4 py-3 font-medium text-ink ring-1 ring-line/15 disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden /> Back</button>
          <button type="button" onClick={confirm} disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40"><Save className="h-4 w-4" aria-hidden /> {busy ? "Saving…" : "Confirm & save"}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-4 text-lg font-medium">Edit reconstitution</h3>

      <div className="mb-4 flex gap-2">
        {([
          { t: "reconstituted", label: "Dry powder" },
          { t: "premixed", label: "Premixed" },
        ] as { t: PrepType; label: string }[]).map((o) => (
          <button
            key={o.t}
            type="button"
            onClick={() => setPrepType(o.t)}
            className={`flex-1 rounded-control px-3 py-2 text-sm ${prepType === o.t ? "bg-accent text-onAccent" : "bg-bg ring-1 ring-line/15"}`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {prepType === "reconstituted" ? (
        <>
          <label className="block text-sm text-muted">Powder in the vial</label>
          <div className="mb-4 mt-1 flex items-center gap-2">
            <input inputMode="decimal" value={totalMg} onChange={(e) => setTotalMg(e.target.value)} className="w-24 rounded-control border border-line/15 bg-bg px-3 py-2 text-center text-lg tabular-nums text-ink" aria-label="Vial strength mg" />
            <span className="text-muted">mg</span>
          </div>

          <label className="block text-sm text-muted">BAC water added</label>
          <div className="mb-5 mt-1 flex flex-wrap gap-2">
            {BAC_PRESETS.map((v) => (
              <button key={v} type="button" onClick={() => setBacWaterMl(v)} className={`rounded-control px-4 py-2 text-sm ${bacWaterMl === v ? "bg-accent text-onAccent" : "bg-bg ring-1 ring-line/15"}`}>{v} mL</button>
            ))}
            <input inputMode="decimal" value={bacWaterMl} onChange={(e) => setBacWaterMl(e.target.value)} className="w-20 rounded-control border border-line/15 bg-bg px-3 py-2 text-sm tabular-nums text-ink" aria-label="Custom BAC water mL" />
          </div>
        </>
      ) : (
        <>
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

      <div className="mb-4 rounded-card bg-accent/10 p-4 text-center">
        <p className="text-xs font-medium text-accentStrong">New concentration</p>
        <p className="text-3xl font-semibold tabular-nums text-accentStrong">
          {concentration ? `${concentration.div(1000).toDecimalPlaces(2).toString()}` : "—"}
          <span className="text-base"> mg/mL</span>
        </p>
      </div>

      <label className="block text-sm text-muted">Beyond-use date</label>
      <input type="date" value={beyondUseDate} onChange={(e) => setBeyondUseDate(e.target.value)} className="mb-4 mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-ink" aria-label="Beyond-use date" />

      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional, encrypted)" className="mb-2 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm" />

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <button
        type="button"
        onClick={() => { setError(null); setReviewing(true); }}
        disabled={!concentration || !newTotalMl}
        className="mt-3 w-full rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40"
      >
        Review changes
      </button>
    </div>
  );
}
