/**
 * VialGlyph + helpers — the Peptide Pitstop inventory "fuel cell" treatment.
 *
 * A small dark-glass vial whose liquid fill height encodes remaining fraction
 * and whose colour encodes status: ok=green, low=race-orange (with a danger
 * redline mark), sealed=purple powder (dashed cake), finished=empty + dimmed.
 * Token-driven (rgb(var(--…))) via the `style` prop so it tracks the active
 * design palette — `var()` does NOT resolve in SVG presentation attributes,
 * only as real CSS properties. Pure (no client hooks) → safe in an RSC.
 *
 * Geometry mirrors docs/design/concepts/concept-pitstop-final.html (the chosen
 * board). Used only under DESIGN=pitstop; the current design never renders it.
 */
import type { VialView } from "@/lib/inventory";

export type VialState = "ok" | "low" | "sealed" | "finished";

/** Sector-best purple — a fixed motorsport accent with no palette token. */
const SEALED_PURPLE = "#B14EFF";

/** Classify a vial into a Pitstop fuel-cell state. */
export function vialState(v: VialView): VialState {
  if (v.status === "finished" || v.status === "discarded") return "finished";
  if (!v.prepared) return "sealed";
  if (v.daysLeft != null && v.daysLeft <= 7) return "low";
  return "ok";
}

/** Remaining fraction 0–1: remainingMl / initial mL (= label mg·1000 / conc). */
export function vialFill(v: VialView): number {
  const conc = Number(v.concentrationMcgPerMl);
  const rem = Number(v.remainingMl);
  if (!conc || !Number.isFinite(conc) || !Number.isFinite(rem) || rem <= 0) return 0;
  const initialMl = (Number(v.labelStrengthMg) * 1000) / conc;
  if (!initialMl || !Number.isFinite(initialMl)) return 0;
  return Math.max(0, Math.min(1, rem / initialMl));
}

export function VialGlyph({
  state,
  fill = 0,
  className = "",
}: {
  state: VialState;
  fill?: number;
  className?: string;
}) {
  const f = Math.max(0, Math.min(1, fill));
  const isSealed = state === "sealed";
  const isFinished = state === "finished";

  // Body interior runs y 13 → 47; liquid is anchored to the bottom.
  const maxH = 34;
  const bottom = 47;
  const liquidH = isSealed || isFinished ? 0 : Math.max(f > 0 ? 3 : 0, f * maxH);
  const liquidY = bottom - liquidH;

  const glass = { fill: "rgb(var(--surface))" } as const;
  const hair = isSealed
    ? { stroke: "rgba(177,78,255,0.4)" }
    : { stroke: "rgb(var(--ink) / 0.14)" };
  const liquidStyle =
    state === "low"
      ? { fill: "rgb(var(--accent) / 0.62)" }
      : { fill: "rgb(var(--ok) / 0.5)" };

  return (
    <svg
      width="24"
      height="46"
      viewBox="0 0 26 50"
      className={`shrink-0 ${className}`}
      role="img"
      aria-hidden="true"
      style={isFinished ? { opacity: 0.5 } : undefined}
    >
      {/* cap */}
      <rect x="6" y="2" width="14" height="5" rx="1.5" fill={isSealed ? SEALED_PURPLE : undefined} style={isSealed ? undefined : { fill: "rgb(var(--muted))" }} />
      {/* collar */}
      <rect x="4" y="7" width="18" height="5" rx="1.5" style={glass} {...hair} />
      {/* body */}
      <rect x="5" y="12" width="16" height="36" rx="4" style={glass} {...hair} />
      {/* liquid */}
      {liquidH > 0 && <rect x="6.5" y={liquidY} width="13" height={liquidH} rx="3" style={liquidStyle} />}
      {/* sealed lyophilised cake */}
      {isSealed && (
        <circle cx="13" cy="34" r="5" fill="none" stroke="rgba(177,78,255,0.5)" strokeWidth="1.4" strokeDasharray="2 2" />
      )}
      {/* low-fuel redline mark */}
      {state === "low" && <line x1="5" x2="21" y1="43" y2="43" strokeWidth="1" style={{ stroke: "rgb(var(--danger))" }} opacity="0.7" />}
    </svg>
  );
}

/** Thin horizontal "fuel gauge" — green ramp for ok, orange ramp for low. */
export function VialLevelBar({ state, fill }: { state: VialState; fill: number }) {
  const f = Math.max(0, Math.min(1, fill));
  const grad =
    state === "low"
      ? "linear-gradient(90deg, #c93f0a, rgb(var(--accent)))"
      : "linear-gradient(90deg, #1e9e4e, rgb(var(--ok)))";
  return (
    <div className="relative mt-2 h-[7px] w-full overflow-hidden rounded-full border border-line/15 bg-[rgb(var(--ink)/0.05)]">
      <div className="h-full rounded-full" style={{ width: `${Math.round(f * 100)}%`, background: grad }} />
    </div>
  );
}

const CHIP_STYLE: Record<VialState | "prep", string> = {
  low: "border border-accent/40 bg-accent/10 text-accent",
  ok: "border border-ok/40 bg-ok/10 text-ok",
  sealed: "border border-[#B14EFF]/40 bg-[#B14EFF]/10 text-[#B14EFF]",
  prep: "border border-warn/40 bg-warn/10 text-warn",
  finished: "border border-line/20 bg-line/[0.06] text-muted",
};

const CHIP_LABEL: Record<VialState | "prep", string> = {
  low: "Low",
  ok: "OK",
  sealed: "Sealed",
  prep: "Prep",
  finished: "Done",
};

/** Status chip in Pitstop's Rajdhani-label uppercase styling. */
export function VialStatusChip({ state }: { state: VialState | "prep" }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${CHIP_STYLE[state]}`}>
      {CHIP_LABEL[state]}
    </span>
  );
}
