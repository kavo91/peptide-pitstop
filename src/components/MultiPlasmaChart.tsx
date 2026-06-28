"use client";

import type { PlasmaPoint } from "@/lib/plasma";
import { splitSeriesAtNow } from "@/lib/plasma";
import { normalizeToPeak } from "@/lib/plasma-overlay";
import type { PeptidePlasma } from "@/lib/analytics";

interface Props {
  plasmaByPeptide: PeptidePlasma[];
  now: Date;
  /**
   * Dashboard mini-tile only: ALSO render a shorter-geometry copy that CSS swaps
   * in on phones (<=640px) so the curve fills the width undistorted at a compact
   * height, and hide the secondary captions. A CSS height-cap can't do this — a
   * fixed-aspect SVG letterboxes (side gutters) under preserveAspectRatio "meet".
   * Off everywhere else (full height + captions shown), e.g. /analytics.
   */
  compactOnPhone?: boolean;
  /**
   * Scheduled-but-not-logged dose times within the chart window. Rendered as
   * dashed-red vertical markers.
   */
  missedDoses?: Date[];
}

// Missed-dose marker red. `rgb(var(--token))` DOES resolve in SVG presentation
// attributes (stroke/fill) in this stack — see the per-peptide stroke lines below
// (`rgb(var(${ln.colorVar}))`) and the redline markers further down.
const MISSED_RED = "rgb(var(--danger))";

const WIDTH = 600;
const HEIGHT_FULL = 180;
const HEIGHT_PHONE = 108; // shorter geometry CSS-swaps in on the phone dashboard tile
const PAD = { top: 12, right: 12, bottom: 28, left: 8 };

// Per-peptide colour, indexed by order (cycles if there are more peptides than
// tokens). CSS-var tokens only — these resolve to the active light/dark theme.
// Ordered for maximum hue contrast between the FIRST peptides (teal→amber→green→
// red→cyan) so two overlaid curves are easy to tell apart (accent/accent-2 are
// too similar to sit adjacent).
const PALETTE = ["--accent", "--warn", "--ok", "--danger", "--accent-2-strong"] as const;

function toViewX(t: number, minT: number, maxT: number): number {
  const range = maxT - minT || 1;
  return PAD.left + ((t - minT) / range) * (WIDTH - PAD.left - PAD.right);
}

export function MultiPlasmaChart({
  plasmaByPeptide,
  now,
  compactOnPhone = false,
  missedDoses = [],
}: Props) {
  // Same guard as PlasmaChart: a series needs >= 2 points to draw a line.
  const renderable = plasmaByPeptide.filter((p) => p.series.length >= 2);
  if (renderable.length === 0) {
    return <p className="text-sm text-muted">Not enough data to render curve.</p>;
  }

  // Shared X axis: min/max across ALL series (they share plasmaFrom..plasmaTo).
  let minT = Infinity;
  let maxT = -Infinity;
  for (const p of renderable) {
    for (const pt of p.series) {
      const t = pt.t.getTime();
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
  }
  const nowMs = now.getTime();

  // Per-peptide draw data: colour + RAW normalised solid (actual) / dashed
  // (forecast) segments. Segments are height-independent; paths render per-height.
  const lines = renderable.map((p, idx) => {
    const colorVar = PALETTE[idx % PALETTE.length];
    const norm = normalizeToPeak(p.series);
    const { historical, forecast } = splitSeriesAtNow(norm, now);
    const showForecast = p.hasProjection && forecast.length >= 2;
    // Mean normalised level → z-orders the lines so the lowest sits in front.
    const mean = norm.length ? norm.reduce((s, pt) => s + pt.level, 0) / norm.length : 0;
    return {
      peptideId: p.peptideId,
      peptideName: p.peptideName,
      colorVar,
      mean,
      // No forecast → draw the solid line over the FULL series so the decay tail
      // past `now` is still bordered (mirrors PlasmaChart).
      historicalSeg: showForecast ? historical : norm,
      forecastSeg: showForecast ? forecast : null,
    };
  });

  // Draw the lowest-value lines LAST so they sit in the FOREGROUND rather than
  // being hidden behind taller lines. The legend keeps its stable order; only the
  // SVG paint order changes (higher mean painted first / behind).
  const drawOrder = [...lines].sort((a, b) => b.mean - a.mean);

  // nowX is height-independent (X scale only).
  const nowX = Math.max(
    PAD.left,
    Math.min(WIDTH - PAD.right, toViewX(nowMs, minT, maxT)),
  );

  // X-axis labels: locale-independent fixed "D Mon" (avoids the SSR/browser
  // hydration mismatch that toLocaleDateString causes). Same approach as PlasmaChart.
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const labelStart = fmt(new Date(minT));
  const labelEnd = fmt(new Date(maxT));

  // Missed-dose markers. Map each missed time onto the shared X scale, keep only
  // those inside the visible window, and de-dupe coincident x-positions so
  // overlapping markers don't double-paint. Height-independent.
  const missedX = Array.from(
    new Set(
      missedDoses
        .map((d) => d.getTime())
        .filter((t) => t >= minT && t <= maxT)
        .map((t) => Number(toViewX(t, minT, maxT).toFixed(1))),
    ),
  );

  // Intermediate x-axis date ticks. Three evenly-spaced points (25/50/75% of the
  // window) give faint gridlines + tick marks + centred date labels so the time
  // axis reads beyond the bare start/now/end labels. Height-independent X
  // positions; the verticals/labels paint per-height inside renderSvg. All x sit
  // inside [PAD.left, WIDTH - PAD.right] → no overflow.
  const axisTicks =
    maxT > minT
      ? [0.25, 0.5, 0.75].map((f) => {
          const t = minT + f * (maxT - minT);
          return { x: toViewX(t, minT, maxT), label: fmt(new Date(t)) };
        })
      : [];

  // Render the SVG at a given geometry HEIGHT. Phone vs full differ ONLY in the
  // viewBox height + Y mapping, so the curve fills the width undistorted at either
  // height (no letterboxing, no aspect distortion).
  const renderSvg = (HEIGHT: number) => {
    const toViewY = (level: number) =>
      PAD.top + (1 - level) * (HEIGHT - PAD.top - PAD.bottom);
    const toPath = (seg: PlasmaPoint[]) =>
      seg
        .map((pt, i) => {
          const x = toViewX(pt.t.getTime(), minT, maxT);
          const y = toViewY(pt.level);
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
    const bottomY = HEIGHT - PAD.bottom;
    return (
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-label="Combined plasma curves for all active peptides"
        className="w-full"
        style={{ height: "auto" }}
      >
        {/* Intermediate x-axis gridlines — faint verticals painted FIRST so they
            sit behind the curves. */}
        {axisTicks.map((tk, i) => (
          <line
            key={`grid-${i}`}
            x1={tk.x}
            y1={PAD.top}
            x2={tk.x}
            y2={bottomY}
            stroke="rgb(var(--muted))"
            strokeWidth="0.5"
            strokeOpacity="0.18"
          />
        ))}

        {/* Per-peptide lines: solid = actual, dashed = forecast, peptide colour.
            drawOrder paints lowest-value lines last (foreground). */}
        {drawOrder.map((ln) => (
          <g key={ln.peptideId}>
            <path
              d={toPath(ln.historicalSeg)}
              fill="none"
              stroke={`rgb(var(${ln.colorVar}))`}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {ln.forecastSeg && (
              <path
                d={toPath(ln.forecastSeg)}
                fill="none"
                stroke={`rgb(var(${ln.colorVar}))`}
                strokeWidth="1.5"
                strokeDasharray="4 3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </g>
        ))}

        {/* Missed-dose markers — DOTTED red verticals topped with a small
            downward flag at each scheduled-but-not-logged dose time. The dotted
            pattern + event flag read as discrete markers, distinct from the
            peptide-coloured DASHED forecast curves (differentiated by marker +
            dash style + colour, not dash alone). */}
        {missedX.map((x, i) => (
          <g key={`missed-${i}`}>
            <path
              d={`M${(x - 3).toFixed(1)},${PAD.top} L${(x + 3).toFixed(1)},${PAD.top} L${x.toFixed(1)},${(PAD.top + 4).toFixed(1)} Z`}
              fill={MISSED_RED}
            />
            <line
              x1={x}
              y1={PAD.top + 4}
              x2={x}
              y2={bottomY}
              stroke={MISSED_RED}
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeDasharray="0.5 4"
            />
          </g>
        ))}

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
            <text x={nowX + 3} y={PAD.top + 8} fontSize="9" fill="rgb(var(--muted))">
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

        {/* Intermediate x-axis ticks + centred date labels — fill in the gap
            between the start/now/end labels. */}
        {axisTicks.map((tk, i) => (
          <g key={`tick-${i}`}>
            <line
              x1={tk.x}
              y1={bottomY}
              x2={tk.x}
              y2={bottomY + 3}
              stroke="rgb(var(--muted))"
              strokeWidth="0.5"
              strokeOpacity="0.4"
            />
            <text
              x={tk.x}
              y={HEIGHT - 6}
              fontSize="9"
              fill="rgb(var(--muted))"
              textAnchor="middle"
            >
              {tk.label}
            </text>
          </g>
        ))}

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
    );
  };

  // Captions hidden only on the compact phone tile (vertical-space budget).
  const phoneHide = compactOnPhone ? " max-[640px]:hidden" : "";

  return (
    <div>
      {/* Subtitle */}
      <p className={`mb-1 text-xs font-medium text-muted${phoneHide}`}>
        Relative plasma level — each peptide scaled to its own peak
      </p>

      {/* compactOnPhone: render BOTH geometries; CSS swaps by breakpoint (pure
          CSS → no JS, no hydration mismatch, no post-mount layout shift, correct
          height from first paint). Otherwise a single full-height chart. */}
      {compactOnPhone ? (
        <>
          <div className="max-[640px]:hidden">{renderSvg(HEIGHT_FULL)}</div>
          <div className="hidden max-[640px]:block">{renderSvg(HEIGHT_PHONE)}</div>
        </>
      ) : (
        renderSvg(HEIGHT_FULL)
      )}

      {/* Legend: one row per peptide (colour swatch + name) */}
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted">
        {lines.map((ln) => (
          <li key={ln.peptideId} className="inline-flex items-center gap-1.5">
            <svg width="16" height="6" aria-hidden="true">
              <line
                x1="0"
                y1="3"
                x2="16"
                y2="3"
                stroke={`rgb(var(${ln.colorVar}))`}
                strokeWidth="2"
              />
            </svg>
            {ln.peptideName}
          </li>
        ))}
        {/* Missed-dose legend entry — only when markers exist. */}
        {missedX.length > 0 && (
          <li className="inline-flex items-center gap-1.5">
            <svg width="16" height="6" aria-hidden="true">
              {/* DOTTED red — mirrors the dotted chart markers and reads apart
                  from the solid peptide swatches + the "dashed = forecast" cue. */}
              <line
                x1="0"
                y1="3"
                x2="16"
                y2="3"
                stroke={MISSED_RED}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="0.5 3"
              />
            </svg>
            Missed dose
          </li>
        )}
      </ul>
      <p className={`mt-1 text-[10px] text-muted${phoneHide}`}>solid = actual · dashed = forecast</p>
      {/* Redundant with the page-footer disclaimer; hidden on the compact phone tile. */}
      <p className={`mt-1 text-[10px] text-muted${phoneHide}`}>
        Half-life estimate only — not a measured concentration. Not medical advice.
      </p>
    </div>
  );
}
