"use client";
/**
 * Section 0b — regional distribution card around the rendered body figure.
 * Owns the active-region state shared by the figure and the region table, the
 * Levels / Change view, and lays out figure | table | distribution across the
 * app's width ladder (PAGE_MAIN tiers).
 *
 *   phone  (< 1024) : figure + legend + readout + view toggle, then a collapsed <details> table, then stats
 *   lg     (≥ 1024) : [220px figure spanning two rows] [table] / [stats]
 *   ≥ 1900          : [260px figure] [table] [stats]
 *
 * History extension point: the card draws ONE model (latest) and its change
 * versus the previous scan. A later stepper wraps it with a chosen model.
 */
import { useState, type KeyboardEvent } from "react";
import type { Region } from "@/lib/body-comp-core";
import { fatHueT, type BodyFigureModel, type FigureCell } from "@/lib/body-figure-core";
import { BODY_COPY } from "@/lib/bodycomp-copy";
import { BodyFigure, type FigureMode } from "./BodyFigure";
import { CARD, PILL, SECTION_TITLE, fmtDate, num, signed, tierPill } from "./format";

const TISSUES = [
  { key: "fat", label: "fat", cls: "bg-tissueFat" },
  { key: "lean", label: "lean", cls: "bg-tissueLean" },
  { key: "bone", label: "bone", cls: "bg-tissueBone" },
] as const;

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted">{k}</dt>
      <dd className="tabular-nums text-ink">{v}</dd>
    </div>
  );
}

function Legend({ mode, model }: { mode: FigureMode; model: BodyFigureModel }) {
  if (mode === "change" && model.change) {
    const tiers = [
      { cls: "bg-muted", label: tierPill("within_noise").label },
      { cls: "bg-warn", label: tierPill("indeterminate").label },
      { cls: "bg-accent", label: tierPill("exceeds_lsc").label },
    ];
    return (
      <div className="flex w-full max-w-[200px] flex-col gap-1 lg:max-w-none" role="img" aria-label={BODY_COPY.figureAriaChange}>
        <div className="flex flex-wrap justify-center gap-3 text-[11px] leading-4 text-ink">
          {tiers.map((t) => (
            <span key={t.label} className="inline-flex items-center gap-1.5"><i className={`inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-line/20 ${t.cls}`} aria-hidden />{t.label}</span>
          ))}
        </div>
        <p className="m-0 text-center text-[10px] leading-[14px] text-muted">
          {BODY_COPY.figureLegendChange} · LSC {num(model.change.band.technical, 1)} / {num(model.change.band.practical, 1)} pts{model.change.demoted ? ` · ${BODY_COPY.flagDemoted}` : ""}
        </p>
      </div>
    );
  }
  return (
    <div className="flex w-full max-w-[200px] flex-col gap-1 lg:max-w-none" role="img" aria-label={BODY_COPY.figureAriaLevels}>
      <div className="flex flex-wrap justify-center gap-3 text-[11px] leading-4 text-ink">
        {TISSUES.map((t) => (
          <span key={t.key} className="inline-flex items-center gap-1.5">
            {t.key === "fat"
              ? <i className="inline-block h-2.5 w-7 rounded-sm ring-1 ring-line/20" style={{ background: "linear-gradient(90deg, rgb(var(--fig-fat)), rgb(var(--fig-fat-hi)))" }} aria-hidden />
              : <i className={`inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-line/20 ${t.cls}`} aria-hidden />}
            {t.key === "fat" ? "fat 12 → 28 %" : t.label}
          </span>
        ))}
      </div>
      <p className="m-0 text-center text-[10px] leading-[14px] text-muted">{BODY_COPY.figureLegendLevels}</p>
    </div>
  );
}

/** Mini stacked bar (bone · lean · fat) beside the region name — the fat segment carries the same hue ramp as the figure. */
function ShareBar({ c }: { c: FigureCell }) {
  const t = Math.round((1 - fatHueT(c.pctFat)) * 100);
  return (
    <span className="mr-2 inline-flex h-2 w-14 gap-px overflow-hidden rounded-sm bg-surface align-middle ring-1 ring-line/20" aria-hidden>
      <i className="block h-full bg-tissueBone" style={{ width: `${(c.boneShare * 100).toFixed(1)}%` }} />
      <i className="block h-full bg-tissueLean" style={{ width: `${(c.leanShare * 100).toFixed(1)}%` }} />
      <i className="block h-full" style={{ width: `${(c.fatShare * 100).toFixed(1)}%`, background: `color-mix(in srgb, rgb(var(--tissue-fat)) ${t}%, rgb(var(--tissue-fat-hi)))` }} />
    </span>
  );
}

interface RowProps { c: FigureCell; mode: FigureMode; active: Region | null; onActivate: (r: Region | null, pin?: boolean) => void }
function Row({ c, mode, active, onActivate }: RowProps) {
  const isActive = active === c.region;
  const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(c.region, true); } };
  const shared = {
    "data-region-row": c.region, "data-active": isActive || undefined, tabIndex: 0,
    className: `cursor-pointer outline-none focus-visible:[outline:2px_solid_rgb(var(--accent))] focus-visible:[outline-offset:-2px] ${isActive ? "bg-accent/10" : ""}`,
    onMouseEnter: () => onActivate(c.region), onMouseLeave: () => onActivate(null), onClick: () => onActivate(c.region, true), onFocus: () => onActivate(c.region), onBlur: () => onActivate(null), onKeyDown: onKey,
  };
  if (mode === "change") {
    const d = c.delta;
    const pill = d ? tierPill(d.tier) : null;
    return (
      <tr {...shared}>
        <td className="whitespace-nowrap py-1 pr-2 text-ink"><ShareBar c={c} />{c.label}</td>
        <td className="py-1 pr-2 text-right">{d ? signed(d.fatPts, 1) : "—"}</td>
        <td className="py-1 pr-2 text-right">{d ? signed(d.leanPts, 1) : "—"}</td>
        <td className="hidden py-1 pr-2 text-right sm:table-cell">{d ? signed(d.fatKg, 2) : "—"}</td>
        <td className="py-1 pr-2 text-right">{c.pctFat.toFixed(1)}</td>
        <td className="py-1 text-right">{pill ? <span className={pill.cls}>{pill.label}{d?.demoted ? ` (${BODY_COPY.flagDemoted})` : ""}</span> : <span className={`${PILL} bg-line/[0.08] text-muted`}>{BODY_COPY.figureNoPrevRegion}</span>}</td>
      </tr>
    );
  }
  return (
    <tr {...shared}>
      <td className="whitespace-nowrap py-1 pr-2 text-ink"><ShareBar c={c} />{c.label}</td>
      <td className="py-1 pr-2 text-right">{c.pctFat.toFixed(1)}</td>
      <td className="py-1 pr-2 text-right">{c.pctLean.toFixed(1)}</td>
      <td className="py-1 pr-2 text-right">{num(c.pctBone, 1)}</td>
      <td className="hidden py-1 pr-2 text-right sm:table-cell">{c.fatKg.toFixed(2)}</td>
      <td className="hidden py-1 pr-2 text-right sm:table-cell">{c.leanKg.toFixed(2)}</td>
      <td className="hidden py-1 text-right sm:table-cell">{num(c.bmdGcm2, 3)}</td>
    </tr>
  );
}

function RegionTable({ cells, mode, active, onActivate }: { cells: FigureCell[]; mode: FigureMode; active: Region | null; onActivate: RowProps["onActivate"] }) {
  const th = (text: string, extra = "") => <th className={`whitespace-nowrap py-1 pr-2 text-right font-medium ${extra}`}>{text}</th>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="whitespace-nowrap py-1 pr-2 font-medium">Region</th>
            {mode === "change"
              ? <>{th("Δ fat pts")}{th("Δ lean pts")}{th("Δ fat kg", "hidden sm:table-cell")}{th("Fat % now")}<th className="py-1 font-medium" aria-label="Change tier" /></>
              : <>{th("Fat %")}{th("Lean %")}{th("Bone %")}{th("Fat kg", "hidden sm:table-cell")}{th("Lean kg", "hidden sm:table-cell")}<th className="hidden whitespace-nowrap py-1 text-right font-medium sm:table-cell">BMD g/cm²</th></>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/10 tabular-nums">
          {cells.map((c) => <Row key={c.region} c={c} mode={mode} active={active} onActivate={onActivate} />)}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The one summary surface. With nothing hovered/focused it reads the WHOLE BODY
 * (the distribution ratios and asymmetries); point at a region and the same
 * panel reads that region instead. One place to look, and no dead "hover me"
 * hint occupying the space when idle.
 */
function Summary({ model, activeCell, mode }: { model: BodyFigureModel; activeCell: FigureCell | null; mode: FigureMode }) {
  const stats = (() => {
    if (!activeCell) {
      const w = model.wholeBody;
      return [
        { k: "Weight", v: `${(w.clinicWeightKg ?? w.massKg).toFixed(2)} kg` },
        { k: "Body fat", v: `${w.pctFat.toFixed(1)} % · ${w.fatKg.toFixed(2)} kg` },
        { k: "Lean", v: `${w.leanKg.toFixed(2)} kg` },
        { k: "Bone mineral", v: `${w.bmcKg.toFixed(3)} kg` },
        { k: "FFMI", v: `${w.ffmi.toFixed(2)} kg/m²` },
        { k: "ALMI", v: w.almi == null ? "—" : `${w.almi.toFixed(2)} kg/m²` },
        { k: "Android / gynoid % fat", v: num(model.ratios.androidGynoidPctFat, 2) },
        { k: "Trunk / limb fat mass", v: num(model.ratios.trunkLimbFatMass, 2) },
        { k: "Arm lean asymmetry (R − L)", v: model.asymmetry.armsPct == null ? "—" : `${signed(model.asymmetry.armsPct, 1)} %` },
        { k: "Leg lean asymmetry (R − L)", v: model.asymmetry.legsPct == null ? "—" : `${signed(model.asymmetry.legsPct, 1)} %` },
      ];
    }
    const c = activeCell;
    if (mode === "change") {
      const d = c.delta;
      return [
        { k: "Δ fat", v: d ? `${signed(d.fatPts, 1)} pts` : "—" },
        { k: "Δ lean", v: d ? `${signed(d.leanPts, 1)} pts` : "—" },
        { k: "Δ fat mass", v: d ? `${signed(d.fatKg, 2)} kg` : "—" },
        { k: "Reading", v: d ? `${tierPill(d.tier).label}${d.demoted ? ` (${BODY_COPY.flagDemoted})` : ""}` : BODY_COPY.figureNoPrevRegion },
      ];
    }
    return [
      { k: "Fat", v: `${c.pctFat.toFixed(1)} % · ${c.fatKg.toFixed(2)} kg` },
      { k: "Lean", v: `${c.pctLean.toFixed(1)} % · ${c.leanKg.toFixed(2)} kg` },
      { k: "Bone", v: c.pctBone == null ? "—" : `${c.pctBone.toFixed(1)} %` },
      { k: "BMD", v: c.bmdGcm2 == null ? "—" : `${num(c.bmdGcm2, 3)} g/cm²` },
    ];
  })();

  return (
    <div aria-live="polite">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink">
        {activeCell ? activeCell.label : BODY_COPY.figureWholeBody}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm min-[1900px]:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => <Stat key={s.k} k={s.k} v={s.v} />)}
        <p className="col-span-2 text-[10px] text-muted lg:col-span-3 min-[1900px]:col-span-2">{BODY_COPY.figureNote}</p>
      </dl>
    </div>
  );
}

export function BodyFigureCard({ model }: { model: BodyFigureModel }) {
  const [active, setActiveState] = useState<Region | null>(null);
  const [pinned, setPinned] = useState(false);
  const [mode, setMode] = useState<FigureMode>("levels");
  const [tableOpen, setTableOpen] = useState(false);
  const cells = [...model.regions, ...model.bands];
  const activeCell = cells.find((c) => c.region === active) ?? null;
  const canChange = model.change != null;
  const shownMode: FigureMode = canChange ? mode : "levels";

  const onActivate = (r: Region | null, pin = false) => {
    if (pin) { const nextPinned = !(pinned && active === r); setPinned(nextPinned); setActiveState(nextPinned ? r : null); return; }
    if (!pinned) setActiveState(r);
  };

  return (
    <section className="mb-8" aria-labelledby="body-figure-title" data-body-figure-card>
      <h2 id="body-figure-title" className={SECTION_TITLE}>{BODY_COPY.figureTitle}</h2>
      <div className={`${CARD} grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)] min-[1900px]:grid-cols-[260px_minmax(0,1fr)_minmax(0,1fr)]`}>
        {/* Column 1 — figure, legend, live readout, view toggle. Spans both rows at lg; one row at ultra-wide. */}
        <div className="flex min-w-0 flex-col items-center gap-2 lg:row-span-2 min-[1900px]:row-span-1">
          <p className="self-start text-xs text-muted">
            {shownMode === "change" && model.change ? `${fmtDate(new Date(model.scannedAtMs))} vs ${fmtDate(new Date(model.change.prevScannedAtMs))}` : fmtDate(new Date(model.scannedAtMs))}
          </p>
          <BodyFigure model={model} mode={shownMode} active={active} onActivate={onActivate} className="max-w-[200px] lg:max-w-none" />
          <Legend mode={shownMode} model={model} />
          <div className="inline-flex overflow-hidden rounded-control text-xs ring-1 ring-line/20" role="group" aria-label={BODY_COPY.figureViewLabel}>
            {([["levels", BODY_COPY.figureLevels], ["change", BODY_COPY.figureChange]] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={shownMode === k}
                disabled={k === "change" && !canChange}
                title={k === "change" && !canChange ? BODY_COPY.figureChangeNeedsPrev : undefined}
                onClick={() => setMode(k)}
                className={`px-2.5 py-1.5 font-medium outline-none focus-visible:[outline:2px_solid_rgb(var(--accent))] focus-visible:[outline-offset:-2px] disabled:cursor-not-allowed disabled:opacity-50 ${shownMode === k ? "bg-accent text-onAccent" : "bg-surface text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Column 2 — region table; folded behind a button on phones, always shown ≥ 1024.
            (A plain toggle rather than <details data-expand-mobile>: current Chromium hides closed
            details content via ::details-content, which the app's CSS rule cannot override.) */}
        <div className="min-w-0" data-region-table={tableOpen ? "open" : "closed"}>
          <button
            type="button"
            aria-expanded={tableOpen}
            aria-controls="body-figure-table"
            onClick={() => setTableOpen((o) => !o)}
            className="flex w-full items-center gap-1 text-left text-sm font-medium text-ink outline-none focus-visible:[outline:2px_solid_rgb(var(--accent))] focus-visible:[outline-offset:2px] lg:hidden"
          >
            <span aria-hidden className={`inline-block transition-transform motion-reduce:transition-none ${tableOpen ? "rotate-90" : ""}`}>▸</span>
            {BODY_COPY.figureTable}
          </button>
          <div id="body-figure-table" className={`${tableOpen ? "block" : "hidden"} lg:block`}>
            <RegionTable cells={cells} mode={shownMode} active={active} onActivate={onActivate} />
          </div>
        </div>

        {/* Stats — under the table at lg (col 2, row 2); own column at ultra-wide (col 3, row 1) */}
        <div className="min-w-0 lg:col-start-2 min-[1900px]:col-start-3 min-[1900px]:row-start-1">
          <Summary model={model} activeCell={activeCell} mode={shownMode} />
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        {shownMode === "change" ? BODY_COPY.figureIntroChange : BODY_COPY.figureIntro} {BODY_COPY.figureArtNote}
        {model.missing.length > 0 ? ` ${BODY_COPY.figureMissing}` : ""}
      </p>
    </section>
  );
}
