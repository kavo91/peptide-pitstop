/**
 * GaugeRing — the Apex-Line radial "tachometer" used across the Pitstop design
 * (dashboard recovery gauges + analytics adherence). An arc ring with the value
 * in the centre and an uppercase label beneath.
 *
 * Two sizing modes:
 *  - FIXED (default): `size="sm"` (46px) compact, `size="lg"` (64px) hero — the
 *    dashboard gauges. Centre figure is an HTML overlay.
 *  - FLUID (`fluid`): the gauge fills its container width up to a per-size cap
 *    (sm 64 / md 88 / lg 120 / xl 150) and stays square; the centre figure is
 *    SVG <text> so it scales WITH the ring. Used by the analytics adherence
 *    grid so the gauges resize to fit the card and Overall (xl) reads as the
 *    hero. Default (non-fluid) callers are byte-identical to before.
 *
 * `color` is applied as an SVG presentation attribute (and inline style on the
 * centre figure). Pass a `rgb(var(--token))` string — these resolve fine in SVG
 * stroke/fill and inline style in this stack, keeping the gauge theme-aware so
 * it stays legible on the LIGHT Gulf palette.
 */
const FLUID_MAX: Record<NonNullable<GaugeSize>, number> = { sm: 64, md: 88, lg: 120, xl: 150 };

type GaugeSize = "sm" | "md" | "lg" | "xl";

export function GaugeRing({
  value,
  min,
  max,
  color,
  display,
  unit,
  label,
  invert = false,
  size = "sm",
  fluid = false,
}: {
  value: number;
  min: number;
  max: number;
  color: string;
  display: number | string;
  unit?: string;
  label: string;
  invert?: boolean;
  size?: GaugeSize;
  fluid?: boolean;
}) {
  const raw = (value - min) / (max - min);
  const frac = Math.max(0, Math.min(1, invert ? 1 - raw : raw));

  if (fluid) {
    // Scalable: a 0..100 viewBox so the ring + SVG-text figure scale with width.
    const R = 40;
    const sw = 9;
    const CIRC = 2 * Math.PI * R;
    const maxW = FLUID_MAX[size];
    const numLen = String(display).length + (unit ? 1 : 0);
    const numSize = numLen >= 4 ? 26 : numLen === 3 ? 30 : 34; // shrink for "100%" etc.
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="w-full" style={{ maxWidth: maxW }}>
          <svg viewBox="0 0 100 100" className="h-auto w-full" role="img" aria-label={`${label}: ${display}${unit ?? ""}`}>
            <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.08)" className="pitstop-gauge-track" strokeWidth={sw} />
            <circle
              cx="50" cy="50" r={R} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
              strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - frac)} transform="rotate(-90 50 50)"
            />
            <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
              style={{ fill: color, fontWeight: 700, fontSize: numSize }} className="font-mono tabular-nums">
              {display}{unit && <tspan style={{ fontSize: numSize * 0.42 }} className="fill-muted">{unit}</tspan>}
            </text>
          </svg>
        </div>
        <span className="text-center text-[10px] font-medium uppercase tracking-wide text-muted">{label}</span>
      </div>
    );
  }

  // FIXED mode (dashboard) — unchanged from before (sm/lg only).
  const lg = size === "lg";
  const dim = lg ? 64 : 46;
  const c = dim / 2;
  const R = lg ? 26 : 18;
  const sw = lg ? 5 : 4;
  const CIRC = 2 * Math.PI * R;
  const dashOffset = CIRC * (1 - frac);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: dim, height: dim }}>
        <svg viewBox={`0 0 ${dim} ${dim}`} className="h-full w-full" aria-hidden="true">
          <circle cx={c} cy={c} r={R} fill="none" stroke="rgba(255,255,255,0.08)" className="pitstop-gauge-track" strokeWidth={sw} />
          <circle
            cx={c} cy={c} r={R} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={CIRC} strokeDashoffset={dashOffset} transform={`rotate(-90 ${c} ${c})`}
          />
        </svg>
        <div
          className={`absolute inset-0 flex items-center justify-center font-mono font-bold leading-none tabular-nums ${lg ? "text-xl" : "text-sm"}`}
          style={{ color }}
        >
          {display}
          {unit && <span className={`ml-0.5 font-medium text-muted ${lg ? "text-[9px]" : "text-[7px]"}`}>{unit}</span>}
        </div>
      </div>
      <span className="text-[9px] font-medium uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}
