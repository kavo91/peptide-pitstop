import type { AdherenceResult } from "@/lib/analytics-core";
import { GaugeRing } from "./GaugeRing";

interface Props {
  peptideName?: string; // omit for overall
  adherence: AdherenceResult;
  /** Active design pack — pitstop renders a compact radial gauge instead of a card. */
  design?: "pitstop" | "current";
  /** Gauge size for the pitstop branch (xl = the hero "Overall" gauge). */
  size?: "sm" | "md" | "lg" | "xl";
  /** Fluid gauge — fills its container (up to the size cap) so it resizes to fit the card. */
  fluid?: boolean;
}

/** Tachometer colour: green ≥80%, race-orange ≥50%, redline below. Returns
 *  `rgb(var(--token))` strings — these resolve fine in SVG presentation
 *  attributes (and inline style) in this stack, and keep the colours theme-aware
 *  so the LIGHT Gulf palette stays legible (the old hardcoded hex did not). */
function gradeColor(pct: number): string {
  if (pct >= 80) return "rgb(var(--ok))";
  if (pct >= 50) return "rgb(var(--gauge-slip))";
  return "rgb(var(--danger))";
}

export function AdherenceCard({ peptideName, adherence, design, size = "sm", fluid = false }: Props) {
  const { adherencePct, taken, missed, daysOfData } = adherence;
  const hasData = adherencePct !== null;

  // Pitstop: a compact radial gauge (cuts page height vs the stacked cards).
  if (design === "pitstop") {
    const label = peptideName ?? "Overall";
    if (!hasData) {
      return <GaugeRing value={0} min={0} max={100} display="—" label={label} color="rgb(var(--muted))" size={size} fluid={fluid} />;
    }
    return (
      <div className={`flex flex-col items-center ${fluid ? "w-full" : ""}`}>
        <GaugeRing
          value={adherencePct}
          min={0}
          max={100}
          display={adherencePct}
          unit="%"
          label={label}
          color={gradeColor(adherencePct)}
          size={size}
          fluid={fluid}
        />
        <span className="mt-0.5 font-mono text-[8px] text-muted tabular-nums">
          {taken}/{taken + missed}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      <p className="text-sm font-medium text-muted">
        {peptideName ?? "Overall"} adherence
      </p>

      {hasData ? (
        <>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {adherencePct}
            <span className="text-lg font-normal text-muted">%</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            {taken} taken · {missed} missed
            {daysOfData > 0 && (
              <span className="ml-1">· {daysOfData} day{daysOfData === 1 ? "" : "s"} of data</span>
            )}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">
          Adherence available once scheduling history accrues.
        </p>
      )}
    </div>
  );
}
