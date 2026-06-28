"use client";

import type { PlasmaPoint } from "@/lib/plasma";
import { splitSeriesAtNow } from "@/lib/plasma";

interface Props {
  series: PlasmaPoint[];
  now: Date;
  peptideName: string;
  hasProjection: boolean;
}

const WIDTH = 600;
const HEIGHT = 160;
const PAD = { top: 12, right: 12, bottom: 28, left: 8 };

function toViewX(t: number, minT: number, maxT: number): number {
  const range = maxT - minT || 1;
  return PAD.left + ((t - minT) / range) * (WIDTH - PAD.left - PAD.right);
}

function toViewY(level: number, maxLevel: number): number {
  const range = maxLevel || 1;
  return PAD.top + (1 - level / range) * (HEIGHT - PAD.top - PAD.bottom);
}

export function PlasmaChart({ series, now, peptideName, hasProjection }: Props) {
  if (series.length < 2) {
    return (
      <p className="text-sm text-muted">Not enough data to render curve.</p>
    );
  }

  const times = series.map((p) => p.t.getTime());
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const maxLevel = Math.max(...series.map((p) => p.level), 0.001);
  const nowMs = now.getTime();

  // Build path for the area fill and the line
  const points = series.map((p) => ({
    x: toViewX(p.t.getTime(), minT, maxT),
    y: toViewY(p.level, maxLevel),
  }));

  // Split the series at `now` so the past (actual) and future (forecast) halves
  // can be drawn as two distinctly-coloured lines that join at the now-marker.
  // Both segments use the SAME scale functions so they line up exactly.
  const { historical, forecast } = splitSeriesAtNow(series, now);
  const toPath = (seg: PlasmaPoint[]) =>
    seg
      .map((p, i) => {
        const x = toViewX(p.t.getTime(), minT, maxT);
        const y = toViewY(p.level, maxLevel);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  const forecastPath = toPath(forecast);
  const showForecast = hasProjection && forecast.length >= 2;
  // When forecasting, the solid line is the historical segment and the dashed
  // forecast line carries the future. When NOT forecasting, draw the solid line
  // over the FULL series so the decay tail past `now` is bordered (matches the
  // area fill) rather than leaving filled area with no line.
  const historicalPath = toPath(showForecast ? historical : series);

  const bottomY = HEIGHT - PAD.bottom;
  const areaPath =
    `M${points[0].x.toFixed(1)},${bottomY} ` +
    points.map((pt) => `L${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ") +
    ` L${points[points.length - 1].x.toFixed(1)},${bottomY} Z`;

  // Vertical "now" marker (clamp to chart width if now is outside series range)
  const nowX = Math.max(
    PAD.left,
    Math.min(WIDTH - PAD.right, toViewX(nowMs, minT, maxT)),
  );

  // X-axis labels: start and end dates. Locale-independent (fixed "D Mon"
  // format) — toLocaleDateString(undefined, …) resolves to the runtime locale,
  // which differs between the SSR server (en-US) and the browser (en-AU) and
  // caused a hydration mismatch ("May 19" vs "19 May").
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const labelStart = fmt(new Date(minT));
  const labelEnd = fmt(new Date(maxT));

  // Sanitize peptide name for use as SVG id (replace spaces and special chars)
  const safeId = peptideName.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "");
  const gradientId = `area-grad-${safeId}`;

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">
        {peptideName} · relative plasma level (mcg-equiv)
        {hasProjection && <span className="ml-1 text-accentStrong"> + 7-day projection</span>}
      </p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-label={`Plasma curve for ${peptideName}`}
        className="w-full"
        style={{ height: "auto" }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.25" />
            <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Area fill */}
        <path
          d={areaPath}
          fill={`url(#${gradientId})`}
        />

        {/* Historical line — actual logged doses, up to now (solid accent) */}
        <path
          d={historicalPath}
          fill="none"
          stroke="rgb(var(--accent))"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Forecast line — resolver dose projection, from now (dashed warn) */}
        {showForecast && (
          <path
            d={forecastPath}
            fill="none"
            stroke="rgb(var(--warn))"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* "Now" vertical marker */}
        {nowMs >= minT && nowMs <= maxT && (
          <>
            <line
              x1={nowX}
              y1={PAD.top}
              x2={nowX}
              y2={bottomY}
              stroke="rgb(var(--muted))"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <text
              x={nowX + 3}
              y={PAD.top + 8}
              fontSize="9"
              fill="rgb(var(--muted))"
            >
              now
            </text>
          </>
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

        {/* X-axis date labels */}
        <text x={PAD.left} y={HEIGHT - 6} fontSize="9" fill="rgb(var(--muted))">
          {labelStart}
        </text>
        <text
          x={WIDTH - PAD.right}
          y={HEIGHT - 6}
          fontSize="9"
          fill="rgb(var(--muted))"
          textAnchor="end"
        >
          {labelEnd}
        </text>
      </svg>
      {/* Legend: solid = actual (historical), dashed = forecast (projection) */}
      <div className="mt-1 flex items-center gap-4 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="16" y2="3" stroke="rgb(var(--accent))" strokeWidth="1.5" />
          </svg>
          Actual
        </span>
        {hasProjection && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="16" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="16" y2="3" stroke="rgb(var(--warn))" strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            Forecast
          </span>
        )}
      </div>
      <p className="mt-1 text-[10px] text-muted">
        Half-life estimate only — not a measured concentration. Not medical advice.
      </p>
    </div>
  );
}
