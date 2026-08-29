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
  /** Active design pack — threaded from the form. Gates pitstop presentation. */
  design?: "pitstop" | "current";
  /**
   * Device rendering: a PEN dials a dose (dose-window graphic, "Dial to"),
   * a syringe draws to a barrel mark. Presentation only — every number shown
   * comes from the same computeDraw result either way.
   */
  device?: "syringe" | "pen";
}

export function VisualSyringe({ capacityMl, fillMl, markingLabel, overfill = false, multiUnit, design = "current", device = "syringe" }: Props) {
  const pit = design === "pitstop";
  const W = 260;
  const H = 64;
  const barrelX = 8;
  const barrelW = 210;
  const fraction = capacityMl > 0 ? Math.min(fillMl / capacityMl, 1) : 0;
  const fillW = barrelW * fraction;
  // Pitstop fills the barrel with a left→right orange gradient (literal hex —
  // var() does not resolve in SVG attrs). Current design unchanged.
  const fillColor = overfill
    ? "rgb(var(--danger))"
    : pit
      ? "url(#pitstop-syr-fill)"
      : "rgb(var(--accent))";

  // Graduation ticks at 0/25/50/75/100% of capacity.
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  if (device === "pen") {
    // Injection pen: the defining feature is the DOSE WINDOW — you dial a
    // number, you don't eyeball a barrel. The cartridge strip still shows the
    // fraction of the pen's max per-injection volume for a glanceable sense of
    // scale; the window carries the number that matters.
    const bodyX = 26;
    const bodyW = 190;
    const winW = 64;
    const winX = bodyX + bodyW / 2 - winW / 2;
    const strokeCol = "rgb(var(--muted))";
    const accent = overfill ? "rgb(var(--danger))" : pit ? "#FF5B14" : "rgb(var(--accent))";
    return (
      <figure className="w-full">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Pen dialled to ${markingLabel}`} className="w-full">
          {pit && (
            <defs>
              <linearGradient id="pitstop-pen-fill" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#b34110" />
                <stop offset="1" stopColor="#FF5B14" />
              </linearGradient>
            </defs>
          )}
          {/* cap (left) */}
          <rect x={4} y={20} width={20} height={24} rx={5} fill="rgb(var(--surface))" stroke={strokeCol} strokeWidth={1.5} />
          <line x1={9} y1={24} x2={9} y2={40} stroke={strokeCol} strokeWidth={1.5} opacity={0.6} />
          {/* body */}
          <rect x={bodyX} y={19} width={bodyW} height={26} rx={8} fill="rgb(var(--surface))" stroke={strokeCol} strokeWidth={1.5} />
          {/* cartridge fill strip along the lower body */}
          <rect x={bodyX + 4} y={38} width={bodyW - 8} height={4} rx={2} fill="rgb(var(--bg))" stroke={strokeCol} strokeWidth={0.5} opacity={0.8} />
          <rect x={bodyX + 4} y={38} width={Math.max((bodyW - 8) * fraction, overfill ? bodyW - 8 : 0)} height={4} rx={2} fill={overfill ? "rgb(var(--danger))" : pit ? "url(#pitstop-pen-fill)" : "rgb(var(--accent))"} opacity={0.9} />
          {/* dose window */}
          <rect x={winX} y={23} width={winW} height={13} rx={3} fill="rgb(var(--bg))" stroke={accent} strokeWidth={1.5} />
          <text x={winX + winW / 2} y={33} fontSize="10" textAnchor="middle" className="tabular-nums" fill={overfill ? "rgb(var(--danger))" : "rgb(var(--ink))"} fontWeight="600">
            {markingLabel}
          </text>
          {/* dial knob (right) with grip lines */}
          <rect x={bodyX + bodyW} y={22} width={26} height={20} rx={5} fill="rgb(var(--surface))" stroke={strokeCol} strokeWidth={1.5} />
          {[6, 12, 18].map((dx) => (
            <line key={dx} x1={bodyX + bodyW + dx} y1={25} x2={bodyX + bodyW + dx} y2={39} stroke={strokeCol} strokeWidth={1} opacity={0.5} />
          ))}
          {/* needle (far right) */}
          <line x1={bodyX + bodyW + 26} y1={32} x2={W - 2} y2={32} stroke={strokeCol} strokeWidth={2} />
        </svg>
        {pit ? (
          <figcaption className="mt-1 text-center font-mono uppercase text-[10px] tracking-[0.1em] text-accentStrong">
            Dial to {markingLabel}
          </figcaption>
        ) : (
          <figcaption className="mt-1 text-center text-sm font-medium tabular-nums">
            Dial to <span className={overfill ? "text-danger" : "text-accentStrong"}>{markingLabel}</span>
          </figcaption>
        )}
        {multiUnit && (
          <dl aria-label="Dose in all units" className="mt-2 grid grid-cols-4 gap-1 text-center text-xs tabular-nums">
            <div><dt className="text-muted">mcg</dt><dd>{multiUnit.mcg}</dd></div>
            <div><dt className="text-muted">mg</dt><dd>{multiUnit.mg}</dd></div>
            <div><dt className="text-muted">mL</dt><dd>{multiUnit.ml}</dd></div>
            <div><dt className="text-muted">units</dt><dd>{multiUnit.units}</dd></div>
          </dl>
        )}
      </figure>
    );
  }

  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Syringe filled to ${markingLabel}`} className="w-full">
        {pit && (
          <defs>
            <linearGradient id="pitstop-syr-fill" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#b34110" />
              <stop offset="1" stopColor="#FF5B14" />
            </linearGradient>
          </defs>
        )}
        {/* barrel */}
        <rect x={barrelX} y={18} width={barrelW} height={28} rx={4} fill="rgb(var(--surface))" stroke="rgb(var(--muted))" strokeWidth={1.5} />
        {/* fill */}
        <rect x={barrelX} y={18} width={fillW} height={28} rx={4} fill={fillColor} opacity={0.85} />
        {/* ticks */}
        {ticks.map((t) => (
          <line key={t} x1={barrelX + barrelW * t} y1={14} x2={barrelX + barrelW * t} y2={50} stroke="rgb(var(--muted))" strokeWidth={1} opacity={0.5} />
        ))}
        {/* pitstop dashed marker at the fill edge */}
        {pit && !overfill && (
          <line x1={barrelX + fillW} y1={12} x2={barrelX + fillW} y2={52} stroke="#FF5B14" strokeWidth={1.5} strokeDasharray="3 2" />
        )}
        {/* plunger + needle */}
        <rect x={barrelX + barrelW} y={22} width={18} height={20} rx={2} fill="rgb(var(--muted))" />
        <line x1={barrelX + barrelW + 18} y1={32} x2={W - 2} y2={32} stroke="rgb(var(--muted))" strokeWidth={2} />
      </svg>
      {pit ? (
        <figcaption className="mt-1 text-center font-mono uppercase text-[10px] tracking-[0.1em] text-accentStrong">
          Draw to {markingLabel}
        </figcaption>
      ) : (
        <figcaption className="mt-1 text-center text-sm font-medium tabular-nums">
          Draw to <span className={overfill ? "text-danger" : "text-accentStrong"}>{markingLabel}</span>
        </figcaption>
      )}
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
