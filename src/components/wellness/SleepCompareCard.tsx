/**
 * "Garmin vs Eight Sleep" card: how many nights each device saw, per-metric
 * averages over the nights both recorded (each device on its own, plus the
 * difference), HRV side by side only, and the neutral cross-device patterns
 * (or how many nights they still need). Pure presentational server component
 * fed by compareSleep(). Unknown values print "—".
 */
import type { SleepComparison } from "@/lib/sleep-compare";
import { formatDuration, formatSignedDiff, PATTERN_MIN_N } from "@/lib/sleep-compare";
import { ChartCard } from "./chart-ui";

function value(unit: "duration" | "score", v: number | null): string {
  if (v == null) return "—";
  return unit === "duration" ? formatDuration(v) : String(Math.round(v));
}

export function SleepCompareCard({ comparison, days }: { comparison: SleepComparison; days: number }) {
  const { coverage, differences, hrv, patterns, waiting } = comparison;
  const shown = differences.filter((d) => d.n > 0);

  return (
    <ChartCard title="Garmin vs Eight Sleep" sub={`last ${days} days`}>
      <p className="text-xs text-muted">
        {coverage.both} {coverage.both === 1 ? "night" : "nights"} both · {coverage.garminOnly} Garmin only ·{" "}
        {coverage.eightSleepOnly} Eight Sleep only
      </p>

      {coverage.both === 0 ? (
        <p className="py-4 text-center text-sm text-muted">No night with both devices yet.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-muted">
              <th className="pb-1 font-normal">Average</th>
              <th className="pb-1 text-right font-normal">Garmin</th>
              <th className="pb-1 text-right font-normal">Eight Sleep</th>
              <th className="pb-1 text-right font-normal">Difference</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => (
              <tr key={d.key} className="border-t border-line/10">
                <td className="py-1.5">
                  {d.label} <span className="text-[11px] text-muted">n={d.n}</span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{value(d.unit, d.garminAvg)}</td>
                <td className="py-1.5 text-right tabular-nums">{value(d.unit, d.eightSleepAvg)}</td>
                <td className={`py-1.5 text-right text-muted ${d.comparable ? "tabular-nums" : "text-[11px]"}`}>
                  {d.comparable ? formatSignedDiff(d) : "different definitions"}
                </td>
              </tr>
            ))}
            {hrv.n > 0 && (
              <tr className="border-t border-line/10">
                <td className="py-1.5">
                  HRV <span className="text-[11px] text-muted">n={hrv.n}</span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{hrv.garminAvg != null ? `${Math.round(hrv.garminAvg)} ms` : "—"}</td>
                <td className="py-1.5 text-right tabular-nums">{hrv.eightSleepAvg != null ? `${Math.round(hrv.eightSleepAvg)} ms` : "—"}</td>
                <td className="py-1.5 text-right text-[11px] text-muted">different sensors</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <p className="mt-1 text-[11px] text-muted">Difference = Eight Sleep minus Garmin, over nights both recorded. Scores use each device&apos;s own scale.</p>

      <h4 className="mt-4 text-xs font-semibold">Patterns</h4>
      {patterns.length > 0 && (
        <>
          <ul className="mt-1 space-y-1.5 text-sm">
            {patterns.map((p) => (
              <li key={p.id}>{p.text}</li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-muted">Several patterns are checked at once, so some gaps can appear by chance.</p>
        </>
      )}
      {waiting.length > 0 && (
        <ul className="mt-1 space-y-1 text-xs text-muted">
          {waiting.map((w) => (
            <li key={w.id}>
              {w.label}:{" "}
              {w.reason === "no-spread"
                ? "the same value every night so far, nothing to compare."
                : `Not enough nights yet (${w.have} of ${w.need} in each group).`}
            </li>
          ))}
        </ul>
      )}
      {patterns.length === 0 && waiting.length === 0 && (
        <p className="mt-1 text-xs text-muted">Not enough nights yet — patterns need {PATTERN_MIN_N} nights in each group.</p>
      )}
    </ChartCard>
  );
}
