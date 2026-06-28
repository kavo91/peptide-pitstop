import type { Flag } from "@/lib/bloodwork";

export interface BiomarkerTrendProps {
  name: string;
  unit?: string | null;
  /** Sorted oldest → newest. */
  points: { date: Date; value: number; flag: Flag | null }[];
  referenceLow?: number | null;
  referenceHigh?: number | null;
  optimalLow?: number | null;
  optimalHigh?: number | null;
  /** Active design pack. Pitstop swaps the near-empty single-point chart for a
   *  compact "single reading" hint; "current" is byte-identical to before. */
  design?: "pitstop" | "current";
}

const WIDTH = 600;
const HEIGHT = 170;
const PAD = { top: 14, right: 14, bottom: 26, left: 36 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
}

/** Semantic colour for a point/flag — ok/warn/danger, reserved (never decorative). */
function flagColor(flag: Flag | null): string {
  switch (flag) {
    case "borderline": return "rgb(var(--warn))";
    case "low":
    case "high": return "rgb(var(--danger))";
    case "normal": return "rgb(var(--ok))";
    default: return "rgb(var(--muted))";
  }
}

export function BiomarkerTrend({
  name,
  unit,
  points,
  referenceLow,
  referenceHigh,
  optimalLow,
  optimalHigh,
  design,
}: BiomarkerTrendProps) {
  if (points.length === 0) return null;

  const latest = points[points.length - 1];

  // Single reading → a trend chart is just one dot with no line, reading as
  // near-empty (flagged on mobile during the ultra-wide audit). Under pitstop,
  // show the value + date with a compact hint to log another panel instead.
  // "current" keeps the original single-point chart (byte-identical).
  if (design === "pitstop" && points.length === 1) {
    return (
      <div className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-ink">{name}</p>
          <p className="text-sm tabular-nums" style={{ color: flagColor(latest.flag) }}>
            {latest.value}
            {unit ? <span className="ml-1 text-xs text-muted">{unit}</span> : null}
          </p>
        </div>
        <p className="text-[11px] text-muted">{fmtDate(latest.date)}</p>
        <p className="mt-2 rounded-control bg-line/[0.06] px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-muted ring-1 ring-line/10">
          Single reading — log another panel to see a trend
        </p>
      </div>
    );
  }

  // ── Y domain — encompass all values AND any band bounds, with headroom. ──
  const ys = points.map((p) => p.value);
  for (const b of [referenceLow, referenceHigh, optimalLow, optimalHigh]) {
    if (b != null) ys.push(b);
  }
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const span = hi - lo;
  lo -= span * 0.1;
  hi += span * 0.1;

  const plotTop = PAD.top;
  const plotBottom = HEIGHT - PAD.bottom;
  const plotLeft = PAD.left;
  const plotRight = WIDTH - PAD.right;

  const yOf = (v: number) => {
    const raw = plotTop + (1 - (v - lo) / (hi - lo)) * (plotBottom - plotTop);
    return Math.max(plotTop, Math.min(plotBottom, raw));
  };

  const times = points.map((p) => p.date.getTime());
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const centerX = (plotLeft + plotRight) / 2;
  const xOf = (t: number) =>
    minT === maxT ? centerX : plotLeft + ((t - minT) / (maxT - minT)) * (plotRight - plotLeft);

  const coords = points.map((p) => ({ x: xOf(p.date.getTime()), y: yOf(p.value), flag: p.flag }));
  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

  const hasRefBand = referenceLow != null && referenceHigh != null;
  const hasOptBand = optimalLow != null && optimalHigh != null;
  // Lone bounds (only one side specified) → dashed guide line instead of a band.
  const loneLines: { y: number; color: string; label: string }[] = [];
  if (!hasOptBand && optimalLow != null) loneLines.push({ y: yOf(optimalLow), color: "rgb(var(--ok))", label: "optimal" });
  if (!hasOptBand && optimalHigh != null) loneLines.push({ y: yOf(optimalHigh), color: "rgb(var(--ok))", label: "optimal" });

  const safeId = name.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "");

  return (
    <div className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{name}</p>
        <p className="text-sm tabular-nums" style={{ color: flagColor(latest.flag) }}>
          {latest.value}
          {unit ? <span className="ml-1 text-xs text-muted">{unit}</span> : null}
        </p>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-label={`${name} trend, ${points.length} reading(s)`}
        className="w-full"
        style={{ height: "auto" }}
      >
        {/* Reference band (lab interval) — neutral hairline fill */}
        {hasRefBand && (
          <rect
            x={plotLeft}
            y={yOf(referenceHigh!)}
            width={plotRight - plotLeft}
            height={Math.max(0, yOf(referenceLow!) - yOf(referenceHigh!))}
            fill="rgb(var(--line))"
            fillOpacity="0.12"
          />
        )}

        {/* Optimal band — semantic ok fill, sits inside the reference band */}
        {hasOptBand && (
          <rect
            x={plotLeft}
            y={yOf(optimalHigh!)}
            width={plotRight - plotLeft}
            height={Math.max(0, yOf(optimalLow!) - yOf(optimalHigh!))}
            fill="rgb(var(--ok))"
            fillOpacity="0.14"
          />
        )}

        {/* Lone optimal bound → dashed guide line */}
        {loneLines.map((l, i) => (
          <line
            key={`lone-${safeId}-${i}`}
            x1={plotLeft}
            y1={l.y}
            x2={plotRight}
            y2={l.y}
            stroke={l.color}
            strokeWidth="1"
            strokeDasharray="4 3"
            strokeOpacity="0.6"
          />
        ))}

        {/* X-axis baseline */}
        <line x1={plotLeft} y1={plotBottom} x2={plotRight} y2={plotBottom} stroke="rgb(var(--muted))" strokeWidth="0.5" strokeOpacity="0.4" />

        {/* Trend line (only meaningful with ≥2 points) */}
        {coords.length >= 2 && (
          <path d={linePath} fill="none" stroke="rgb(var(--muted))" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.7" />
        )}

        {/* Points — colour-coded by flag */}
        {coords.map((c, i) => (
          <circle key={`pt-${safeId}-${i}`} cx={c.x} cy={c.y} r="3.5" fill={flagColor(c.flag)} stroke="rgb(var(--surface))" strokeWidth="1" />
        ))}

        {/* Y-axis bound labels */}
        <text x={plotLeft - 4} y={plotTop + 3} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{hi.toPrecision(3)}</text>
        <text x={plotLeft - 4} y={plotBottom} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{lo.toPrecision(3)}</text>

        {/* X-axis date labels */}
        {minT === maxT ? (
          <text x={centerX} y={HEIGHT - 6} fontSize="9" fill="rgb(var(--muted))" textAnchor="middle">{fmtDate(new Date(minT))}</text>
        ) : (
          <>
            <text x={plotLeft} y={HEIGHT - 6} fontSize="9" fill="rgb(var(--muted))">{fmtDate(new Date(minT))}</text>
            <text x={plotRight} y={HEIGHT - 6} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{fmtDate(new Date(maxT))}</text>
          </>
        )}
      </svg>

      <p className="mt-1 text-[10px] text-muted">
        {hasOptBand || loneLines.length ? "Shaded band = optimal target. " : ""}
        {hasRefBand ? "Grey band = lab reference. " : ""}Reference only — not medical advice.
      </p>
    </div>
  );
}
