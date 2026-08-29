/**
 * TodaysDosesCard — the full "Today's doses" section extracted from the
 * Dashboard page. Contains:
 *   - Day navigation (‹ / ›) in its own header row
 *   - Per-slot <details> cards for each DueDose
 *   - LogDoseForm branch (preparation + syringes available)
 *   - ReconWizard branch (vialForPrep exists, no active prep)
 *   - No-vial-on-hand branch (fallback message)
 *   - Logged-today list with DeleteLogButton
 *   - "Log an unscheduled dose" link
 *
 * The day-nav lives here, NOT in the page-level Dashboard header, to keep
 * the 380px header uncluttered (spec §data-sources).
 *
 * Syringe list type is inlined here to avoid a round-trip import from page.tsx.
 */
import Link from "next/link";
import { addDays } from "@/lib/schedule/schedule";
import { LogDoseForm } from "@/components/LogDoseForm";
import { splitProspectiveDose, weakestBlendSource, roundSplitForDisplay } from "@/lib/blends-core";
import { OralLogForm } from "@/components/OralLogForm";
import { ReconWizard } from "@/components/ReconWizard";
import { DeleteLogButton } from "@/components/DeleteLogButton";
import { formatLoggedDoseDisplay } from "@/lib/dosing/oral";
import type { DueDose, LoggedDose } from "@/lib/today";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

interface Syringe {
  id: string;
  name: string;
  graduationType: "units" | "ml";
  deviceType: "syringe" | "pen";
  unitsPerMl: number;
  capacityMl: string;
  capacityUnits: number;
  increment: string;
}

interface Props {
  due: DueDose[];
  logged: LoggedDose[];
  syringes: Syringe[];
  recentSitesByPeptide: Map<string, string[]>;
  viewDate: Date;
  viewKey: string;
  isToday: boolean;
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function TodaysDosesCard({
  due,
  logged,
  syringes,
  recentSitesByPeptide,
  viewDate,
  viewKey,
  isToday,
}: Props) {
  const heading = isToday
    ? "Today"
    : viewDate.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const remaining = due.filter((d) => !d.alreadyLoggedToday).length;
  const subtitle = isToday
    ? `${remaining} dose${remaining === 1 ? "" : "s"} to go`
    : viewDate.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  const offDayTakenAtISO = isToday ? undefined : new Date(viewKey + "T12:00:00").toISOString();

  return (
    <section>
      {/* Day navigation — lives in TodaysDosesCard, not the page header */}
      <header className="mb-3 flex items-center gap-2">
        <a
          href={`/today?date=${ymd(addDays(viewDate, -1))}`}
          aria-label="Previous day"
          className="inline-flex items-center rounded-control bg-surface px-2.5 py-2 text-muted ring-1 ring-line/10"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </a>
        <div className="flex-1 text-center">
          <h2 className="text-xl font-semibold tracking-tight">{heading}</h2>
          <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
        </div>
        <a
          href={`/today?date=${ymd(addDays(viewDate, 1))}`}
          aria-label="Next day"
          className="inline-flex items-center rounded-control bg-surface px-2.5 py-2 text-muted ring-1 ring-line/10"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </a>
      </header>

      <div className="mb-4 flex items-center justify-between text-xs">
        {isToday ? <span /> : <Link href="/today" className="font-medium text-accentStrong">Jump to today</Link>}
        <Link href="/doses" className="inline-flex items-center gap-1.5 font-medium text-accentStrong">
          <CalendarDays className="h-4 w-4" aria-hidden />
          Full schedule
        </Link>
      </div>

      {due.length === 0 && <p className="text-muted">Nothing scheduled today.</p>}

      <ul className="space-y-3">
        {due.map((d) => {
          let defaultTakenAtISO: string | undefined = offDayTakenAtISO;
          if (isToday && d.time) {
            defaultTakenAtISO = new Date(viewKey + "T" + d.time + ":00").toISOString();
          }
          return (
            <li key={d.slotKey} className="rounded-card bg-surface shadow-sm ring-1 ring-line/10">
              <details>
                <summary className="flex cursor-pointer items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">
                      {d.peptideName}
                      {d.time && <span className="ml-2 text-sm font-normal text-muted tabular-nums">{d.time}</span>}
                    </p>
                    <p className="text-sm text-ink tabular-nums">
                      {d.doseValue} {d.doseUnit}
                      {d.route === "oral" && " · oral"}
                      {d.route !== "oral" && !d.alreadyLoggedToday && d.preparation == null && " · needs reconstitution"}
                      {d.shifted && (
                        <span className="ml-2 rounded-full bg-accent2/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-accent2Strong">
                          Shifted
                        </span>
                      )}
                      {/* Surfaced on the collapsed row on purpose: the inventory
                          page already flagged a past-BUD prep, but nobody opens
                          inventory before dosing. This is the screen they do open. */}
                      {!d.alreadyLoggedToday && d.budState === "passed" && (
                        <span className="ml-2 rounded-full bg-danger/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-danger">
                          Past use-by
                        </span>
                      )}
                      {!d.alreadyLoggedToday && d.budState === "approaching" && (
                        <span className="ml-2 rounded-full bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-warn">
                          Use-by soon
                        </span>
                      )}
                    </p>
                    {d.phaseProgress && (
                      // Include the phase's own dose so "Phase 2" can't be misread as
                      // "2 mg" — the phase ordinal and the dose level are different.
                      <p className="text-xs text-accentStrong tabular-nums">
                        Phase {d.phaseProgress.phaseIndex + 1} of {d.phaseProgress.phaseCount} · {d.doseValue} {d.doseUnit}
                        {d.phaseProgress.targetInPhase != null
                          ? ` · ${d.phaseProgress.deliveredInPhase}/${d.phaseProgress.targetInPhase} doses`
                          : " · maintenance"}
                      </p>
                    )}
                    {(() => {
                      // Prospective per-component split for vendor blends — the
                      // CURRENT dose (titration-aware via doseValue) divided by
                      // the stored label/CoA ratio. Unsplittable (units, blank,
                      // no prep conc for an ml dose) → no line, never a guess.
                      // Suppressed once logged: the logged views decompose the
                      // REAL recorded dose; re-splitting the scheduled one here
                      // could disagree with it.
                      if (!d.blendComponents || d.alreadyLoggedToday) return null;
                      const comps = d.blendComponents.map((c) => ({ ...c, source: c.source as "label" | "coa" | "assumed" }));
                      const split = splitProspectiveDose(d.doseValue, d.doseUnit, comps, d.preparation?.concentrationMcgPerMl ?? null);
                      if (!split) return null;
                      // Largest-remainder rounding: components sum to the
                      // rounded parent; the line claims the WEAKEST provenance.
                      const shown = roundSplitForDisplay(split.map((c) => c.doseMcg));
                      return (
                        <p className="text-xs text-muted tabular-nums">
                          ↳ {split.map((c, i) => `${c.componentName} ${shown[i]} mcg`).join(" · ")}
                          {" "}<span className="opacity-70">(derived, {weakestBlendSource(comps)})</span>
                        </p>
                      );
                    })()}
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      d.alreadyLoggedToday ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"
                    }`}
                  >
                    {d.alreadyLoggedToday ? "Logged" : "Due"}
                  </span>
                </summary>

                <div className="border-t border-line/10 p-4">
                  {d.alreadyLoggedToday ? (
                    <p className="text-sm text-ok">Already logged today ✓</p>
                  ) : d.route === "oral" ? (
                    <OralLogForm
                      protocolId={d.protocolId}
                      peptideId={d.peptideId}
                      peptideName={d.peptideName}
                      defaultTakenAtISO={defaultTakenAtISO}
                      useLiveTakenAt={isToday}
                      initialDoseValue={d.doseValue}
                      initialDoseUnit={d.doseUnit}
                    />
                  ) : d.preparation && syringes.length > 0 ? (
                    <LogDoseForm
                      protocolId={d.protocolId}
                      peptideName={d.peptideName}
                      preparation={d.preparation}
                      syringes={syringes}
                      defaultSyringeId={d.syringe?.id}
                      defaultTakenAtISO={defaultTakenAtISO}
                      useLiveTakenAt={isToday}
                      initialDoseValue={d.doseValue}
                      initialDoseUnit={d.doseUnit}
                      blendComponents={d.blendComponents?.map((c) => ({ ...c, source: c.source as "label" | "coa" | "assumed" })) ?? null}
                      hoursSinceLast={d.hoursSinceLast}
                      halfLifeHours={d.halfLifeHours}
                      minIntervalHours={d.minIntervalHours}
                      recentSites={recentSitesByPeptide.get(d.peptideId) ?? []}
                    />
                  ) : d.vialForPrep ? (
                    <ReconWizard
                      vialId={d.vialForPrep.id}
                      peptideName={d.peptideName}
                      labelStrengthMg={d.vialForPrep.labelStrengthMg}
                      targetDose={d.doseValue}
                      targetUnit={d.doseUnit}
                      syringe={d.syringe}
                      beyondUseDays={d.vialForPrep.budDefaultDays}
                    />
                  ) : (
                    <p className="text-sm text-muted">No vial on hand — add one in Inventory.</p>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ul>

      <a
        href="/log"
        className="mt-4 block w-full rounded-control bg-bg px-4 py-2.5 text-center text-sm font-medium text-accentStrong ring-1 ring-line/10"
      >
        + Log an unscheduled dose
      </a>

      {logged.length > 0 && (
        <section className="mt-8">
          <h3 className="mb-3 text-sm font-medium text-muted">
            {isToday ? "Logged today" : "Logged"}
          </h3>
          <ul className="space-y-2">
            {logged.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-3 rounded-control bg-surface px-4 py-3 text-sm shadow-sm ring-1 ring-line/10"
              >
                <div>
                  <p className="font-medium">{l.peptideName}</p>
                  {l.route === "oral" ? (
                    <p className="text-xs text-muted">Oral</p>
                  ) : (
                    l.injectionSite && <p className="text-xs text-muted">{l.injectionSite}</p>
                  )}
                  <div className="mt-1 flex items-center gap-3">
                    <Link href={`/log/${l.id}/edit`} className="text-xs font-medium text-accentStrong">Edit</Link>
                    <DeleteLogButton id={l.id} label={`${l.peptideName} dose`} />
                  </div>
                </div>
                <div className="text-right">
                  <p className="tabular-nums">{formatLoggedDoseDisplay(l)}</p>
                  <p className="text-xs text-muted tabular-nums">{l.timeLabel}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
