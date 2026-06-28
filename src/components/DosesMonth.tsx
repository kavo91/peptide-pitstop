import Link from "next/link";
import { Footprints, Moon, Clock, ChevronRight } from "lucide-react";
import { activityDisplay } from "@/lib/garmin-activity";
import type { DoseStatus, TimelineEntry } from "@/lib/doses-timeline-core";
import type { DayMetric } from "@/lib/month-metrics";
import { LEGEND_ORDER, STATUS_DESCRIPTION, STATUS_LABEL } from "@/lib/timeline-status";
import type { ManualDay } from "@/lib/wellness-log";
import { DayDetail } from "./DayDetail";

const DOW_LONG = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Next on the line" upcoming-dose summary, computed server-side. */
interface NextDose { peptideName: string; doseLabel: string; time: string | null; relDay: string }

function daysBetween(a: string, b: string): string[] {
  const out: string[] = []; const cur = new Date(a + "T00:00:00"); const end = new Date(b + "T00:00:00");
  while (cur <= end) { out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`); cur.setDate(cur.getDate() + 1); }
  return out;
}

/** Compact steps: 8400 → "8.4k", 12345 → "12k", 950 → "950". */
function fmtSteps(n: number): string {
  if (n < 1000) return `${n}`;
  const k = n / 1000;
  return `${k >= 10 ? Math.round(k) : Number(k.toFixed(1))}k`;
}

/** Compact sleep hours: 27000s → "7.5h", 25200s → "7h". */
function fmtSleepShort(seconds: number): string {
  return `${Number((seconds / 3600).toFixed(1))}h`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Screen-reader-friendly date for the status indicators' aria-labels. */
function humanDate(key: string): string {
  const dt = new Date(key + "T00:00:00");
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

// Non-colour status signal (WCAG 1.4.1 / touch-friendly): each status carries a
// distinct glyph + text colour, so meaning never relies on colour alone and is
// not hidden behind a hover-only title=. Used in the day cells AND the legend.
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

export function DosesMonth({ monthLabel, gridStart, gridEnd, entries, metrics, todayKey, wellnessByDay, hydrationTargetMl, symptoms, nav, nextDose }: { monthLabel: string; gridStart: string; gridEnd: string; entries: TimelineEntry[]; metrics: Record<string, DayMetric>; todayKey: string; wellnessByDay: Record<string, ManualDay>; hydrationTargetMl?: number | null; symptoms?: readonly string[]; nav: { prev: string; next: string; current: string; isCurrent: boolean }; nextDose?: NextDose }) {
  const days = daysBetween(gridStart, gridEnd);
  // Honest "logged / total" ratio for the month sub-heading.
  // total = scheduled days (any planned-or-taken status, same semantics as the
  // legend); logged = taken (on-time / shifted / off-schedule). Days only —
  // count distinct dates so a multi-dose day is one tick on each side.
  let loggedCount = 0;
  let totalCount = 0;
  {
    // The target month always contains gridStart + 10 days (gridStart is the
    // Monday on/before the 1st, so +10 lands inside the month). Use its YYYY-MM.
    const mid = new Date(gridStart + "T00:00:00");
    mid.setDate(mid.getDate() + 10);
    const monthYM = `${mid.getFullYear()}-${String(mid.getMonth() + 1).padStart(2, "0")}`;
    const inMonth = (k: string) => k.slice(0, 7) === monthYM;
    const TAKEN = new Set(["taken_ontime", "taken_rebased", "taken_offschedule"]);
    const SCHEDULED = new Set(["taken_ontime", "taken_rebased", "taken_offschedule", "planned", "missed"]);
    const loggedDays = new Set<string>();
    const totalDays = new Set<string>();
    for (const e of entries) {
      if (!inMonth(e.date)) continue;
      if (SCHEDULED.has(e.status)) totalDays.add(e.date);
      if (TAKEN.has(e.status)) loggedDays.add(e.date);
    }
    loggedCount = loggedDays.size;
    totalCount = totalDays.size;
  }
  return (
    <div>
      <div className="mb-3 max-[640px]:mb-2 flex items-center justify-between">
        <Link href={`/doses?view=month&month=${nav.prev}`} aria-label="Previous month" className="rounded-control px-3 py-1 text-sm ring-1 ring-line/15 hover:bg-bg">←</Link>
        <div className="flex items-center gap-3">
          <p className="font-medium">{monthLabel}</p>
          {!nav.isCurrent && <Link href={`/doses?view=month&month=${nav.current}`} className="text-xs font-medium text-accentStrong hover:underline">Today</Link>}
        </div>
        <Link href={`/doses?view=month&month=${nav.next}`} aria-label="Next month" className="rounded-control px-3 py-1 text-sm ring-1 ring-line/15 hover:bg-bg">→</Link>
      </div>
      <p className="-mt-1 mb-3 font-mono uppercase tracking-[0.16em] text-[11px] text-muted">{monthLabel} · {loggedCount} / {totalCount} LOGGED</p>
      <div className="grid grid-cols-7 gap-1 max-[640px]:gap-0.5 pitstop-cal">
        {DOW_LONG.map((d, i) => <div key={i} className="pb-1 text-center text-[9px] uppercase tracking-[0.08em] text-muted">{d}</div>)}
        {days.map((d) => {
          const dayEntries = entries.filter((e) => e.date === d);
          const m = metrics[d];
          const future = d > todayKey;
          return (
            <div key={d} className={`relative flex min-h-[4.25rem] max-[640px]:min-h-[4rem] flex-col rounded-control p-1 text-[10px] ring-1 lg:min-h-0 lg:h-[clamp(64px,11vh,104px)] ${d === todayKey ? "ring-accent" : "ring-line/10"} ${future ? "opacity-55" : ""}`}>
              <div className="flex items-center gap-1">
                <span className="tabular-nums">{Number(d.slice(8))}</span>
                {m && m.activities.length > 0 && (() => {
                  const disp = activityDisplay(m.activities[0].type);
                  const Icon = disp.icon;
                  const more = m.activities.length - 1;
                  return (
                    <span
                      className={`pointer-events-none flex items-center gap-px ${disp.colorClass}`}
                      aria-label={`Workout: ${disp.label}${more > 0 ? ` +${more} more` : ""}`}
                      title={m.activities.map((a) => activityDisplay(a.type).label).join(" · ")}
                    >
                      <Icon className="h-3 w-3 shrink-0" aria-hidden />
                      {more > 0 && <span className="tabular-nums leading-none">+{more}</span>}
                    </span>
                  );
                })()}
              </div>
              {wellnessByDay[d] && <span className="pointer-events-none absolute right-1 top-1 z-[2] h-1.5 w-1.5 rounded-full bg-accent2" aria-label="Wellness logged" />}
              <div className="mt-0.5 flex flex-wrap items-center gap-0.5">
                {dayEntries.slice(0, 4).map((e, i) => (
                  <span
                    key={i}
                    role="img"
                    aria-label={`${e.peptideName}: ${STATUS_LABEL[e.status]} — ${humanDate(d)}`}
                    title={`${STATUS_LABEL[e.status]} · ${e.peptideName}`}
                    className={`font-bold leading-none text-[9px] ${STATUS_TEXT_CLASS[e.status]}`}
                  >
                    {STATUS_GLYPH[e.status]}
                  </span>
                ))}
              </div>
              {/* Metrics stacked one-per-line — a single horizontal line overflows the
                  narrow phone cell. Pinned to the bottom so the date/dots stay put. */}
              {m && (m.steps != null || m.sleepSeconds != null) && (
                <div className="mt-auto space-y-px pt-0.5 text-[9px] leading-none text-muted">
                  {m.steps != null && (
                    <div className="flex items-center gap-0.5 overflow-hidden tabular-nums"><Footprints className="h-2.5 w-2.5 shrink-0" aria-hidden /><span className="truncate">{fmtSteps(m.steps)}</span></div>
                  )}
                  {m.sleepSeconds != null && (
                    <div className="flex items-center gap-0.5 overflow-hidden tabular-nums"><Moon className="h-2.5 w-2.5 shrink-0" aria-hidden /><span className="truncate">{fmtSleepShort(m.sleepSeconds)}</span></div>
                  )}
                </div>
              )}
              <DayDetail date={d} entries={entries} metric={m} wellness={wellnessByDay[d]} editable={!future} hydrationTargetMl={hydrationTargetMl} symptoms={symptoms} />
            </div>
          );
        })}
      </div>
      <div className="mt-4 max-[640px]:mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted">
        {LEGEND_ORDER.map((s) => (
          <span key={s} title={STATUS_DESCRIPTION[s]} className="inline-flex items-center gap-1">
            <span aria-hidden className={`inline-flex h-3.5 w-3.5 items-center justify-center font-bold leading-none text-[12px] ${STATUS_TEXT_CLASS[s]}`}>{STATUS_GLYPH[s]}</span>
            {STATUS_LABEL[s]}
          </span>
        ))}
        {(() => {
          const disp = activityDisplay("running");
          const Icon = disp.icon;
          return (
            <span className="flex items-center gap-1" title="A logged Garmin workout (run, ride, strength, swim, …) — colour + icon vary by activity type">
              <Icon className={`h-3 w-3 ${disp.colorClass}`} aria-hidden />Workout
            </span>
          );
        })()}
      </div>
      {/* Detailed Shifted/Off-schedule explainer — hidden on phones (legend labels
          above still convey the states) to keep the month view scroll-free. */}
      <p className="mt-1.5 text-[11px] leading-snug text-muted max-[640px]:hidden">
        <span className="font-medium text-accent2Strong">Shifted</span> {STATUS_DESCRIPTION.taken_rebased}{" "}
        <span className="font-medium text-warn">Off-schedule</span> {STATUS_DESCRIPTION.taken_offschedule}
      </p>
      {nextDose && (
        <Link href="/today" className="pitstop-slash-edge relative mt-4 flex items-center gap-3 rounded-card bg-surface p-3 ring-1 ring-line/10 transition-colors hover:ring-accent/40 lg:p-4">
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-accent/10 ring-1 ring-accent/30">
            <Clock className="h-[18px] w-[18px] text-accent" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="font-semibold uppercase tracking-[0.03em] text-[14px] leading-tight">Next on the line</div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-muted">{nextDose.peptideName} · {nextDose.doseLabel}{nextDose.relDay ? ` · ${nextDose.relDay}` : ""}{nextDose.time ? ` ${nextDose.time}` : ""}</div>
          </div>
          <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted" aria-hidden />
        </Link>
      )}
    </div>
  );
}
