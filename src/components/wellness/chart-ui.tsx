/**
 * Small shared building blocks for the wearable wellness charts — the card
 * frame, the empty placeholder, and the swatch/line legend. Pure presentational
 * (server components); keeps the four chart files free of repeated chrome.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { WearableSource } from "@/lib/wearable-series";

export function ChartCard({
  title,
  sub,
  href,
  children,
}: {
  title: string;
  sub?: string;
  /** Optional link to the full-page chart-detail view. */
  href?: string;
  children: ReactNode;
}) {
  return (
    <div className="h-full rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex items-baseline gap-2">
          {sub && <span className="text-xs tabular-nums text-muted">{sub}</span>}
          {href && (
            <Link href={href} className="whitespace-nowrap text-xs font-medium text-accentStrong hover:underline">
              View →
            </Link>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

export function ChartEmpty() {
  return <p className="py-6 text-center text-sm text-muted">No data in this window.</p>;
}

export interface LegendItem {
  label: string;
  color: string;
  /** Swatch opacity (ignored for line items). */
  opacity?: number;
  /** Render as a line sample rather than a filled swatch. */
  line?: boolean;
  /** Dashed line sample. */
  dash?: boolean;
  /** Filled circle swatch (source dot: Garmin). */
  dot?: boolean;
  /** Hollow circle swatch (source dot: Apple Health). */
  ring?: boolean;
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          {it.line ? (
            <svg width="16" height="6" aria-hidden="true">
              <line
                x1="0"
                y1="3"
                x2="16"
                y2="3"
                stroke={it.color}
                strokeWidth="2"
                strokeDasharray={it.dash ? "4 3" : undefined}
              />
            </svg>
          ) : it.ring ? (
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: it.color }} />
          ) : it.dot ? (
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: it.color, opacity: it.opacity ?? 1 }} />
          ) : (
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: it.color, opacity: it.opacity ?? 1 }}
            />
          )}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** True if any day in the window was sourced from / filled by Apple Health. */
export function hasHealthkitSource(sources: (WearableSource | undefined)[]): boolean {
  return sources.some((s) => s === "healthkit" || s === "mixed");
}

/** Per-day source dots drawn inside a chart SVG — one small mark per day at the
 *  chart's x-positions (filled = Garmin, hollow ring = Apple Health / mixed),
 *  each with a native `<title>` tooltip. Renders nothing when no day involved
 *  Apple Health, so garmin-only charts stay clean. */
export function SourceDots({
  sources,
  xAt,
  y,
}: {
  sources: (WearableSource | undefined)[];
  xAt: (i: number) => number;
  y: number;
}) {
  if (!hasHealthkitSource(sources)) return null;
  return (
    <g>
      {sources.map((s, i) => {
        const cx = xAt(i).toFixed(1);
        const apple = s === "healthkit" || s === "mixed";
        const label = s === "healthkit" ? "Apple Health" : s === "mixed" ? "Garmin + Apple Health" : "Garmin";
        return apple ? (
          <circle key={i} cx={cx} cy={y} r="2.2" fill="none" stroke="rgb(var(--accent-2-strong))" strokeWidth="1.2">
            <title>{label}</title>
          </circle>
        ) : (
          <circle key={i} cx={cx} cy={y} r="1.5" fill="rgb(var(--muted))" fillOpacity="0.5">
            <title>{label}</title>
          </circle>
        );
      })}
    </g>
  );
}

/** Source legend items — only when Apple Health contributed (else empty). */
export function sourceLegendItems(sources: (WearableSource | undefined)[]): LegendItem[] {
  if (!hasHealthkitSource(sources)) return [];
  return [
    { label: "Garmin", color: "rgb(var(--muted))", dot: true },
    { label: "Apple Health", color: "rgb(var(--accent-2-strong))", ring: true },
  ];
}
