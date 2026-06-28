/**
 * Activity chart — daily steps as bars (primary 0→max axis) with VO2max overlaid
 * as an auto-scaled line, plus latest active-calories surfaced in the subhead.
 * Pure presentational server component fed by the wearable `activity` series.
 */
import type { ActivityPoint } from "@/lib/wearable-series";
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
const HEIGHT = 180;
const PAD = { top: 14, right: 30, bottom: 28, left: 34 };

const COL = { steps: "rgb(var(--accent))", vo2: "rgb(var(--accent-2-strong))" };

export function ActivityChart({ activity, detailHref }: { activity: ActivityPoint[]; detailHref?: string }) {
  const steps = activity.map((a) => a.steps);
  const vo2 = activity.map((a) => a.vo2max);
  const cals = activity.map((a) => a.caloriesActive);

  const hasSteps = steps.some((v) => v != null);
  const hasVo2 = vo2.some((v) => v != null);
  const hasCals = cals.some((v) => v != null);

  if (!hasSteps && !hasVo2 && !hasCals) {
    return <ChartCard title="Activity"><ChartEmpty /></ChartCard>;
  }

  const n = activity.length;
  const chartW = WIDTH - PAD.left - PAD.right;
  const chartH = HEIGHT - PAD.top - PAD.bottom;
  const bottomY = HEIGHT - PAD.bottom;
  const step = chartW / Math.max(n, 1);
  const barW = Math.min(step * 0.7, 22);

  const stepsMax = Math.max(...steps.map((v) => v ?? 0), 1);
  const yStep = (v: number) => bottomY - (v / stepsMax) * chartH;

  // VO2max overlay — auto-scaled to its own padded range (slow-moving metric).
  const vo2ex = extent(vo2);
  const vo2pad = vo2ex ? (vo2ex.max - vo2ex.min) * 0.2 || 1 : 0;
  const vo2lo = vo2ex ? vo2ex.min - vo2pad : 0;
  const vo2hi = vo2ex ? vo2ex.max + vo2pad : 1;
  const yVo2 = (v: number) => PAD.top + (1 - (v - vo2lo) / (vo2hi - vo2lo || 1)) * chartH;
  const vo2Pts: (XY | null)[] = vo2.map((v, i) =>
    v == null ? null : { x: PAD.left + step * i + step / 2, y: yVo2(v) },
  );

  const avgSteps = average(steps);
  const latestVo2 = latestNonNull(vo2);
  const latestCals = latestNonNull(cals);
  const sub = [
    avgSteps != null ? `avg ${Math.round(avgSteps).toLocaleString()} steps` : null,
    latestVo2 != null ? `VO₂max ${latestVo2}` : null,
    latestCals != null ? `${latestCals} active kcal` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ChartCard title="Activity" href={detailHref} sub={sub || undefined}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-label="Daily steps and VO2max" className="w-full" style={{ height: "auto" }}>
        {/* Steps Y axis: max label */}
        <text x={PAD.left - 4} y={PAD.top + 3} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">
          {stepsMax >= 1000 ? `${Math.round(stepsMax / 1000)}k` : stepsMax}
        </text>
        <text x={PAD.left - 4} y={bottomY} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">0</text>

        {/* Steps bars */}
        {steps.map((v, i) => {
          if (v == null || v <= 0) return null;
          const x = PAD.left + step * i + (step - barW) / 2;
          const y = yStep(v);
          return (
            <rect
              key={i}
              x={x.toFixed(1)}
              y={y.toFixed(1)}
              width={barW.toFixed(1)}
              height={(bottomY - y).toFixed(1)}
              fill={COL.steps}
              fillOpacity="0.55"
              rx="1"
            />
          );
        })}

        {/* VO2max overlay line + markers */}
        {hasVo2 && (
          <>
            <path d={buildLinePath(vo2Pts)} fill="none" stroke={COL.vo2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            {vo2Pts.map((pt, i) => (pt ? <circle key={i} cx={pt.x.toFixed(1)} cy={pt.y.toFixed(1)} r="2" fill={COL.vo2} /> : null))}
          </>
        )}

        {/* X-axis baseline + first/last date */}
        <line x1={PAD.left} y1={bottomY} x2={WIDTH - PAD.right} y2={bottomY} stroke="rgb(var(--muted))" strokeWidth="0.5" strokeOpacity="0.4" />
        <text x={PAD.left} y={HEIGHT - 6} fontSize="9" fill="rgb(var(--muted))">{formatDayKeyShort(activity[0].date)}</text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 6} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{formatDayKeyShort(activity[n - 1].date)}</text>
      </svg>

      <Legend
        items={[
          ...(hasSteps ? [{ label: "Steps", color: COL.steps, opacity: 0.55 }] : []),
          ...(hasVo2 ? [{ label: "VO₂max", color: COL.vo2, line: true }] : []),
        ]}
      />
    </ChartCard>
  );
}
