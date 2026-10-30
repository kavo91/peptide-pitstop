/**
 * Eight Sleep bed metrics — last night beside the window average for the
 * numbers only the bed measures (sleeping HR, bed-sensor HRV, breath rate,
 * toss & turns, bed and room temperature). Unknown values print "—". Pure
 * presentational server component fed by the Eight Sleep `nights` series.
 */
import type { EightSleepNight } from "@/lib/eight-sleep-series";
import { average, formatDayKeyShort } from "@/lib/wearable-chart";
import { ChartCard, ChartEmpty } from "./chart-ui";

type Key = Exclude<keyof EightSleepNight, "date">;

const ROWS: { key: Key; label: string; unit: string; digits: number }[] = [
  { key: "sleepHrAvg", label: "Sleeping heart rate", unit: "bpm", digits: 0 },
  { key: "hrvMs", label: "HRV (bed sensor)", unit: "ms", digits: 0 },
  { key: "respirationAvg", label: "Breath rate", unit: "/min", digits: 1 },
  { key: "tossTurns", label: "Toss & turns", unit: "", digits: 0 },
  { key: "bedTempC", label: "Bed temperature", unit: "°C", digits: 1 },
  { key: "roomTempC", label: "Room temperature", unit: "°C", digits: 1 },
];

function fmt(v: number | null, digits: number, unit: string): string {
  if (v == null) return "—";
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

export function EightSleepBedCard({ nights }: { nights: EightSleepNight[] }) {
  const last = nights.length ? nights[nights.length - 1] : null;
  const shown = ROWS.filter((r) => nights.some((n) => n[r.key] != null));

  if (!last || !shown.length) {
    return <ChartCard title="Bed · Eight Sleep"><ChartEmpty /></ChartCard>;
  }

  return (
    <ChartCard title="Bed · Eight Sleep" sub={`last night ${formatDayKeyShort(last.date)}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] text-muted">
            <th className="pb-1 font-normal">Metric</th>
            <th className="pb-1 text-right font-normal">Last night</th>
            <th className="pb-1 text-right font-normal">{nights.length}-night avg</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key} className="border-t border-line/10">
              <td className="py-1.5">{r.label}</td>
              <td className="py-1.5 text-right tabular-nums">{fmt(last[r.key], r.digits, r.unit)}</td>
              <td className="py-1.5 text-right tabular-nums text-muted">
                {fmt(average(nights.map((n) => n[r.key])), r.digits, r.unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">
        From your Eight Sleep, shown beside Garmin — never mixed into Garmin&apos;s numbers.
      </p>
    </ChartCard>
  );
}
