/**
 * Protocol Gantt — the planner's one source of geometry.
 *
 * Turns each protocol's course plan (start/end dates + the WEEKS-based cycle
 * plan) into date-only segments over a fixed viewing window, so the page can
 * render "what runs together" as aligned bars. All calendar arithmetic lives
 * here, not in JSX, so every boundary is unit-testable against hand-derived
 * dates.
 *
 * Segment vocabulary:
 *   on         — committed dosing days: inside the course bounds, inside an
 *                on-block (or the whole span when there is no cycle plan).
 *   off        — a planned cycle break. Not dosing, by design.
 *   projected  — the cycle pattern CONTINUED past the protocol's own endDate.
 *                A repeating course only restarts when the user taps "start
 *                next cycle" (see app/actions/cycle.ts), so everything beyond
 *                the committed end renders as projection, never as fact.
 *
 * Date convention: inputs are the stored Prisma dates; this file normalises
 * them with startOfDay() exactly like lib/cycle/state and lib/protocol-bucket
 * do (the server runs in the home TZ, where Convention-1 UTC-midnight columns
 * land on the same calendar day). Mixing in getUTC* reads here would let this
 * surface disagree with the cycle chip beside it.
 */
import { startOfDay, addDays, daysBetween } from "./schedule/schedule";

export type GanttSegmentKind = "on" | "off" | "projected";

export interface GanttSegment {
  /** First day, inclusive, date-only. */
  from: Date;
  /** Last day, inclusive, date-only. */
  to: Date;
  kind: GanttSegmentKind;
}

export interface GanttProtocolInput {
  id: string;
  name: string;
  peptideName: string;
  status: string; // active | paused | completed
  startDate: Date | string | null;
  endDate: Date | string | null;
  cycleAnchor: Date | string | null;
  cycleOnWeeks: number | null;
  cycleOffWeeks: number | null;
}

export interface GanttRow {
  id: string;
  name: string;
  peptideName: string;
  status: "active" | "paused" | "completed";
  segments: GanttSegment[];
  /** No stop anywhere: no endDate and no terminal cycle plan. */
  openEnded: boolean;
  /** Dosing today: status active AND today classifies as a committed on-day. */
  onToday: boolean;
}

export interface GanttWindow {
  /** First visible day (a Sunday). */
  start: Date;
  /** Last visible day (a Saturday). */
  end: Date;
  /** Inclusive day count — always a multiple of 7. */
  days: number;
}

/** How far the window reaches. ~3 weeks of context back, 16 weeks of plan ahead. */
export const GANTT_BACK_DAYS = 21;
export const GANTT_FORWARD_DAYS = 112;

const planned = (weeks: number | null | undefined): weeks is number =>
  typeof weeks === "number" && Number.isFinite(weeks) && weeks > 0;

const toDay = (d: Date | string | null): Date | null => (d ? startOfDay(new Date(d)) : null);

/**
 * The viewing window around `today`, snapped outward to whole Sunday→Saturday
 * weeks so the axis ticks land on week starts.
 */
export function ganttWindow(today: Date): GanttWindow {
  const t = startOfDay(today);
  const start = addDays(t, -(GANTT_BACK_DAYS + t.getDay()));
  const rawEnd = addDays(t, GANTT_FORWARD_DAYS);
  const end = addDays(rawEnd, 6 - rawEnd.getDay());
  return { start, end, days: daysBetween(start, end) + 1 };
}

/**
 * Classify one day of one protocol, or null when the course does not cover it.
 *
 * Cycle arithmetic mirrors lib/cycle/state (anchor-relative, period = on+off):
 *   - days before the anchor but inside the course span are committed "on" —
 *     they belong to an earlier run whose plan is no longer derivable, and the
 *     course was demonstrably running (startNextCycle moves the anchor forward
 *     precisely so startDate keeps that history).
 *   - a non-repeating plan (no offWeeks) is terminal: nothing after its stop.
 *   - a repeating plan has no terminal stop; committed-vs-projected is decided
 *     by the protocol's endDate afterwards, in classifyDay's caller.
 */
function rawKindAt(args: {
  day: Date;
  anchor: Date | null;
  onWeeks: number | null;
  offWeeks: number | null;
}): GanttSegmentKind | null {
  const { day, anchor, onWeeks, offWeeks } = args;
  if (!planned(onWeeks) || !anchor) return "on";

  const e = daysBetween(anchor, day);
  if (e < 0) return "on"; // pre-anchor history inside the course span

  const onDays = onWeeks * 7;
  if (!planned(offWeeks)) {
    // Terminal: one on-block, then the course is over.
    return e < onDays ? "on" : null;
  }
  const period = onDays + offWeeks * 7;
  return e % period < onDays ? "on" : "off";
}

/** Compress per-day kinds into inclusive runs. */
function compress(days: { day: Date; kind: GanttSegmentKind }[]): GanttSegment[] {
  const out: GanttSegment[] = [];
  for (const { day, kind } of days) {
    const last = out[out.length - 1];
    if (last && last.kind === kind && daysBetween(last.to, day) === 1) {
      last.to = day;
    } else {
      out.push({ from: day, to: day, kind });
    }
  }
  return out;
}

/**
 * A protocol's visible row, or null when its course never intersects the
 * window (a long-completed revision, or a start queued beyond the horizon).
 */
export function ganttRow(p: GanttProtocolInput, window: GanttWindow, today: Date): GanttRow | null {
  const t = startOfDay(today);
  const start = toDay(p.startDate);
  const declaredEnd = toDay(p.endDate);
  const anchor = toDay(p.cycleAnchor) ?? start;
  const hasCycle = planned(p.cycleOnWeeks) && anchor !== null;
  const repeats = hasCycle && planned(p.cycleOffWeeks);

  // The course's committed hard stop, where one exists.
  //   no cycle        → endDate (open when null)
  //   terminal cycle  → the earlier of endDate and the block's own end
  //   repeating cycle → none (endDate only splits committed from projected)
  const planEnd = hasCycle ? addDays(anchor!, p.cycleOnWeeks! * 7 - 1) : null;
  let hardStop: Date | null;
  if (hasCycle && !repeats) {
    hardStop = declaredEnd && planEnd && declaredEnd < planEnd ? declaredEnd : planEnd;
  } else if (repeats) {
    hardStop = null; // projection continues past declaredEnd — see classify below
  } else {
    hardStop = declaredEnd;
  }
  // A completed course stops being drawn at its end — and one with no recorded
  // end still must not run forever, so it clips at today.
  if (p.status === "completed") hardStop = hardStop ?? declaredEnd ?? t;

  const from = start && start > window.start ? start : window.start;
  const to = hardStop && hardStop < window.end ? hardStop : window.end;
  if ((start && start > window.end) || (hardStop && hardStop < window.start) || from > to) {
    return null;
  }

  const days: { day: Date; kind: GanttSegmentKind }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    let kind = rawKindAt({ day: d, anchor, onWeeks: p.cycleOnWeeks, offWeeks: p.cycleOffWeeks });
    if (kind === null) break; // terminal plan exhausted
    // Beyond the committed end of a repeating course, an on-day is projection:
    // it happens only if the user starts the next cycle when prompted.
    if (kind === "on" && repeats && declaredEnd && d > declaredEnd) kind = "projected";
    days.push({ day: d, kind });
  }
  if (days.length === 0) return null;

  const status: GanttRow["status"] =
    p.status === "paused" || p.status === "completed" ? p.status : "active";
  const todayKind =
    t >= from && t <= to
      ? days[daysBetween(from, t)]?.kind ?? null
      : null;

  return {
    id: p.id,
    name: p.name,
    peptideName: p.peptideName,
    status,
    segments: compress(days),
    openEnded: !hardStop && !(repeats && declaredEnd),
    onToday: status === "active" && todayKind === "on",
  };
}

/** Left/width of a segment as percentages of the window. */
export function segmentPercents(window: GanttWindow, seg: GanttSegment): { left: number; width: number } {
  const dayW = 100 / window.days;
  return {
    left: daysBetween(window.start, seg.from) * dayW,
    width: (daysBetween(seg.from, seg.to) + 1) * dayW,
  };
}

/** Centre of `day` as a percentage of the window (the today line). */
export function dayCentrePercent(window: GanttWindow, day: Date): number {
  return (daysBetween(window.start, startOfDay(day)) + 0.5) * (100 / window.days);
}

/**
 * How many ACTIVE protocols expect exposure on each window day — committed and
 * projected both count, because the question this strip answers is "what will
 * be taken together", and a planned restart overlapping a new start is exactly
 * the collision it exists to surface. The bars underneath carry the
 * committed-vs-projected distinction.
 */
export function concurrencyByDay(rows: GanttRow[], window: GanttWindow): number[] {
  const counts = new Array<number>(window.days).fill(0);
  for (const row of rows) {
    if (row.status !== "active") continue;
    for (const seg of row.segments) {
      if (seg.kind === "off") continue;
      const a = Math.max(0, daysBetween(window.start, seg.from));
      const b = Math.min(window.days - 1, daysBetween(window.start, seg.to));
      for (let i = a; i <= b; i++) counts[i]++;
    }
  }
  return counts;
}

/** Sunday-of-week ticks across the window for the axis. */
export function weekTicks(window: GanttWindow): Date[] {
  const out: Date[] = [];
  for (let d = window.start; d <= window.end; d = addDays(d, 7)) out.push(d);
  return out;
}
