import Link from "next/link";
import type { ShiftPanelData } from "@/lib/shift/server";

/**
 * Today's quiet pointer to the panel — renders only when there is something to
 * see, so Today stays silent by default. No facts duplicated here; it
 * only counts and links.
 */
export function ShiftNudge({ data }: { data: ShiftPanelData }) {
  if (data.unavailable) return null;
  // The nudge counts the combined plan's moves — the panel shows one
  // plan, so "3 changes" is what the reader will find there. The suggestion
  // count is kept as a guard for the case the panel cannot draw a plan from
  // (combined null) while single rotations still stand.
  const combined = data.plan.combined;
  const n = combined ? combined.moves.length : data.plan.suggestions.length;
  if (n === 0) return null;
  return (
    <div
      data-shift-nudge
      className="mb-4 flex items-center justify-between gap-3 rounded-card bg-surface p-3 text-sm ring-1 ring-line/10"
    >
      <p>
        {combined
          ? `Smooth your week: ${n} change${n === 1 ? "" : "s"} suggested.`
          : `Smooth your week: ${n} suggestion${n === 1 ? "" : "s"} to spread your doses across the week.`}
      </p>
      <Link
        href="/protocols#smooth-your-week"
        className="shrink-0 rounded-control bg-bg px-3 py-2 text-sm ring-1 ring-line/15"
      >
        See suggestions
      </Link>
    </div>
  );
}
