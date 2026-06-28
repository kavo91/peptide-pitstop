/**
 * Body composition chart — weight (kg) trend over the window, auto-scaled with
 * headroom so day-to-day variation is visible, with an area fill (PlasmaChart
 * idiom) and the latest weight + window delta labelled.
 *
 * NOTE: bodyFat% is intentionally not shown — the committed WeightPoint series
 * (src/lib/wearable-series.ts) only carries weightKg. Surfacing bodyFat would
 * need an additive field on that series + its test (see handoff notes).
 */
import type { WeightPoint } from "@/lib/wearable-series";
import { extent, formatDayKeyShort, buildLinePath, type XY } from "@/lib/wearable-chart";
import { ChartCard, ChartEmpty } from "./chart-ui";

const WIDTH = 600;
const HEIGHT = 170;
const PAD = { top: 14, right: 14, bottom: 28, left: 34 };

export function BodyCompositionChart({ weight, detailHref }: { weight: WeightPoint[]; detailHref?: string }) {
  if (weight.length === 0) {
    return <ChartCard title="Body composition"><ChartEmpty /></ChartCard>;
  }

  const latest = weight[weight.length - 1].weightKg;
  const first = weight[0].weightKg;
  const delta = weight.length >= 2 ? Math.round((latest - first) * 100) / 100 : null;
  const deltaStr = delta == null ? null : `${delta > 0 ? "+" : ""}${delta} kg`;

  if (weight.length === 1) {
    return (
      <ChartCard title="Body composition" sub="weight">
        <p className="font-mono text-2xl font-semibold tabular-nums text-ink">
          {latest}
          <span className="ml-1 text-xs font-normal text-muted">kg</span>
        </p>
        <p className="mt-1 text-xs text-muted">Only one reading in this window.</p>
      </ChartCard>
    );
  }

  const ex = extent(weight.map((w) => w.weightKg))!;
  const pad = (ex.max - ex.min) * 0.15 || 1;
  const lo = ex.min - pad;
  const hi = ex.max + pad;

  const chartW = WIDTH - PAD.left - PAD.right;
  const chartH = HEIGHT - PAD.top - PAD.bottom;
  const bottomY = HEIGHT - PAD.bottom;
  const stepX = chartW / (weight.length - 1);
  const xFor = (i: number) => PAD.left + i * stepX;
  const yFor = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * chartH;

  const pts: XY[] = weight.map((w, i) => ({ x: xFor(i), y: yFor(w.weightKg) }));
  const linePath = buildLinePath(pts);
  const areaPath =
    `M${pts[0].x.toFixed(1)},${bottomY} ` +
    pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
    ` L${pts[pts.length - 1].x.toFixed(1)},${bottomY} Z`;

  return (
    <ChartCard
      title="Body composition"
      href={detailHref}
      sub={`${latest} kg${deltaStr ? ` · ${deltaStr}` : ""}`}
    >
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-label="Weight trend" className="w-full" style={{ height: "auto" }}>
        <defs>
          <linearGradient id="weight-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.22" />
            <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Y axis: min / max weight labels */}
        <text x={PAD.left - 4} y={yFor(ex.max) + 3} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{ex.max}</text>
        <text x={PAD.left - 4} y={yFor(ex.min) + 3} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{ex.min}</text>

        <path d={areaPath} fill="url(#weight-area-grad)" />
        <path d={linePath} fill="none" stroke="rgb(var(--accent))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* X-axis baseline + first/last date */}
        <line x1={PAD.left} y1={bottomY} x2={WIDTH - PAD.right} y2={bottomY} stroke="rgb(var(--muted))" strokeWidth="0.5" strokeOpacity="0.4" />
        <text x={PAD.left} y={HEIGHT - 6} fontSize="9" fill="rgb(var(--muted))">{formatDayKeyShort(weight[0].date)}</text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 6} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{formatDayKeyShort(weight[weight.length - 1].date)}</text>
      </svg>
    </ChartCard>
  );
}
