/**
 * Supply / reorder tile — shows the soonest peptide that needs reordering.
 * Warn-coloured when status is reorder_now.
 *
 * Telemetry stat tile — leads with the big coverage-days number (mono, with a
 * small muted "days"), peptide name as a sub-line, an orange "Reorder" chip
 * pinned to the bottom when urgent, and a 3px bottom accent bar (orange when
 * urgent, line/30 otherwise).
 */
import Link from "next/link";
import type { PeptideReorder } from "@/lib/reorder";

interface Props {
  item: PeptideReorder | null;
}

export function SupplyTile({ item }: Props) {
  if (!item) {
    // Empty state.
    return (
      <div className="flex h-full flex-col gap-1 rounded-card bg-surface p-4 ring-1 ring-line/10 shadow-sm">
        <p className="text-xs font-medium text-muted">Supply</p>
        <p className="text-sm text-muted">No active protocols</p>
      </div>
    );
  }

  const urgent = item.status === "reorder_now";

  return (
    <Link href="/prescriptions" className="block h-full">
      <div
        className={`relative flex h-full flex-col overflow-hidden rounded-card p-4 pb-5 ring-1 shadow-sm ${
          urgent ? "bg-warn/10 ring-warn/20" : "bg-surface ring-line/10"
        }`}
        style={{ containerType: "inline-size" }}
      >
        <p
          className={`flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] ${urgent ? "text-accent" : "text-muted"}`}
          style={{ fontFamily: "var(--font-label), sans-serif" }}
        >
          <span>Supply</span>
          {urgent && (
            <span className="rounded-[3px] bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-accent ring-1 ring-accent/40">Reorder</span>
          )}
        </p>
        <div className="flex flex-1 items-center">
          <span
            className={`flex items-baseline ${urgent ? "text-accent" : "text-ink"}`}
            style={{ fontFamily: "var(--font-display), sans-serif", fontSize: item.coverageDays != null && String(item.coverageDays).length >= 3 ? "clamp(44px, 34cqw, 96px)" : "clamp(64px, 50cqw, 132px)", lineHeight: 0.78, letterSpacing: "-0.01em" }}
          >
            {item.coverageDays != null ? item.coverageDays : "—"}
            {item.coverageDays != null && (
              <span className="ml-2 text-muted" style={{ fontFamily: "var(--font-label), sans-serif", fontSize: "clamp(14px, 11cqw, 26px)", letterSpacing: "0.04em" }}>days</span>
            )}
          </span>
        </div>
        <p className="flex items-center gap-1.5 truncate text-[11px] tabular-nums text-muted" style={{ fontFamily: "var(--font-mono), monospace" }}>
          <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: urgent ? "rgb(var(--accent))" : "rgb(var(--muted))" }} aria-hidden />
          <span className="truncate text-ink">{item.peptideName}</span>
          <span className="shrink-0">· soonest</span>
        </p>
        <span className={`absolute inset-x-0 bottom-0 h-[3px] ${urgent ? "bg-accent" : "bg-line/30"}`} aria-hidden />
      </div>
    </Link>
  );
}
