/**
 * Visual syringe with a fill mark. Presentational only — fill is the fraction of
 * barrel capacity used. Shows the draw target in the syringe's native scale.
 */
interface Props {
  capacityMl: number;
  fillMl: number;
  markingLabel: string; // e.g. "50 units" or "0.50 mL"
  overfill?: boolean; // dose exceeds capacity
  /**
   * Optional four-unit breakdown of the TARGET dose (mcg / mg / mL / units),
   * shown beneath the caption. Omit for the unchanged single-label display.
   * Values are pre-stringified by `doseUnitBreakdown` (safe resolver path).
   */
  multiUnit?: { mcg: string; mg: string; ml: string; units: string };
}

export function VisualSyringe({ capacityMl, fillMl, markingLabel, overfill = false, multiUnit }: Props) {
  const W = 260;
  const H = 64;
  const barrelX = 8;
  const barrelW = 210;
  const fraction = capacityMl > 0 ? Math.min(fillMl / capacityMl, 1) : 0;
  const fillW = barrelW * fraction;
  // Fill the barrel with a left→right orange gradient (literal hex — var() does
  // not resolve in SVG attrs).
  const fillColor = overfill ? "rgb(var(--danger))" : "url(#pitstop-syr-fill)";

  // Graduation ticks at 0/25/50/75/100% of capacity.
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Syringe filled to ${markingLabel}`} className="w-full">
        <defs>
          <linearGradient id="pitstop-syr-fill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#b34110" />
            <stop offset="1" stopColor="#FF5B14" />
          </linearGradient>
        </defs>
        {/* barrel */}
        <rect x={barrelX} y={18} width={barrelW} height={28} rx={4} fill="rgb(var(--surface))" stroke="rgb(var(--muted))" strokeWidth={1.5} />
        {/* fill */}
        <rect x={barrelX} y={18} width={fillW} height={28} rx={4} fill={fillColor} opacity={0.85} />
        {/* ticks */}
        {ticks.map((t) => (
          <line key={t} x1={barrelX + barrelW * t} y1={14} x2={barrelX + barrelW * t} y2={50} stroke="rgb(var(--muted))" strokeWidth={1} opacity={0.5} />
        ))}
        {/* dashed marker at the fill edge */}
        {!overfill && (
          <line x1={barrelX + fillW} y1={12} x2={barrelX + fillW} y2={52} stroke="#FF5B14" strokeWidth={1.5} strokeDasharray="3 2" />
        )}
        {/* plunger + needle */}
        <rect x={barrelX + barrelW} y={22} width={18} height={20} rx={2} fill="rgb(var(--muted))" />
        <line x1={barrelX + barrelW + 18} y1={32} x2={W - 2} y2={32} stroke="rgb(var(--muted))" strokeWidth={2} />
      </svg>
      <figcaption className="mt-1 text-center font-mono uppercase text-[10px] tracking-[0.1em] text-accentStrong">
        Draw to {markingLabel}
      </figcaption>
      {multiUnit && (
        <dl
          aria-label="Dose in all units"
          className="mt-2 grid grid-cols-4 gap-1 text-center text-xs tabular-nums"
        >
          <div><dt className="text-muted">mcg</dt><dd>{multiUnit.mcg}</dd></div>
          <div><dt className="text-muted">mg</dt><dd>{multiUnit.mg}</dd></div>
          <div><dt className="text-muted">mL</dt><dd>{multiUnit.ml}</dd></div>
          <div><dt className="text-muted">units</dt><dd>{multiUnit.units}</dd></div>
        </dl>
      )}
    </figure>
  );
}
