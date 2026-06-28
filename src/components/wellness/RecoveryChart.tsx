/**
 * Recovery chart — two stacked panels fed by the wearable `recovery` series:
 *   1. Body Battery high/low band (0–100) with the average stress line.
 *   2. Resting HR (bpm) + overnight HRV (ms) trend — each line auto-scaled to
 *      its own range (the MultiPlasmaChart idiom), with latest values labelled.
 * Pure presentational server component.
 */
import type { RecoveryPoint } from "@/lib/wearable-series";
import {
  extent,
  average,
  latestNonNull,
  formatDayKeyShort,
  buildLinePath,
  type XY,
} from "@/lib/wearable-chart";
import { ChartCard, ChartEmpty, Legend } from "./chart-ui";

const WIDTH = 600;
const PANEL_H = 120;
const PAD = { top: 12, right: 30, bottom: 24, left: 30 };

const COL = {
  battery: "rgb(var(--accent))",
  stress: "rgb(var(--warn))",
  rhr: "rgb(var(--danger))",
  hrv: "rgb(var(--ok))",
};

function mapX(i: number, n: number): number {
  const chartW = WIDTH - PAD.left - PAD.right;
  const step = chartW / Math.max(n, 1);
  return PAD.left + step * i + step / 2;
}

/** Linear y for a fixed [lo, hi] range. */
function mapY(v: number, lo: number, hi: number): number {
  const chartH = PANEL_H - PAD.top - PAD.bottom;
  const range = hi - lo || 1;
  return PAD.top + (1 - (v - lo) / range) * chartH;
}

/** Auto-scaled [lo, hi] with ~12% headroom; falls back to v±1 for flat data. */
function paddedRange(values: (number | null)[]): { lo: number; hi: number } | null {
  const ex = extent(values);
  if (!ex) return null;
  const pad = (ex.max - ex.min) * 0.12 || 1;
  return { lo: ex.min - pad, hi: ex.max + pad };
}

export function RecoveryChart({ recovery, detailHref }: { recovery: RecoveryPoint[]; detailHref?: string }) {
  const n = recovery.length;
  const highs = recovery.map((r) => r.bodyBatteryHigh);
  const lows = recovery.map((r) => r.bodyBatteryLow);
  const stress = recovery.map((r) => r.stressAvg);
  const rhr = recovery.map((r) => r.restingHr);
  const hrv = recovery.map((r) => r.hrvMs);

  const hasBattery = highs.some((v) => v != null) || lows.some((v) => v != null);
  const hasStress = stress.some((v) => v != null);
  const hasRhr = rhr.some((v) => v != null);
  const hasHrv = hrv.some((v) => v != null);

  if (!hasBattery && !hasStress && !hasRhr && !hasHrv) {
    return <ChartCard title="Recovery"><ChartEmpty /></ChartCard>;
  }

  const bottomY = PANEL_H - PAD.bottom;
  const firstLabel = formatDayKeyShort(recovery[0].date);
  const lastLabel = formatDayKeyShort(recovery[n - 1].date);

  // Panel 1: Body Battery band (0–100) — filled polygons across contiguous runs
  // where both high and low are present, so gaps aren't bridged.
  const bandRuns: string[] = [];
  let run: { x: number; hi: number; lo: number }[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const top = run.map((p) => `${p.x.toFixed(1)},${p.hi.toFixed(1)}`);
      const bot = [...run].reverse().map((p) => `${p.x.toFixed(1)},${p.lo.toFixed(1)}`);
      bandRuns.push(`M${top.join(" L")} L${bot.join(" L")} Z`);
    }
    run = [];
  };
  recovery.forEach((r, i) => {
    if (r.bodyBatteryHigh != null && r.bodyBatteryLow != null) {
      run.push({ x: mapX(i, n), hi: mapY(r.bodyBatteryHigh, 0, 100), lo: mapY(r.bodyBatteryLow, 0, 100) });
    } else {
      flush();
    }
  });
  flush();
  const stressPts: (XY | null)[] = stress.map((v, i) =>
    v == null ? null : { x: mapX(i, n), y: mapY(v, 0, 100) },
  );

  // Panel 2: RHR + HRV, each auto-scaled to its own padded range.
  const rhrRange = paddedRange(rhr);
  const hrvRange = paddedRange(hrv);
  const rhrPts: (XY | null)[] = rhr.map((v, i) =>
    v == null || !rhrRange ? null : { x: mapX(i, n), y: mapY(v, rhrRange.lo, rhrRange.hi) },
  );
  const hrvPts: (XY | null)[] = hrv.map((v, i) =>
    v == null || !hrvRange ? null : { x: mapX(i, n), y: mapY(v, hrvRange.lo, hrvRange.hi) },
  );

  const latestStress = latestNonNull(stress);
  const latestRhr = latestNonNull(rhr);
  const latestHrv = latestNonNull(hrv);
  const avgBattery = average(highs);

  return (
    <ChartCard
      title="Recovery"
      href={detailHref}
      sub={avgBattery != null ? `Body Battery avg ${Math.round(avgBattery)}` : undefined}
    >
      {(hasBattery || hasStress) && (
        <>
          <p className="mb-1 text-[11px] font-medium text-muted">
            Body Battery {latestStress != null && <>· stress {latestStress}</>}
          </p>
          <svg viewBox={`0 0 ${WIDTH} ${PANEL_H}`} aria-label="Body Battery and stress" className="w-full" style={{ height: "auto" }}>
            {/* 0 / 50 / 100 gridlines */}
            {[0, 50, 100].map((g) => (
              <g key={g}>
                <line x1={PAD.left} y1={mapY(g, 0, 100)} x2={WIDTH - PAD.right} y2={mapY(g, 0, 100)} stroke="rgb(var(--muted))" strokeWidth="0.5" strokeOpacity="0.18" />
                <text x={PAD.left - 4} y={mapY(g, 0, 100) + 3} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{g}</text>
              </g>
            ))}
            {bandRuns.map((d, i) => (
              <path key={i} d={d} fill={COL.battery} fillOpacity="0.18" stroke="none" />
            ))}
            <path d={buildLinePath(stressPts)} fill="none" stroke={COL.stress} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <text x={PAD.left} y={PANEL_H - 6} fontSize="9" fill="rgb(var(--muted))">{firstLabel}</text>
            <text x={WIDTH - PAD.right} y={PANEL_H - 6} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{lastLabel}</text>
          </svg>
          <Legend
            items={[
              { label: "Body Battery (high–low)", color: COL.battery, opacity: 0.4 },
              ...(hasStress ? [{ label: "Stress avg", color: COL.stress, line: true }] : []),
            ]}
          />
        </>
      )}

      {(hasRhr || hasHrv) && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-medium text-muted">
            Resting HR &amp; HRV
            {latestRhr != null && <> · RHR {latestRhr} bpm</>}
            {latestHrv != null && <> · HRV {latestHrv} ms</>}
          </p>
          <svg viewBox={`0 0 ${WIDTH} ${PANEL_H}`} aria-label="Resting heart rate and HRV" className="w-full" style={{ height: "auto" }}>
            <line x1={PAD.left} y1={bottomY} x2={WIDTH - PAD.right} y2={bottomY} stroke="rgb(var(--muted))" strokeWidth="0.5" strokeOpacity="0.4" />
            <path d={buildLinePath(rhrPts)} fill="none" stroke={COL.rhr} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d={buildLinePath(hrvPts)} fill="none" stroke={COL.hrv} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <text x={PAD.left} y={PANEL_H - 6} fontSize="9" fill="rgb(var(--muted))">{firstLabel}</text>
            <text x={WIDTH - PAD.right} y={PANEL_H - 6} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{lastLabel}</text>
          </svg>
          <Legend
            items={[
              ...(hasRhr ? [{ label: "Resting HR (bpm)", color: COL.rhr, line: true }] : []),
              ...(hasHrv ? [{ label: "HRV (ms)", color: COL.hrv, line: true }] : []),
            ]}
          />
          <p className="mt-1 text-[10px] text-muted">RHR &amp; HRV each scaled to their own range.</p>
        </div>
      )}
    </ChartCard>
  );
}
