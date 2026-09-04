/**
 * Section 2 — latest-vs-previous delta table. Every Δ is shown beside its
 * multiple of the technical LSC and a three-tier pill; the comparability pill
 * demotes flags when prep, device or secretagogue state differ.
 */
import { indices, type DeltaFlag } from "@/lib/body-comp-core";
import { ffmScanFor, type BodyInterval, type MetabolicTestValues, type ScanWithDerived } from "@/lib/bodycomp-data";
import { BODY_COPY } from "@/lib/bodycomp-copy";
import { CARD, comparabilityPill, flagPill, fmtDate, num, signed } from "./format";

interface Row {
  label: string;
  unit: string;
  digits: number;
  prev: number | null;
  next: number | null;
  flag: DeltaFlag | null;
  /** Suppressed (null) unless the change is beyond technical LSC and ≥ 28 days apart. */
  rate: number | null;
  /** Rows with no defined LSC show no flag (the Δ still hides with the rest when the pair is not comparable). */
  noLsc?: boolean;
}

interface Props {
  interval: BodyInterval;
  /** Oldest → newest; the two most recent tests feed the RMR rows. */
  tests: MetabolicTestValues[];
  /** Every scan (oldest → newest): each RMR test takes its FFM from its own nearest scan, as the RMR panel and the report do. */
  scans: ScanWithDerived[];
}

export function DeltaTable({ interval, tests, scans }: Props) {
  const { from, to, deltas, rates, comparability } = interval;
  // ADAPTER: `BodyInterval.from/to` are typed as ScanValues; the indices are
  // recomputed here from the pure core (identical to ScanWithDerived.indices).
  const fi = indices(from), ti = indices(to);
  const prevTest = tests.length >= 2 ? tests[tests.length - 2] : null;
  const lastTest = tests.length >= 2 ? tests[tests.length - 1] : null;
  const rmrPerFfm = (t: MetabolicTestValues | null) => {
    const ffm = t ? ffmScanFor(t, scans)?.indices.ffmKg ?? null : null;
    return t && ffm != null && ffm > 0 ? t.measuredRmrKcal / ffm : null;
  };

  const rows: Row[] = [
    { label: "Fat mass", unit: "kg", digits: 2, prev: from.totalFatG / 1000, next: to.totalFatG / 1000, flag: deltas.fat, rate: rates.fat },
    { label: "Lean mass", unit: "kg", digits: 2, prev: from.totalLeanG / 1000, next: to.totalLeanG / 1000, flag: deltas.lean, rate: rates.lean },
    { label: "Body fat", unit: "%", digits: 1, prev: from.pctFat, next: to.pctFat, flag: deltas.pctFat, rate: rates.pctFat },
    { label: "ALM", unit: "kg", digits: 2, prev: fi.almKg, next: ti.almKg, flag: deltas.alm, rate: null },
    { label: "VAT", unit: "g", digits: 0, prev: from.vatMassG, next: to.vatMassG, flag: deltas.vat, rate: null },
    { label: "Total BMD", unit: "g/cm²", digits: 3, prev: from.totalBmdGcm2, next: to.totalBmdGcm2, flag: deltas.bmd, rate: null },
    { label: "RMR", unit: "kcal/d", digits: 0, prev: prevTest?.measuredRmrKcal ?? null, next: lastTest?.measuredRmrKcal ?? null, flag: deltas.rmr, rate: null },
    { label: "RMR / FFM", unit: "kcal/kg", digits: 1, prev: rmrPerFfm(prevTest), next: rmrPerFfm(lastTest), flag: null, rate: null, noLsc: true },
    { label: "FFMI", unit: "kg/m²", digits: 2, prev: fi.ffmi, next: ti.ffmi, flag: null, rate: null, noLsc: true },
    { label: "ALMI", unit: "kg/m²", digits: 2, prev: fi.almi, next: ti.almi, flag: null, rate: null, noLsc: true },
  ];
  const comp = comparabilityPill(comparability);

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-medium text-muted">Latest vs previous</h2>
      <p className="mb-3 text-xs text-muted">
        {fmtDate(from.scannedAt)} → {fmtDate(to.scannedAt)} · {interval.days} days ·{" "}
        <span className={comp.cls} title={comp.title}>{comp.label}</span>
      </p>
      {comparability.demote && (
        <p className="mb-3 text-xs text-muted">Flags demoted one tier — {comparability.reasons.join("; ")}.</p>
      )}
      <div className={`${CARD} overflow-x-auto`}>
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="py-1 pr-2 font-medium">Metric</th>
              <th className="py-1 pr-2 text-right font-medium">Previous</th>
              <th className="py-1 pr-2 text-right font-medium">Latest</th>
              <th className="py-1 pr-2 text-right font-medium">Δ</th>
              <th className="py-1 pr-2 text-right font-medium">× LSC</th>
              <th className="py-1 pr-2 font-medium">Flag</th>
              <th className="py-1 font-medium">Comparability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/10">
            {rows.map((r) => {
              const delta = r.prev != null && r.next != null ? r.next - r.prev : null;
              const pill = r.flag ? flagPill(r.flag) : null;
              const hiddenDelta = comparability.hidden;
              return (
                <tr key={r.label} className="tabular-nums">
                  <td className="py-1.5 pr-2 text-ink">{r.label}<span className="ml-1 text-xs text-muted">{r.unit}</span></td>
                  <td className="py-1.5 pr-2 text-right">{num(r.prev, r.digits)}</td>
                  <td className="py-1.5 pr-2 text-right">{num(r.next, r.digits)}</td>
                  <td className="py-1.5 pr-2 text-right">
                    {hiddenDelta ? "—" : signed(delta, r.digits)}
                    {r.rate != null && <span className="block text-[10px] text-muted">{signed(r.rate, r.digits)} {r.unit} / 30 d</span>}
                  </td>
                  <td className="py-1.5 pr-2 text-right">{r.flag ? `${r.flag.multipleOfTechnical.toFixed(1)}×` : "—"}</td>
                  <td className="py-1.5 pr-2">
                    {pill ? <span className={pill.cls} title={pill.title}>{pill.label}</span> : <span className="text-xs text-muted">{r.noLsc ? "no LSC defined" : hiddenDelta ? "hidden" : "—"}</span>}
                  </td>
                  <td className="py-1.5">{delta == null ? <span className="text-xs text-muted">—</span> : <span className={comp.cls} title={comp.title}>{comp.label}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] text-muted">{BODY_COPY.lscFootnote}</p>
      </div>
    </section>
  );
}
