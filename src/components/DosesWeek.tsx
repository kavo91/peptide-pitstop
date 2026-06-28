import Link from "next/link";
import type { DoseStatus, TimelineEntry } from "@/lib/doses-timeline-core";
import { LEGEND_ORDER, STATUS_DESCRIPTION, STATUS_LABEL } from "@/lib/timeline-status";

const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function humanDate(key: string): string {
  const dt = new Date(key + "T00:00:00");
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

// Non-colour status signal (WCAG 1.4.1 / touch-friendly): each status carries a
// distinct glyph + text colour, so meaning never relies on colour alone and is
// not hidden behind a hover-only title=. Used in the cells AND the legend.
const STATUS_GLYPH: Record<DoseStatus, string> = {
  taken_ontime: "✓",
  taken_rebased: "↻",
  taken_offschedule: "!",
  planned: "○",
  missed: "✕",
};
const STATUS_TEXT_CLASS: Record<DoseStatus, string> = {
  taken_ontime: "text-ok",
  taken_rebased: "text-accent2Strong",
  taken_offschedule: "text-warn",
  planned: "text-accentStrong",
  missed: "text-danger",
};

export function DosesWeek({ days, entries, todayKey, nav }: { days: string[]; entries: TimelineEntry[]; todayKey: string; nav: { prev: string; next: string; current: string; isCurrent: boolean } }) {
  const peptides = [...new Map(entries.map((e) => [e.peptideId, e.peptideName])).entries()];
  return (
    <div className="overflow-x-auto">
      <div className="mb-3 flex items-center justify-between">
        <Link href={`/doses?view=week&weekStart=${nav.prev}`} aria-label="Previous week" className="rounded-control px-3 py-1 text-sm ring-1 ring-line/15 hover:bg-bg">←</Link>
        <div className="flex items-center gap-3">
          {!nav.isCurrent && <Link href={`/doses?view=week&weekStart=${nav.current}`} className="text-xs font-medium text-accentStrong hover:underline">Today</Link>}
        </div>
        <Link href={`/doses?view=week&weekStart=${nav.next}`} aria-label="Next week" className="rounded-control px-3 py-1 text-sm ring-1 ring-line/15 hover:bg-bg">→</Link>
      </div>
      <div className="grid grid-cols-[64px_repeat(7,1fr)] gap-1 text-center text-xs">
        <div />
        {days.map((d) => (
          <div key={d} className={`pb-1 ${d === todayKey ? "font-semibold text-accentStrong" : "text-muted"}`}>{DOW[new Date(d + "T00:00:00").getDay()]}<div className="tabular-nums">{Number(d.slice(8))}</div></div>
        ))}
        {peptides.map(([pid, name]) => (
          <div key={pid} className="contents">
            <div className="flex items-center text-left text-[11px] font-medium">{name}</div>
            {days.map((d) => {
              const e = entries.find((x) => x.peptideId === pid && x.date === d);
              return (
                <div key={d} className={`flex h-9 items-center justify-center rounded-control ${d === todayKey ? "bg-accent/10 ring-1 ring-inset ring-accent/40" : "bg-line/[0.05]"}`}>
                  {e && (
                    <span
                      role="img"
                      aria-label={`${name}: ${STATUS_LABEL[e.status]} — ${humanDate(d)}`}
                      title={`${STATUS_LABEL[e.status]} · ${name}`}
                      className={`inline-flex items-center justify-center font-bold leading-none text-[13px] ${STATUS_TEXT_CLASS[e.status]}`}
                    >
                      {STATUS_GLYPH[e.status]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {peptides.length === 0 && <p className="mt-4 text-center text-sm text-muted">No active protocols this week.</p>}
      <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-muted">
        {LEGEND_ORDER.map((s) => (
          <span key={s} title={STATUS_DESCRIPTION[s]} className="inline-flex items-center gap-1">
            <span aria-hidden className={`inline-flex h-3.5 w-3.5 items-center justify-center font-bold leading-none text-[12px] ${STATUS_TEXT_CLASS[s]}`}>{STATUS_GLYPH[s]}</span>
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted">
        <span className="font-medium text-accent2Strong">Shifted</span> {STATUS_DESCRIPTION.taken_rebased}{" "}
        <span className="font-medium text-warn">Off-schedule</span> {STATUS_DESCRIPTION.taken_offschedule}
      </p>
    </div>
  );
}
