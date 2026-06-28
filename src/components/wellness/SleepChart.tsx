/**
 * Sleep chart — per-night stacked sleep stages (deep / light / REM / awake) in
 * hours, with the nightly sleep score overlaid as a 0–100 line + markers.
 * Pure presentational server component fed by the wearable `sleep` series.
 */
import type { SleepPoint } from "@/lib/wearable-series";
import {
  secondsToHours,
  average,
  formatDayKeyShort,
  buildLinePath,
} from "@/lib/wearable-chart";
import { ChartCard, ChartEmpty, Legend } from "./chart-ui";

const WIDTH = 600;
// Taller than its natural 3:1 so the single-panel Sleep card fills the height of
// the two-panel Recovery card beside it in the lg:grid-cols-2 row (measured: a
// 264px-wide column needs ~182px of SVG → viewBox height ~414 to match). The
// chart is fully parametric on HEIGHT, so the bars/score line just gain vertical
// resolution; chrome (title + legend) is unchanged.
const HEIGHT = 414;
const PAD = { top: 14, right: 30, bottom: 30, left: 30 };

// Stage paint order from the bottom of the stack up. CSS-var tokens only.
const STAGES = [
  { key: "deep", label: "Deep", color: "rgb(var(--accent))", opacity: 0.95 },
  { key: "light", label: "Light", color: "rgb(var(--accent))", opacity: 0.4 },
  { key: "rem", label: "REM", color: "rgb(var(--accent-2-strong))", opacity: 0.75 },
  { key: "awake", label: "Awake", color: "rgb(var(--muted))", opacity: 0.5 },
] as const;

export function SleepChart({ sleep, detailHref }: { sleep: SleepPoint[]; detailHref?: string }) {
  const nights = sleep.map((p) => {
    const stages = {
      deep: secondsToHours(p.deep) ?? 0,
      light: secondsToHours(p.light) ?? 0,
      rem: secondsToHours(p.rem) ?? 0,
      awake: secondsToHours(p.awake) ?? 0,
    };
    const total = stages.deep + stages.light + stages.rem + stages.awake;
    return { date: p.date, stages, total, score: p.score };
  });

  const hasStages = nights.some((n) => n.total > 0);
  const hasScore = nights.some((n) => n.score != null);

  if (!hasStages && !hasScore) {
    return <ChartCard title="Sleep"><ChartEmpty /></ChartCard>;
  }

  // Sleep duration excludes the awake band (time awake in bed isn't "sleep").
  const avgSleep = average(
    nights.map((n) => (n.total > 0 ? n.stages.deep + n.stages.light + n.stages.rem : null)),
  );
  const avgScore = average(nights.map((n) => n.score));

  const chartW = WIDTH - PAD.left - PAD.right;
  const chartH = HEIGHT - PAD.top - PAD.bottom;
  const bottomY = HEIGHT - PAD.bottom;
  const axisMax = Math.max(1, Math.ceil(Math.max(...nights.map((n) => n.total), 0)));

  const step = chartW / Math.max(nights.length, 1);
  const barW = Math.min(step * 0.7, 26);
  const yFor = (h: number) => bottomY - (h / axisMax) * chartH;
  const scoreY = (s: number) => PAD.top + (1 - s / 100) * chartH;

  // Score polyline (gap-aware): one x per night, centred on its bar.
  const scorePts = nights.map((n, i) =>
    n.score == null
      ? null
      : { x: PAD.left + step * i + step / 2, y: scoreY(n.score) },
  );

  return (
    <ChartCard
      title="Sleep"
      href={detailHref}
      sub={[
        avgSleep != null ? `avg ${avgSleep.toFixed(1)} h` : null,
        avgScore != null ? `score ${Math.round(avgScore)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-label="Nightly sleep stages and sleep score"
        className="w-full"
        style={{ height: "auto" }}
      >
        {/* Y gridline labels (hours) */}
        <text x={PAD.left - 4} y={PAD.top + 3} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">
          {axisMax}h
        </text>
        <text x={PAD.left - 4} y={bottomY} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">
          0
        </text>

        {/* Stacked stage bars */}
        {nights.map((n, i) => {
          if (n.total <= 0) return null;
          const x = PAD.left + step * i + (step - barW) / 2;
          let cursor = bottomY;
          return (
            <g key={n.date}>
              {STAGES.map((s) => {
                const h = n.stages[s.key];
                if (h <= 0) return null;
                const barH = (h / axisMax) * chartH;
                cursor -= barH;
                return (
                  <rect
                    key={s.key}
                    x={x.toFixed(1)}
                    y={cursor.toFixed(1)}
                    width={barW.toFixed(1)}
                    height={barH.toFixed(1)}
                    fill={s.color}
                    fillOpacity={s.opacity}
                    rx="1"
                  />
                );
              })}
            </g>
          );
        })}

        {/* Sleep-score line (0–100) + markers */}
        <path
          d={buildLinePath(scorePts)}
          fill="none"
          stroke="rgb(var(--warn))"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {scorePts.map((pt, i) =>
          pt ? (
            <circle key={i} cx={pt.x.toFixed(1)} cy={pt.y.toFixed(1)} r="2" fill="rgb(var(--warn))" />
          ) : null,
        )}

        {/* X-axis baseline */}
        <line
          x1={PAD.left}
          y1={bottomY}
          x2={WIDTH - PAD.right}
          y2={bottomY}
          stroke="rgb(var(--muted))"
          strokeWidth="0.5"
          strokeOpacity="0.4"
        />

        {/* X-axis date labels (first + last) */}
        <text x={PAD.left} y={HEIGHT - 8} fontSize="9" fill="rgb(var(--muted))">
          {formatDayKeyShort(nights[0].date)}
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 8} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">
          {formatDayKeyShort(nights[nights.length - 1].date)}
        </text>
      </svg>

      <Legend
        items={[
          ...STAGES.map((s) => ({ label: s.label, color: s.color, opacity: s.opacity })),
          { label: "Score", color: "rgb(var(--warn))", line: true },
        ]}
      />
    </ChartCard>
  );
}
