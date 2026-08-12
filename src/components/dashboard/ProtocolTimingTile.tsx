import Link from "next/link";

export interface ProtocolRow {
  id: string;
  name: string;
  /** Compact schedule token, e.g. "DAILY", "MO·WE·FR", "EVERY 3D". */
  token: string;
  /** Daily cadence → rendered in cyan (the "every session" rows). */
  isDaily: boolean;
}

const MAX_ROWS = 6;

/**
 * Pitstop "Cycle" tile — a motorsport pit-wall timing board of the user's active
 * protocols: a POS index + peptide + a mono SCHED token per row, daily cadences
 * in cyan. Replaces the single "Day N" cycle readout (chosen design, 2026-06-24).
 * Caps at MAX_ROWS with a "+N more" footer; taps through to /protocols. Styled
 * entirely with the pitstop design tokens (rendered only under DESIGN=pitstop).
 */
export function ProtocolTimingTile({ protocols }: { protocols: ProtocolRow[] }) {
  const shown = protocols.slice(0, MAX_ROWS);
  const overflow = protocols.length - shown.length;
  const cols = "grid grid-cols-[18px_1fr_auto] items-center gap-2";

  return (
    <Link href="/protocols" className="block h-full">
      <div className="relative flex h-full flex-col overflow-hidden rounded-card bg-surface p-4 pb-5 shadow-sm ring-1 ring-line/10">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xl uppercase leading-none tracking-wide text-ink" style={{ fontFamily: "var(--font-display), sans-serif" }}>Cycle</span>
          <span className="tabular-nums text-[10px] font-semibold uppercase tracking-wide text-muted">{protocols.length} active</span>
        </div>

        {protocols.length === 0 ? (
          <p className="text-sm text-muted">No active protocols</p>
        ) : (
          <>
            <div className={`${cols} pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted`} style={{ fontFamily: "var(--font-label), sans-serif" }}>
              <span className="text-right" style={{ color: "rgb(var(--accent))" }}>#</span>
              <span>Peptide</span>
              <span className="text-right">Sched</span>
            </div>
            <div className="mb-0.5 h-px" style={{ background: "rgb(var(--accent))" }} />
            <div className="tabular-nums">
              {shown.map((p, i) => (
                <div key={p.id} className={`${cols} border-b border-line/[0.06] py-[3px] last:border-b-0`}>
                  <span className="text-right text-[11px] font-semibold" style={{ color: "rgb(var(--accent))" }}>{String(i + 1).padStart(2, "0")}</span>
                  <span className="truncate text-[12.5px] font-medium text-ink">{p.name}</span>
                  <span className={`text-right text-[11px] font-medium ${p.isDaily ? "" : "text-muted"}`} style={p.isDaily ? { color: "rgb(var(--accent-2))" } : undefined}>{p.token}</span>
                </div>
              ))}
              {overflow > 0 && (
                <div className={`${cols} py-[3px] text-[11px] font-semibold`} style={{ color: "rgb(var(--accent))" }}>
                  <span aria-hidden />
                  <span aria-hidden />
                  <span className="text-right">+{overflow} more</span>
                </div>
              )}
            </div>
          </>
        )}
        <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: "rgb(var(--accent))" }} aria-hidden />
      </div>
    </Link>
  );
}
