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
                      {d.route !== "oral" && d.preparation == null && " · needs reconstitution"}
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
                      initialDoseValue={d.doseValue}
                      initialDoseUnit={d.doseUnit}
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
