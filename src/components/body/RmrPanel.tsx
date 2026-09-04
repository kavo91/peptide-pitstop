/**
 * Section 7 — the resting metabolic rate panel. The equation ladder puts the
 * reference (primary) equation first — DXA-matched Tinsley 2019 (FFM) when a
 * DEXA is within 14 days, else Mifflin-St Jeor. The projection line is plain arithmetic on the
 * clinic's stored activity factor (measured × factor) with that provenance
 * spelled out; the app computes no target and stores no TDEE.
 */
import type { BodyDashboardData, MetabolicTestValues } from "@/lib/bodycomp-data";
import { BODY_COPY } from "@/lib/bodycomp-copy";
import { CARD, PILL, fmtDate, methodLabel, num, tri } from "./format";
import { DeleteMetabolicTestButton } from "./DeleteMetabolicTestButton";

export function RmrPanel({ rmr, tests = [], ffmScanDate }: { rmr: BodyDashboardData["rmr"]; /** Every stored test, oldest → newest. */ tests?: MetabolicTestValues[]; ffmScanDate: Date | null }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-medium text-muted">Resting metabolic rate</h2>
      <div className={CARD}>
        {!rmr ? (
          <p className="text-sm text-muted">No RMR test recorded. Add one from the scan entry page when a clinic measures it.</p>
        ) : (
          <>
            {/* Keyed by test id: a delete then router.refresh() must not carry the confirm state onto the next test. */}
            <RmrBody key={rmr.test.id} rmr={rmr} ffmScanDate={ffmScanDate} />
            {tests.length > 1 && <AllTests tests={tests} latestId={rmr.test.id} />}
          </>
        )}
      </div>
    </section>
  );
}

/** Every stored test (newest first) with its own delete control — an older or back-dated test is otherwise unreachable. */
function AllTests({ tests, latestId }: { tests: MetabolicTestValues[]; latestId: string }) {
  return (
    <div className="mt-4 border-t border-line/10 pt-3">
      <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">All RMR tests</p>
      <ul className="divide-y divide-line/10 text-sm">
        {[...tests].reverse().map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
            <span className="flex flex-wrap items-center gap-2 tabular-nums">
              <span className="text-ink">{fmtDate(t.testedAt)}</span>
              <span>{t.measuredRmrKcal.toFixed(0)} kcal/d</span>
              <span className="text-xs text-muted">{methodLabel(t.method)}{t.deviceLabel ? ` · ${t.deviceLabel}` : ""}</span>
              {t.id === latestId && <span className={`${PILL} bg-line/[0.08] text-muted`}>shown above</span>}
            </span>
            {t.id !== latestId && <DeleteMetabolicTestButton key={t.id} id={t.id} label={fmtDate(t.testedAt)} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RmrBody({ rmr, ffmScanDate }: { rmr: NonNullable<BodyDashboardData["rmr"]>; ffmScanDate: Date | null }) {
  const t = rmr.test;
  const p = t.prep;
  // `rested` is the stored tri-state. Tests saved before that column existed have it null;
  // for those, fall back to the old heuristic: minutes recorded → yes; any other prep answer
  // recorded → no; nothing recorded → unknown.
  const otherPrepAnswered = [p.fasted, p.noCaffeine, p.noTrainingPriorDay, p.activeTravel, p.illnessFree14d, p.awakeQuiet].some((v) => v != null);
  const rested: boolean | null = p.rested ?? (p.restMinBeforeTest != null ? true : otherPrepAnswered ? false : null);
  const restText = rested == null ? "unknown" : rested ? (p.restMinBeforeTest != null ? `${p.restMinBeforeTest} min` : "yes") : "no";
  const conditionsUnknown =
    [p.fasted, p.noCaffeine, p.noTrainingPriorDay, p.activeTravel, p.illnessFree14d, p.awakeQuiet].some((v) => v == null) || rested == null;
  const projection = t.reportedActivityFactor != null ? Math.round(t.measuredRmrKcal * t.reportedActivityFactor) : null;

  return (
    <>
      <header className="mb-3 flex flex-wrap items-baseline gap-2">
        <p className="text-2xl font-semibold tabular-nums text-ink">
          {t.measuredRmrKcal.toFixed(0)}<span className="ml-1 text-sm text-muted">kcal/d</span>
        </p>
        <span className={`${PILL} bg-line/[0.08] text-muted`}>{methodLabel(t.method)}</span>
        {conditionsUnknown && <span className={`${PILL} bg-warn/10 text-warn`}>{BODY_COPY.rmrConditionsUnknown}</span>}
        <span className="text-xs text-muted">{fmtDate(t.testedAt)}{t.deviceLabel ? ` · ${t.deviceLabel}` : ""}</span>
        <DeleteMetabolicTestButton id={t.id} label={fmtDate(t.testedAt)} />
      </header>

      <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">Noise band</dt>
          <dd className="tabular-nums">± {rmr.lsc.toFixed(0)} kcal (LSC)</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">VO2</dt>
          <dd className="tabular-nums">{rmr.vo2 ? `${rmr.vo2.mlPerMin.toFixed(0)} mL/min` : "—"}{rmr.vo2?.mets != null ? ` · ${rmr.vo2.mets.toFixed(2)} MET` : ""}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">RQ · kcal/L O2</dt>
          <dd className="tabular-nums">{num(t.rq, 2)} · {num(t.kcalPerLitreO2, 2)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">Steady state</dt>
          <dd className="tabular-nums">{t.durationMin != null ? `${t.durationMin} min` : "—"}{t.steadyStateCvPct != null ? ` · CV ${t.steadyStateCvPct.toFixed(1)} %` : ""}</dd>
        </div>
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="py-1 pr-2 font-medium">Equation</th>
              <th className="py-1 pr-2 font-medium">Basis</th>
              <th className="py-1 pr-2 text-right font-medium">Predicted</th>
              <th className="py-1 text-right font-medium">Measured ÷ predicted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/10 tabular-nums">
            {[...rmr.ladder].sort((a, b) => Number(b.primary) - Number(a.primary)).map((row) => (
              <tr key={row.key} className={row.primary ? "font-semibold text-ink" : ""}>
                <td className="py-1.5 pr-2">
                  {row.label}
                  {row.primary && <span className={`ml-1 ${PILL} bg-line/[0.08] font-medium text-muted`}>reference</span>}
                  {row.key === "mifflin" && <span className="block text-[10px] font-normal text-muted">{row.note}</span>}
                </td>
                <td className="py-1.5 pr-2">{row.basis === "ffm" ? "FFM" : "weight"}</td>
                <td className="py-1.5 pr-2 text-right">{row.predictedKcal == null ? "—" : row.predictedKcal.toFixed(0)}</td>
                <td className="py-1.5 text-right">{row.ratio == null ? "—" : row.ratio.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">per kg FFM (DXA lean + BMC)</dt>
          <dd className="tabular-nums">{num(rmr.perKg.perKgFfm, 1)} kcal/kg</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">per kg lean (DXA lean only)</dt>
          <dd className="tabular-nums">{num(rmr.perKg.perKgLean, 1)} kcal/kg</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">per kg body mass (test-day weight {t.weightKg.toFixed(1)} kg)</dt>
          <dd className="tabular-nums">{num(rmr.perKg.perKgBodyMass, 1)} kcal/kg</dd>
        </div>
      </dl>
      <p className="mt-2 text-[10px] text-muted">
        {rmr.ffmScanId
          ? `FFM from the DEXA on ${ffmScanDate ? fmtDate(ffmScanDate) : "the linked scan"}${rmr.ffmScanDaysApart != null && rmr.ffmScanDaysApart !== 0 ? ` (${Math.abs(rmr.ffmScanDaysApart)} days ${rmr.ffmScanDaysApart > 0 ? "before" : "after"} the test)` : ""}.`
          : "No DEXA within 14 days of the test — FFM-based equations are not shown."}
        {" "}Conditions: fasted {tri(p.fasted)}{p.fastingHours != null ? ` (${p.fastingHours} h)` : ""}, no caffeine {tri(p.noCaffeine)}, no training prior day {tri(p.noTrainingPriorDay)}, active travel {tri(p.activeTravel)}, rested {restText}, awake and still {tri(p.awakeQuiet)}, illness-free 14 d {tri(p.illnessFree14d)}.
      </p>

      {t.reportedPredictedKcal != null && (
        <p className="mt-2 text-xs text-muted">
          Clinic-printed prediction: {t.reportedPredictedKcal.toFixed(0)} kcal{t.reportedPredictionEquation ? ` (${t.reportedPredictionEquation})` : ""}.
        </p>
      )}
      {projection != null && (
        <p className="mt-1 text-xs text-muted">
          {t.measuredRmrKcal.toFixed(0)} × {t.reportedActivityFactor}{t.reportedActivityLabel ? ` ${t.reportedActivityLabel}` : ""} = {projection} kcal — {BODY_COPY.tdeeNote}.
        </p>
      )}
    </>
  );
}
