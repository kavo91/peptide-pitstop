import Link from "next/link";

/** Value-graded "redline" colour: low adherence reads red, mid orange, high
 *  green. Returns `rgb(var(--token))` strings — they resolve in SVG presentation
 *  attributes (stroke/fill) and inline style in this stack, and stay theme-aware
 *  so the LIGHT Gulf palette reads correctly (the old hardcoded hex did not). */
function gradeColor(pct: number | null): string {
  if (pct == null) return "rgb(var(--muted))";
  if (pct >= 85) return "rgb(var(--ok))"; // green — on track
  if (pct >= 60) return "rgb(var(--gauge-slip))"; // race-orange (light: amber) — slipping
  return "rgb(var(--danger))"; // red — in the red
}

/**
 * Pitstop Adherence stat card — a redline tachometer. The 90-day adherence %
 * sits inside a radial gauge whose arc + figure colour grade by value (red when
 * low), filling the stretched stat-cell like a dashboard tacho. The gauge + hero
 * numeral scale to the card width via container queries, so it stays the hero at
 * both the laptop (~300px) and iPhone (~170px) cell sizes.
 */
export function AdherenceTacho({ pct }: { pct: number | null }) {
  const v = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const color = gradeColor(pct);
  const R = 42;
  const CIRC = 2 * Math.PI * R;
  const dashOffset = CIRC * (1 - v / 100);
  const display = pct == null ? "—" : Math.round(pct);

  return (
    <Link href="/analytics" className="block h-full">
      <div
        className="relative flex h-full flex-col overflow-hidden rounded-card bg-surface p-4 pb-5 shadow-sm ring-1 ring-line/10"
        style={{ containerType: "inline-size" }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted" style={{ fontFamily: "var(--font-label), sans-serif" }}>
          Adherence
        </p>
        <div className="flex flex-1 items-center justify-center">
          <div className="relative" style={{ width: "clamp(100px, 64cqw, 160px)", aspectRatio: "1" }}>
            <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
              <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.08)" className="pitstop-gauge-track" strokeWidth="8" />
              <circle cx="50" cy="50" r={R} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={dashOffset} transform="rotate(-90 50 50)" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="flex items-baseline tabular-nums" style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "clamp(34px, 26cqw, 58px)", lineHeight: 0.8, color }}>
                {display}
                <span className="ml-0.5" style={{ fontSize: "clamp(14px, 10cqw, 22px)" }}>%</span>
              </span>
              <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted" style={{ fontFamily: "var(--font-label), sans-serif" }}>90-day</span>
            </div>
          </div>
        </div>
        <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: color }} aria-hidden />
      </div>
    </Link>
  );
}
