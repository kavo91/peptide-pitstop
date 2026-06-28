"use client";

import { Syringe } from "lucide-react";

import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import { computeDraw } from "@/lib/dosing/engine";
import { doseUnitBreakdown } from "@/lib/dosing/unit-breakdown";
import type { DoseUnit } from "@/lib/dosing/types";
import type { ProtocolDoseOption } from "@/lib/log/protocol-options";
import { logDose } from "@/app/actions/doses";
import { enqueue } from "@/lib/offline/outbox";
import { VisualSyringe } from "./VisualSyringe";
import { RebasePrompt } from "./RebasePrompt";
import { assessTiming } from "@/lib/halflife";
import { suggestNextSite } from "@/lib/sites";
import { BodyMap } from "./BodyMap";

interface PrepOption {
  peptideId: string;
  peptideName: string;
  preparation: { id: string; concentrationMcgPerMl: string; remainingMl: string };
  /** Hours since the most recent dose for this peptide. null = no prior dose. */
  hoursSinceLast: number | null;
  /** Peptide.halfLifeHours as a number, or null when unset. */
  halfLifeHours: number | null;
  /** Peptide.minIntervalHours as a number, or null when unset. */
  minIntervalHours: number | null;
}
interface SyringeDTO {
  id: string;
  name: string;
  graduationType: "units" | "ml";
  unitsPerMl: number;
  capacityMl: string;
  capacityUnits: number;
  increment: string;
}

const UNITS: DoseUnit[] = ["mcg", "mg", "ml", "units"];

function nowLocalInput(): string {
  const n = new Date();
  const off = n.getTimezoneOffset();
  return new Date(n.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function AdHocLogForm({
  options,
  syringes,
  suggestedSiteByPeptide,
  recentSitesByPeptide,
  protocolOptions = [],
}: {
  options: PrepOption[];
  syringes: SyringeDTO[];
  /** Map from peptideId → suggested site code (LRU). */
  suggestedSiteByPeptide: Record<string, string>;
  /** Map from peptideId → raw recent-site codes, most-recent-first. */
  recentSitesByPeptide: Record<string, string[]>;
  /** Active protocols with their resolved per-injection dose (safe resolver path). */
  protocolOptions?: ProtocolDoseOption[];
}) {
  const [protocolId, setProtocolId] = useState("");
  const [prepId, setPrepId] = useState(options[0]?.preparation.id ?? "");
  const [syringeId, setSyringeId] = useState(syringes[0]?.id ?? "");
  const [doseValue, setDoseValue] = useState("");
  const [doseUnit, setDoseUnit] = useState<DoseUnit>("mcg");
  const [takenAt, setTakenAt] = useState(nowLocalInput());
  const [site, setSite] = useState(() => {
    const firstPeptideId = options[0]?.peptideId ?? "";
    const raw = recentSitesByPeptide[firstPeptideId] ?? [];
    return suggestNextSite(raw);
  });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rebase, setRebase] = useState<{ protocolId: string; plannedDateISO: string; actualDateISO: string; suggestedDays: string[] } | undefined>();

  const opt = options.find((o) => o.preparation.id === prepId);
  const syr = syringes.find((s) => s.id === syringeId);

  // Derive current peptideId from prepId for the recentSites lookup.
  const currentPeptideId = opt?.peptideId ?? options[0]?.peptideId ?? "";
  // recentSites for the currently selected peptide.
  const recentSitesForPeptide = recentSitesByPeptide[currentPeptideId] ?? [];

  const timing =
    opt && opt.hoursSinceLast != null
      ? assessTiming({
          halfLifeHours: opt.halfLifeHours,
          minIntervalHours: opt.minIntervalHours,
          hoursSinceLast: opt.hoursSinceLast,
        })
      : null;

  const draw = useMemo(() => {
    if (!opt || !syr || !doseValue || new Decimal(doseValue || 0).lte(0)) return null;
    try {
      return computeDraw({
        dose: { value: doseValue, unit: doseUnit },
        preparation: { prepType: "premixed", concentrationMcgPerMl: new Decimal(opt.preparation.concentrationMcgPerMl) },
        syringe: { ...syr },
        remainingMl: opt.preparation.remainingMl,
      });
    } catch {
      return null;
    }
  }, [opt, syr, doseValue, doseUnit]);

  const blocked = draw?.warnings.some((w) => w.severity === "block") ?? false;

  // Four-unit breakdown of the TARGET dose, recomputed with the draw so it
  // tracks the selected syringe (units = rawUnits = volume × unitsPerMl).
  const multiUnit = useMemo(
    () => (draw && syr ? doseUnitBreakdown(draw, { ...syr }) : undefined),
    [draw, syr],
  );

  /**
   * Pick a Protocol: set the dose to its RESOLVED per-injection value (from the
   * builder — never a raw weekly targetDose; "" leaves the field blank for an
   * unresolved per_week, §6) and point the prep at the protocol's peptide. The
   * empty option (id "") clears back to ad-hoc / none.
   */
  function onProtocolChange(id: string) {
    setProtocolId(id);
    const po = protocolOptions.find((p) => p.protocolId === id);
    if (!po) {
      // Ad-hoc / none — clear the resolved dose; leave prep selection as-is.
      setDoseValue("");
      return;
    }
    setDoseValue(po.doseValue);
    setDoseUnit(po.doseUnit);
    // Prefer the protocol's active prep; else any prep for its peptide. Never
    // silently borrow a different peptide's prep — if none, the draw stays empty
    // (no concentration) and the prep <select> shows whatever was selected.
    const prepForProtocol =
      (po.preparationId && options.find((o) => o.preparation.id === po.preparationId)) ||
      options.find((o) => o.peptideId === po.peptideId);
    if (prepForProtocol) {
      setPrepId(prepForProtocol.preparation.id);
      const raw = recentSitesByPeptide[prepForProtocol.peptideId] ?? [];
      setSite(suggestNextSite(raw));
    }
  }

  /**
   * Select a preparation by id and apply the same site-suggest side effect the
   * Peptide <select> onChange does. Shared by the select and the pitstop
   * quick-pick chips so there is a single source of truth for prep selection.
   */
  function selectPrep(newPrepId: string) {
    setPrepId(newPrepId);
    const newOpt = options.find((o) => o.preparation.id === newPrepId);
    if (newOpt) {
      const raw = recentSitesByPeptide[newOpt.peptideId] ?? [];
      setSite(suggestNextSite(raw));
    }
  }

  // No active prep for the picked protocol's peptide → surface a hint + the draw
  // is disabled (we never borrow another peptide's prep).
  const pickedProtocol = protocolOptions.find((p) => p.protocolId === protocolId);
  const protocolNeedsPrep =
    pickedProtocol != null && !options.some((o) => o.peptideId === pickedProtocol.peptideId);

  async function onConfirm() {
    if (!opt || !syr) return;
    setBusy(true);
    setError(null);

    const uuid = crypto.randomUUID();
    const input = {
      preparationId: opt.preparation.id,
      syringeId: syr.id,
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
      setDone(true); // optimistic: show success; outbox syncs on reconnect
      return;
    }

    setBusy(false);
    if (res.ok) { setDone(true); if (res.rebase) setRebase(res.rebase); }
    else setError(res.error ?? "Could not log dose");
  }

  if (options.length === 0) {
    return <p className="rounded-card bg-surface p-4 text-sm text-muted ring-1 ring-line/10">No prepared vials yet. Reconstitute one on the Today screen first.</p>;
  }
  if (done) {
    return (
      <div className="space-y-2">
        <p className="rounded-control bg-ok/10 px-3 py-2 text-sm font-medium text-ok">Logged ✓ {opt?.peptideName}</p>
        {rebase && <RebasePrompt rebase={rebase} />}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      {protocolOptions.length > 0 && (
        <label className="block text-sm">
          Protocol
          <select
            value={protocolId}
            onChange={(e) => onProtocolChange(e.target.value)}
            className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2"
            aria-label="Protocol"
          >
            <option value="">Ad-hoc / none</option>
            {protocolOptions.map((po) => (
              <option key={po.protocolId} value={po.protocolId}>
                {po.peptideName}
                {po.doseValue ? ` — ${po.doseValue} ${po.doseUnit}` : ""}
              </option>
            ))}
          </select>
          {protocolNeedsPrep && (
            <span className="mt-1 block text-xs text-warn">
              ⚠ No prepared vial for this peptide — needs reconstitution.
            </span>
          )}
        </label>
      )}

      {/* Quick-pick pills — one per prep, mirroring the Peptide <select>. The
          active pill is skewed by CSS (.on); its label is wrapped in a <span>
          so the CSS counter-skews the text upright. Clicking routes through the
          SAME selectPrep() the <select> uses. */}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
            const active = o.preparation.id === prepId;
            const conc = new Decimal(o.preparation.concentrationMcgPerMl).div(1000).toDecimalPlaces(2).toString();
            // Two preps of one peptide can share a concentration (only the vial /
            // remaining volume differs). Append the remaining mL ONLY then, so a
            // sighted user + screen reader can tell otherwise-identical chips apart.
            const ambiguous = options.filter((x) => x.peptideName === o.peptideName && new Decimal(x.preparation.concentrationMcgPerMl).eq(o.preparation.concentrationMcgPerMl)).length > 1;
            const remaining = new Decimal(o.preparation.remainingMl).toDecimalPlaces(1).toString();
            const sub = ambiguous ? `${conc} mg/mL · ${remaining} ml` : `${conc} mg/mL`;
            const aria = ambiguous ? `${o.peptideName} ${conc} mg/mL, ${remaining} ml remaining` : `${o.peptideName} ${conc} mg/mL`;
            const label = (
              <>
                <span className="block">{o.peptideName}</span>
                <span className="block text-[0.7em] opacity-70">{sub}</span>
              </>
            );
            return (
              <button
                key={o.preparation.id}
                type="button"
                onClick={() => selectPrep(o.preparation.id)}
                aria-pressed={active}
                aria-label={aria}
                className={`pitstop-peptide-chip${active ? " on" : ""}`}
              >
                {active ? <span>{label}</span> : label}
              </button>
            );
          })}
      </div>

      <label className="block text-sm sr-only">
        Peptide
        <select
          value={prepId}
          onChange={(e) => selectPrep(e.target.value)}
          className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2"
        >
          {options.map((o) => {
            const conc = new Decimal(o.preparation.concentrationMcgPerMl).div(1000).toDecimalPlaces(2).toString();
            const ambiguous = options.filter((x) => x.peptideName === o.peptideName && new Decimal(x.preparation.concentrationMcgPerMl).eq(o.preparation.concentrationMcgPerMl)).length > 1;
            const remaining = new Decimal(o.preparation.remainingMl).toDecimalPlaces(1).toString();
            return (
              <option key={o.preparation.id} value={o.preparation.id}>{o.peptideName} ({conc} mg/mL{ambiguous ? ` · ${remaining} ml` : ""})</option>
            );
          })}
        </select>
      </label>

      <div className="flex gap-2">
        <input inputMode="decimal" value={doseValue} onChange={(e) => setDoseValue(e.target.value)} placeholder="Dose" className="w-28 rounded-control border border-line/15 bg-bg px-3 py-2 tabular-nums" aria-label="Dose amount" />
        <select value={doseUnit} onChange={(e) => setDoseUnit(e.target.value as DoseUnit)} className="rounded-control border border-line/15 bg-bg px-3 py-2" aria-label="Dose unit">
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>

      <label className="block text-sm">
        Syringe
        <select value={syringeId} onChange={(e) => setSyringeId(e.target.value)} className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2">
          {syringes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>

      {/* Pit-board row: Rajdhani uppercase muted label + a mono-styled field.
          Cosmetic only — the datetime-local stays fully editable. */}
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-muted">Time taken</span>
        <input
          type="datetime-local"
          value={takenAt}
          onChange={(e) => setTakenAt(e.target.value)}
          className="w-full rounded-control border border-line/15 bg-bg px-3 py-2 font-mono tabular-nums"
        />
      </label>

      {/* Syringe preview — always present once a prep + syringe are picked: it
          shows an EMPTY barrel and fills as you type a dose, so the ad-hoc flow
          has the same always-visible syringe as the protocol flow (which
          auto-fills the dose). The draw stats/warnings still gate on a real
          `draw`. */}
      {Boolean(opt && syr) && (
        <>
          {doseValue && (
            <div className="pitstop-dosebox">
              <span className="pitstop-dosebox__num">{doseValue}</span>
              <span className="pitstop-dosebox__unit">{doseUnit.toUpperCase()}</span>
            </div>
          )}
          <VisualSyringe
            capacityMl={Number(syr!.capacityMl)}
            fillMl={draw ? draw.targetVolumeMl.toNumber() : 0}
            markingLabel={
              draw
                ? draw.markingScale === "units"
                  ? `${draw.markingValue.toString()} units`
                  : `${draw.markingValue.toDecimalPlaces(2).toString()} mL`
                : "—"
            }
            overfill={blocked}
            multiUnit={multiUnit}
          />
          {draw && (
            <>
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
        </>
      )}

      <div className="space-y-1">
        <p className="text-sm">Injection site</p>
        <BodyMap
          value={site || null}
          onChange={setSite}
          recentSites={recentSitesForPeptide}
        />
      </div>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional, encrypted)" className="w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm" />
      {error && <p className="text-sm text-danger">{error}</p>}

      {timing && timing.message && (
        <p className={`rounded-control px-3 py-2 text-sm ${timing.tooSoon ? "bg-warn/10 text-warn" : "bg-surface text-muted"}`}>
          {timing.tooSoon ? "⚠ " : ""}{timing.message}
        </p>
      )}

      <button type="button" onClick={onConfirm} disabled={busy || blocked || !draw || protocolNeedsPrep} className="w-full rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40 sticky bottom-[64px] z-20 shadow-lg sm:static sm:bottom-auto sm:z-auto sm:shadow-none pitstop-savebtn">
        <Syringe className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />{busy ? "Logging…" : "Log dose"}
      </button>
    </div>
  );
}
