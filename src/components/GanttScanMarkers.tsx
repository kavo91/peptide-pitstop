/**
 * DEXA scan markers for the protocol Gantt: one thin vertical line per scan
 * whose calendar day falls inside the viewing window, positioned by the same
 * geometry as the today line (`dayCentrePercent`). Server-rendered, no
 * interaction — the page computes the percentages, this only draws them.
 *
 * Two placements share the component: the axis strip (`tag` set) carries the
 * small "DEXA" label above the line; each protocol row draws the line only,
 * in the same overlay layer as its today line.
 */

import { BODY_COPY } from "@/lib/bodycomp-copy";

export interface GanttScanMarker {
  id: string;
  /** Local calendar day "YYYY-MM-DD" (BodyCompScan.localDay). */
  day: string;
  /** Centre of that day as a percentage of the window. */
  pct: number;
  /** Human-readable day for the title attribute (e.g. "4 Jun"). */
  label: string;
}

/** Legend text and the axis tag live in BODY_COPY so the causal-verb lint covers them. */
export const SCAN_MARKER_COPY = {
  legend: BODY_COPY.ganttScanLegend,
  tag: BODY_COPY.ganttScanTag,
} as const;

export function GanttScanMarkers({ markers, tag = false }: { markers: GanttScanMarker[]; tag?: boolean }) {
  if (markers.length === 0) return null;
  return (
    <>
      {markers.map((m) => (
        <span
          key={m.id}
          className="pointer-events-none absolute inset-y-0 w-px bg-accent2Strong/70"
          style={{ left: `${m.pct}%` }}
          data-scan-marker={m.day}
          title={`${SCAN_MARKER_COPY.legend} — ${m.label}`}
          aria-hidden
        >
          {tag && (
            <span className="absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap text-[9px] font-medium leading-none text-accent2Strong">
              {SCAN_MARKER_COPY.tag}
            </span>
          )}
        </span>
      ))}
    </>
  );
}
