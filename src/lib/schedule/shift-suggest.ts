/**
 * Dose-shift SUGGESTIONS — flattening injections-per-day across the week.
 *
 * Several weekly protocols tend to pile onto the same weekdays (two Mon–Fri
 * protocols under two Mon/Wed/Fri ones give 4,2,4,2,4,0,0). The only legal move
 * here is a ROTATION of a weekly pattern by k ∈ 1..6 days: rotation preserves
 * the doses per week, the gap pattern and the times of day by construction, so
 * a suggestion is pure logistics — it never changes what is taken or how often.
 *
 * Pure module, no I/O, no `@/lib/db`, never a server action — the same boundary
 * as rebase-suggest's decision half.
 *
 * Five things about this engine are easy to get wrong and are load-bearing:
 *
 *  1. Each card is a STANDALONE single move measured against the CURRENT
 *     state (not a chain of dependent moves). The plan lists, for every candidate,
 *     its best strictly-improving rotation scored against the state the user
 *     is actually in — never against a state some earlier card would have
 *     produced. Cards are then ordered by that score (peak → Σ² →
 *     collisions), then by lower k, then by input order, so the first card is
 *     byte-for-byte the move the old greedy chain's first step produced.
 *
 *     Why not the chain: every card renders its own Apply, and the panel
 *     re-runs the engine after one is applied. Under the chain, card n's
 *     before/after strips were measured on a state that assumed cards 1..n-1
 *     had already been applied, so applying card 3 on its own delivered a week
 *     the card never showed (for example: card 3 promised 2,2,2,2,3,3,2 while
 *     applying it alone gave 4,2,3,1,4,1,1). The governing principle is that each
 *     step must stand alone; this is that principle taken literally.
 *
 *     The user's flow is therefore apply → re-run → apply, and it terminates:
 *     each applied card strictly lowers peak → Σ² → collisions, so the descent
 *     cannot cycle, and at most one card per candidate is offered per round.
 *
 *  2. The objective is measured on STEADY-STATE vectors, never on the
 *     transition. Every active protocol contributes its pattern from today
 *     (index 0), truncated at the course's planned end, with its `startDate`
 *     honoured only when that start is more than 7 days out; a start inside the
 *     next week counts as already running. A candidate's rotations are scored
 *     over that same window — the protocol's own floor, its own course end, no
 *     transition — so an option and its baseline differ in the weekday set and
 *     in nothing else.
 *
 *     Why the transition is excluded, even though applying really does retire
 *     the predecessor's unlogged doses between today and the successor's first
 *     day: scoring that window lets a rotation win by LOSING a dose rather than
 *     by spreading the week, so a freshly applied plan immediately re-suggests
 *     itself. Measured on the gated objective (today = Mon 2026-09-07, one
 *     pinned and one candidate Mon/Wed/Fri 07:00 protocol): k=1, then k=5, then
 *     k=2, round after round. The horizon is 28 days = 4 whole weeks, so on the
 *     steady-state basis a rotation is exactly count-preserving — it can only
 *     re-shape the week, never shrink it — and an applied move is a fixed
 *     point: the protocol that just moved is never offered a rotation back,
 *     as idempotence requires. (The PLAN empties over the apply → re-run loop
 *     of point 1, one card per round, not in a single step.)
 *
 *     Scoring an option over the SUCCESSOR's start rather than the protocol's
 *     own lets the same defect back in through the side door, which is why the
 *     window is shared: `successorStartDate` is bounded below by the protocol's
 *     start + 1, so rotating a protocol that starts in a few days can land past
 *     today + 7, pick up a floor its baseline does not have, and win by
 *     dropping a dose (measured: today = Mon 2026-09-07, one Monday and two
 *     Wednesday protocols; round 0 moves a Wednesday to Thursday, round 1 moves
 *     it on to Tuesday purely to start on 09-15 and lose the first one).
 *
 *     One residual case remains and is bounded: a candidate whose OWN start is
 *     more than 7 days out is scored over a partial window that is not a whole
 *     number of weeks, where rotation is no longer count-preserving, and
 *     applying moves that start further out again. Such a plan can take two or
 *     three rounds to settle. It always settles — every step strictly lowers
 *     peak → Σ² → collisions, so the descent cannot cycle.
 *
 *     The transition is still fully REPORTED — `successorStartDate`,
 *     `removedDoseDates`, `lastDoseDate`, `gapDays` — and the before/after
 *     strips are walked on the real runtimes (real `startDate`), so the panel
 *     still tells the user exactly what applying does. It just does not decide
 *     which move is best.
 *
 *  3. Counting is one dose per protocol per calendar DAY (dedupe by date, as
 *     materializePlannedDoses does), truncated at the course's planned end.
 *     A protocol with two times a day is one injection-day, not two.
 *
 *  4. A rotation must keep the candidate's dose COUNT inside the horizon.
 *     Over four whole weeks that holds for every k by construction, but a
 *     course that ends (or starts) inside the horizon has a partial last week,
 *     and there some rotations push a dose past the end — a Mon–Fri course
 *     ending on a Friday loses one dose under every k. Σ² rewards that loss as
 *     if it were flattening (for example: a two-week Mon–Fri course can be
 *     moved to Sat–Wed, beating a genuinely flattening move by exactly the
 *     dropped dose). Options that change the count are therefore not legal
 *     moves at all; the guarantee is "never change the number of doses".
 *
 *  5. The COMBINED plan is a SECOND, whole-week answer alongside the
 *     standalone cards, never a replacement for them. It asks the one question
 *     a card cannot: which joint choice of rotate-or-stay across every
 *     candidate gives the flattest 28 days? Each candidate's options are k = 0
 *     (stay) plus the k ∈ 1..6 that survive point 4, and with five or fewer
 *     candidates EVERY combination is evaluated — 7⁵ = 16,807 scored states of
 *     28 cells at the very worst — over the same steady-state walks the
 *     single-move search uses, so the two can never disagree about what a week
 *     is worth. The odometer runs its LAST index fastest, which visits
 *     combinations in ascending k-vector order, so accepting only a STRICT
 *     improvement leaves the lexicographically smallest k-vector standing
 *     among equals (staying, k = 0, sorts first at every position). Past five
 *     candidates 7ⁿ stops being a bound worth paying, so the search falls back
 *     to a greedy chain — take the best strictly-improving single
 *     move, apply it, ask again, at most one move per candidate — and reports
 *     which path ran in `method`. The chain's first step is `bestSingleMoves`'
 *     head, which is `suggestions[0]`, so the two views open on the same move.
 *
 *     The plan is scored peak → Σ² → collisions → fewest moves and is null
 *     when the winner is "everybody stays". Each move still carries the
 *     standalone transition facts of point 2 — its own successor start,
 *     removed doses and gap, computed as if it were the only move — plus
 *     `standaloneAfter`, the plan's own week with ONLY that move applied,
 *     because Apply-all lands the moves one at a time through the single-move path
 *     and "Apply just this" must show the week that button really delivers.
 *
 *     For the same reason the plan is handed over in BEST-PREFIX-FIRST order
 *     rather than input order: a joint optimum has no prefix property, so one
 *     move of it applied alone can be strictly worse than standing still, and
 *     Apply-all stops at the first failure with no un-revise behind it. See
 *     `orderByBestPrefix`. The chain's own order already has that property, so
 *     re-ordering leaves a greedy plan where it was.
 */
import { createHash } from "node:crypto";
import {
  type WeekdayCode,
  startOfDay,
  addDays,
  daysBetween,
  weekdayCode,
} from "./schedule";
import { type Schedule, type ScheduleEntry, DAY_ORDER, parseSchedule, slotsOn } from "./entries";
import { cyclePlanEnd } from "../cycle/state";
import { snapStartToPattern, dayKey, parseDayKey } from "./shift-transition";

// dayKey/parseDayKey have exactly one home — shift-transition.ts. Re-export
// dayKey here so every existing importer of it from this module keeps working
// unchanged.
export { dayKey };

/** Days of real slots the objective is measured over. Index 0 = today. */
export const SHIFT_HORIZON_DAYS = 28;

/**
 * How far out (in days from today) a move's own first dose may fall. The Apply
 * boundary validates the RAW start date against exactly this bound
 * (`validateShiftMove`, src/app/actions/shift.ts), so an option whose successor
 * start lands past it could never be applied at all — and the Apply-all sheet
 * has no date field to edit it down with. `successorStartDate` is floored at
 * the protocol's own start + 1, so a protocol whose start is more than a
 * fortnight out has every k pushed past this bound; the engine drops those
 * options rather than offering a move the button must refuse.
 */
export const SHIFT_MAX_START_DAYS = 14;

/**
 * Most moves one plan may carry. `applyShiftPlan` (src/app/actions/shift.ts)
 * refuses a longer plan outright, before any move is attempted, so the greedy
 * chain — the only search here that could otherwise emit one move per candidate
 * without a bound of its own — stops at this many. The exhaustive path is
 * already bounded well below it by MAX_EXHAUSTIVE_CANDIDATES.
 */
export const MAX_PLAN_MOVES = 10;

/** How far back to look for a surviving planned dose when nothing is logged. */
const LAST_DOSE_LOOKBACK_DAYS = 370;

export interface ShiftProtocolInput {
  id: string;
  name: string;
  peptideName: string;
  /** Only "active" is considered at all; anything else is ignored entirely. */
  status: string;
  scheduleRule: string | null;
  startDate: Date | null;
  endDate: Date | null;
  cycleOnWeeks: number | null;
  /** Set (>0) ⇒ the cycle REPEATS, so its plan end is not a course end. */
  cycleOffWeeks: number | null;
  cycleAnchor: Date | null;
  stackId: string | null;
  shiftPinned: boolean;
  /** Distinct local-day keys "YYYY-MM-DD" of this protocol's logged doses (any order). */
  loggedDayKeys: string[];
}

/** Seven daily counts, Monday-first. */
export type DayCounts = number[];

export type SkipReason = "inactive" | "no_rule" | "not_weekly" | "stack" | "pinned" | "ends_soon";

/**
 * One protocol's row in a card's week grid: the strip week split back out per
 * protocol, so the UI can draw WHO is on each day rather than only how many.
 * `before`/`after` are seven 0/1 days, Monday-first, over the suggestion's own
 * `weekStart` — one dose per protocol per calendar day, exactly as the strips
 * count. Every row is walked on the REAL runtimes, so a row is a
 * statement about a specific week, not about the objective's basis.
 *
 * Display only: rows are deliberately NOT part of `fingerprint`, so what the
 * grid draws can change without invalidating an Apply the user already holds.
 */
export interface ShiftRow {
  protocolId: string;
  peptideName: string;
  protocolName: string;
  /** The HH:MM slots this protocol really has in the week; [] when untimed. */
  times: string[];
  /**
   * True for the candidate this card rotates — exactly one row per suggestion.
   * `CombinedPlan.rows` is the one place it is true more than once: one moved
   * row per move, because that grid draws a whole plan rather than a
   * single rotation.
   */
  moved: boolean;
  before: number[];
  after: number[];
}

export interface ShiftSuggestion {
  protocolId: string;
  protocolName: string;
  peptideName: string;
  /** Rotation applied, 1..6 days forward on the Monday-first wheel. */
  k: number;
  fromDays: WeekdayCode[];
  toDays: WeekdayCode[];
  /** The entry's HH:MM list, copied unchanged — a rotation never moves the clock. */
  times: string[];
  /** The successor's first day, "YYYY-MM-DD". */
  startDate: string;
  /** Predecessor doses in [today, startDate) that are retired rather than moved. */
  removedDoseDates: string[];
  /** Basis of gapDays: last logged day, else last surviving planned day, else null. */
  lastDoseDate: string | null;
  gapDays: number | null;
  /** Smallest gap in the PRE-move weekly pattern, taken cyclically. */
  usualGapDays: number;
  shorterThanUsual: boolean;
  before: DayCounts;
  after: DayCounts;
  /**
   * `before`/`after` split per protocol: the mover first, then every other
   * active protocol with a dose in the week, in input order. Σ over the rows
   * is `before`/`after` on every day by construction — both are summed from
   * the same walks, never computed twice.
   */
  rows: ShiftRow[];
  perTime: { time: string; before: DayCounts; after: DayCounts }[];
  /** Days in the strip week where two or more protocols share one HH:MM. */
  sameTimeDays: { before: number; after: number };
  /** Monday ("YYYY-MM-DD") of the week `before`/`after` are measured over. */
  weekStart: string;
  /** The protocol's own start day ("YYYY-MM-DD") or null — the sheet's preview floor (a revision never starts on/before it). */
  protocolStartDate: string | null;
  /** courseEnd(cand.p) as "YYYY-MM-DD", or null — the sheet's removed-dose preview stops listing dates past it. */
  courseEndDate: string | null;
  fingerprint: string;
}

/**
 * One protocol's move inside the COMBINED plan. Every field except
 * `standaloneAfter` is measured exactly as the standalone card measures it —
 * same successor start, same removed doses, same gap, same fingerprint — so a
 * move can be landed on its own through the single-move path without the
 * numbers moving underneath the user between seeing them and pressing Apply.
 */
export interface CombinedMove {
  protocolId: string;
  protocolName: string;
  peptideName: string;
  /** Rotation applied, 1..6 days forward on the Monday-first wheel; never 0. */
  k: number;
  fromDays: WeekdayCode[];
  toDays: WeekdayCode[];
  times: string[];
  /** This move's own successor first day, computed as if it were the only move. */
  startDate: string;
  removedDoseDates: string[];
  lastDoseDate: string | null;
  gapDays: number | null;
  usualGapDays: number;
  shorterThanUsual: boolean;
  /** Byte-for-byte the standalone card's fingerprint for the same (protocol, k). */
  fingerprint: string;
  protocolStartDate: string | null;
  courseEndDate: string | null;
  /**
   * The plan's OWN week with only this one move applied and every other mover
   * left alone — the week "Apply just this" really delivers, which is not the
   * plan's `after` whenever the plan moves more than one protocol.
   */
  standaloneAfter: DayCounts;
}

/**
 * The whole-plan answer: one week grid, one Before/After, one
 * "Apply all N changes". `before`/`after` and every row are walked on the REAL
 * runtimes over `weekStart` — a statement about a specific week, exactly as a
 * card's strips are — while `score` reports the 28-day steady-state objective
 * the search actually minimised.
 */
export interface CombinedPlan {
  /**
   * BEST-PREFIX-FIRST order (never input order, never score order): move n is
   * the one that gives the lowest objective on top of moves 1..n-1. Apply-all lands
   * them one at a time and stops at the first failure, so every prefix is a
   * state the user can be left in, and this is what keeps each of those a rung
   * of a descent. Empty is impossible — the plan is null instead.
   */
  moves: CombinedMove[];
  /** Monday of the first full Mon–Sun week on/after the LATEST move's start. */
  weekStart: string;
  before: DayCounts;
  after: DayCounts;
  /**
   * Every mover first, in `moves` order, then every other active protocol with
   * at least one dose in the week. Σ over the rows is `before`/`after` on every
   * day, as it is for a card — but with one moved row PER MOVE, the one place
   * the "exactly one moved row" invariant is relaxed.
   */
  rows: ShiftRow[];
  perTime: ShiftSuggestion["perTime"];
  sameTimeDays: { before: number; after: number };
  /** The 28-day steady-state objective: standing still vs the whole plan applied. */
  score: {
    before: { peak: number; sumsq: number; collisions: number };
    after: { peak: number; sumsq: number; collisions: number };
  };
  /** Which search ran — exhaustive up to five candidates, greedy beyond. */
  method: "exhaustive" | "greedy";
}

export interface ShiftPlan {
  current: DayCounts;
  /** Monday ("YYYY-MM-DD") of the week `current` is measured over. */
  weekStart: string;
  suggestions: ShiftSuggestion[];
  /**
   * The whole-plan alternative: the joint choice of rotations that gives
   * the flattest week, or null when no combination strictly improves on
   * standing still. Independent of `suggestions`, which stay exactly what the
   * standalone-card search defines — the panel draws the combined grid and still leans on the cards
   * for per-move honesty.
   */
  combined: CombinedPlan | null;
  skipped: { protocolId: string; reason: SkipReason }[];
  /** Convenience for the UI's "Kept as is" list — ids skipped for "pinned". */
  pinned: string[];
}

// ── Small date helpers ─────────────────────────────────────────────────────

const datesFrom = (start: Date, count: number): Date[] => {
  const first = startOfDay(start);
  return Array.from({ length: count }, (_, i) => addDays(first, i));
};

const firstMondayOnOrAfter = (d: Date): Date => {
  let day = startOfDay(d);
  for (let i = 0; i < 7 && weekdayCode(day) !== "MO"; i++) day = addDays(day, 1);
  return day;
};

/** Numeric "HH:MM" ordering so "09:00" sorts before "20:00". */
const cmpTime = (a: string, b: string) => {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return ah !== bh ? ah - bh : am - bm;
};

const byDayOrder = (a: WeekdayCode, b: WeekdayCode) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b);

// ── Public primitives ──────────────────────────────────────────────────────

/**
 * The Mon–Sun window every strip is measured over: the first Monday on or
 * after `d`, as "YYYY-MM-DD". Exported so the caller that has to
 * build an EMPTY plan (the panel's "unavailable" fallback) labels its strip
 * from the same rule the engine itself uses, rather than inventing one.
 */
export function stripWeekStart(d: Date): string {
  return dayKey(firstMondayOnOrAfter(d));
}

/**
 * Rotate a weekly pattern k days forward on the Monday-first wheel. Doses per
 * week and the cyclic gap pattern are preserved by construction — that is the
 * whole reason rotation is the only legal move. Result sorted by DAY_ORDER.
 */
export function rotateDays(byDays: WeekdayCode[], k: number): WeekdayCode[] {
  const shift = ((k % 7) + 7) % 7;
  const out = new Set<WeekdayCode>();
  for (const d of byDays) {
    const i = DAY_ORDER.indexOf(d);
    out.add(i < 0 ? d : DAY_ORDER[(i + shift) % 7]); // unknown codes pass through
  }
  return [...out].sort(byDayOrder);
}

/**
 * The stored rule with the weekly entry's byDays rotated and NOTHING else
 * changed — times, entry order and any other field are copied through. Emitted
 * in the canonical stored form, `JSON.stringify(parseSchedule(rule))`, so it
 * matches what normaliseScheduleRule would persist. Candidates have exactly one
 * weekly entry (see `eligibility`); any other weekly entry would rotate too.
 */
export function rotatedRule(scheduleRule: string, k: number): string {
  const next: Schedule = parseSchedule(scheduleRule).map((entry) =>
    entry.dayPattern.kind === "weekly"
      ? { ...entry, dayPattern: { kind: "weekly", byDays: rotateDays(entry.dayPattern.byDays, k) } }
      : entry,
  );
  return JSON.stringify(next);
}

/**
 * The course's planned last dosing day: the earlier of `endDate` and the cycle
 * plan's end, or null when the course has neither. Same basis as the forecast
 * walk, so counts stop where planned doses actually stop.
 *
 * Only a TERMINAL cycle plan (no `cycleOffWeeks`) ends the course. A
 * REPEATING plan stops its on-phase and starts the next one, so its plan end is
 * not where the doses stop — the same `repeats` gate buildForecastPlan applies
 * in src/lib/forecast-slots.ts. Without it a repeating 8-on/4-off protocol
 * whose current on-phase had passed contributed zero doses to the objective and
 * read "course ends within a week" for ever.
 */
export function courseEnd(
  p: Pick<ShiftProtocolInput, "startDate" | "endDate" | "cycleOnWeeks" | "cycleOffWeeks" | "cycleAnchor">,
): Date | null {
  const repeats = (p.cycleOffWeeks ?? 0) > 0;
  const cycle = repeats ? null : cyclePlanEnd(p.cycleAnchor ?? p.startDate, p.cycleOnWeeks);
  const hard = p.endDate ? startOfDay(p.endDate) : null;
  if (hard && cycle) return hard <= cycle ? hard : cycle;
  return hard ?? cycle;
}

/**
 * The successor's first dose day: the earliest day that matches the rotated
 * pattern, is on/after today (on/after tomorrow when today's dose is already
 * logged — never a second dose the same day), and is strictly after the
 * predecessor's start (reviseProtocol refuses a revision starting on/before it).
 *
 * Delegates to `snapStartToPattern` (src/lib/schedule/shift-transition.ts) with
 * `earliest = today` — the engine's own transition is the `earliest = today`
 * special case of the general "editable start date" snap the sheet and the
 * apply action also use, so all three can never disagree on when a rotation
 * really starts.
 */
export function successorStartDate(args: {
  toDays: WeekdayCode[];
  today: Date;
  protocolStartDate: Date | null;
  todayLogged: boolean;
}): Date {
  return snapStartToPattern({
    toDays: args.toDays,
    earliest: args.today,
    today: args.today,
    todayLogged: args.todayLogged,
    protocolStartDate: args.protocolStartDate,
  });
}

/**
 * Binds an Apply request to the PROTOCOL state the suggestion was computed from
 * (not the editable start date in the sheet) so the server can reject a rotation
 * whose rule changed underneath the user.
 */
export function shiftFingerprint(args: {
  protocolId: string;
  scheduleRule: string | null;
  startDate: Date | null;
  k: number;
}): string {
  const parts = [
    args.protocolId,
    args.scheduleRule ?? "",
    args.startDate ? dayKey(args.startDate) : "",
    String(args.k),
  ].join("|");
  return createHash("sha256").update(parts).digest("hex");
}

/**
 * May the engine move this protocol? Checked in a deliberate, fixed order so the
 * reason the panel shows is the first one that applies. Non-candidates still COUNT
 * toward the daily load; only `inactive` protocols are ignored outright.
 */
export function eligibility(
  p: ShiftProtocolInput,
  today: Date,
): { ok: true; entry: ScheduleEntry; byDays: WeekdayCode[] } | { ok: false; reason: SkipReason } {
  if (p.status !== "active") return { ok: false, reason: "inactive" };

  const schedule = parseSchedule(p.scheduleRule);
  if (schedule.length === 0) return { ok: false, reason: "no_rule" };

  // Stack and pin are reported BEFORE the pattern test: a stack component is
  // ineligible whatever its rule says, and "in a stack" is the reason the
  // panel must show for it — most stack components run daily, and labelling
  // them "not a weekly pattern" would hide the real constraint.
  if (p.stackId) return { ok: false, reason: "stack" };
  if (p.shiftPinned) return { ok: false, reason: "pinned" };

  if (schedule.length !== 1) return { ok: false, reason: "not_weekly" };
  const entry = schedule[0];
  if (entry.dayPattern.kind !== "weekly") return { ok: false, reason: "not_weekly" };
  const byDays = [...new Set(entry.dayPattern.byDays)].sort(byDayOrder);
  // 7 days is a daily protocol wearing a weekly rule — rotation is a no-op.
  if (byDays.length < 1 || byDays.length > 6) return { ok: false, reason: "not_weekly" };

  const end = courseEnd(p);
  if (end && end <= addDays(startOfDay(today), 7)) return { ok: false, reason: "ends_soon" };

  return { ok: true, entry, byDays };
}

// ── Slot walking ───────────────────────────────────────────────────────────

/**
 * One protocol's dosing behaviour over any set of dates.
 *
 * `anchor` is the pattern's own reference point — interval grids and cycle
 * phases are counted from it — while `floor` is the window the runtime is
 * measured over. They coincide on a REAL runtime and diverge only on the
 * objective's steady-state basis, where a start inside the next week is
 * ignored (see the header).
 */
interface Runtime {
  schedule: Schedule;
  anchor: Date | null;
  floor: Date | null;
  end: Date | null;
}

interface Walk {
  /** 1 = at least one dose that day (deduped by date). */
  days: Uint8Array;
  /** Timed slots that day; untimed slots are excluded — they never collide. */
  times: string[][];
}

/**
 * The objective's window floor for a course starting on `startDate`: a start
 * more than 7 days out still contributes only its real slots, while a start
 * inside the next week counts as already running. Every freshly applied
 * successor is one of the latter, which is what makes the plan idempotent.
 */
function steadyFloor(startDate: Date | null, today: Date): Date | null {
  if (!startDate) return null;
  const start = startOfDay(startDate);
  return start > addDays(today, 7) ? start : null;
}

/** What the protocol really does — doses begin on its stored start date. */
function realRuntime(p: ShiftProtocolInput): Runtime {
  const anchor = p.startDate ? startOfDay(p.startDate) : null;
  return { schedule: parseSchedule(p.scheduleRule), anchor, floor: anchor, end: courseEnd(p) };
}

/** The same protocol on the objective's steady-state basis (see the header). */
function steadyRuntime(p: ShiftProtocolInput, today: Date): Runtime {
  return {
    schedule: parseSchedule(p.scheduleRule),
    anchor: p.startDate ? startOfDay(p.startDate) : null,
    floor: steadyFloor(p.startDate, today),
    end: courseEnd(p),
  };
}

/**
 * The steady-state runtime for a protocol with its weekly entry's `byDays`
 * rotated to `toDays` and NOTHING else changed — same construction the plan
 * loop's own options use (`schedule` is the only field that differs from
 * `steadyRuntime`). The one shared implementation behind both the loop's
 * dose-count check and `rotationPreservesCount`, so the two can never disagree on what
 * "the rotated steady-state runtime" means.
 */
function rotatedSteadyRuntime(
  p: ShiftProtocolInput,
  entry: ScheduleEntry,
  toDays: WeekdayCode[],
  today: Date,
): Runtime {
  const steady = steadyRuntime(p, today);
  const schedule: Schedule = [{ ...entry, dayPattern: { kind: "weekly", byDays: toDays } }];
  return { ...steady, schedule };
}

/**
 * Before the anchor the pattern is evaluated without one: exact for the weekly
 * and daily entries this engine reasons about, and simply empty for interval
 * and cycle entries, whose grid has no meaning before its own start.
 */
function slotsAt(rt: Runtime, day: Date): { due: boolean; times: string[] } {
  if (rt.floor && day < rt.floor) return { due: false, times: [] };
  const anchor = rt.anchor && day >= rt.anchor ? rt.anchor : null;
  const slots = slotsOn(rt.schedule, day, anchor, rt.end);
  if (slots.length === 0) return { due: false, times: [] };
  return { due: true, times: slots.filter((s) => s.time !== null).map((s) => s.time as string) };
}

function walk(rt: Runtime, dates: Date[]): Walk {
  const days = new Uint8Array(dates.length);
  const times: string[][] = [];
  for (let i = 0; i < dates.length; i++) {
    const { due, times: t } = slotsAt(rt, dates[i]);
    days[i] = due ? 1 : 0;
    times.push(t);
  }
  return { days, times };
}

const dayCounts = (walks: Walk[], length: number): DayCounts =>
  Array.from({ length }, (_, i) => walks.reduce((n, w) => n + w.days[i], 0));

/** Doses inside the horizon — the number a legal rotation must preserve. */
const doseCount = (w: Walk): number => {
  let n = 0;
  for (const d of w.days) n += d;
  return n;
};

// ── Objective ──────────────────────────────────────────────────────────────

interface Score {
  peak: number;
  sumsq: number;
  collisions: number;
}

/** Peak, then flatness, then same-time collisions — the objective. */
function scoreWalks(walks: Walk[], length: number): Score {
  let peak = 0;
  let sumsq = 0;
  let collisions = 0;
  for (let i = 0; i < length; i++) {
    let n = 0;
    const tally = new Map<string, number>();
    for (const w of walks) {
      n += w.days[i];
      for (const t of w.times[i]) tally.set(t, (tally.get(t) ?? 0) + 1);
    }
    if (n > peak) peak = n;
    sumsq += n * n;
    for (const c of tally.values()) if (c > 1) collisions += c - 1;
  }
  return { peak, sumsq, collisions };
}

const cmpScore = (a: Score, b: Score): number =>
  a.peak !== b.peak ? a.peak - b.peak : a.sumsq !== b.sumsq ? a.sumsq - b.sumsq : a.collisions - b.collisions;

// ── Per-suggestion facts ───────────────────────────────────────────────────

/**
 * Smallest gap in days between consecutive dose days of a weekly pattern, taken
 * cyclically: Mon/Wed/Fri → 2, Mon–Fri → 1, Mon/Thu → 3, a single day → 7.
 */
function usualGapDays(byDays: WeekdayCode[]): number {
  const idx = byDays.map((d) => DAY_ORDER.indexOf(d)).sort((a, b) => a - b);
  if (idx.length <= 1) return 7;
  let min = 7;
  for (let i = 0; i < idx.length; i++) {
    const gap = i === idx.length - 1 ? idx[0] + 7 - idx[i] : idx[i + 1] - idx[i];
    if (gap < min) min = gap;
  }
  return min;
}

/**
 * The dose day the successor's gap is measured from: the last LOGGED day on or
 * before today, else the last predecessor planned day strictly before today
 * (history the revision cannot retire), else nothing to measure from.
 */
function lastDoseDate(p: ShiftProtocolInput, rt: Runtime, today: Date): string | null {
  const todayK = dayKey(today);
  let bestLogged: string | null = null;
  for (const key of p.loggedDayKeys) {
    if (key <= todayK && (bestLogged === null || key > bestLogged)) bestLogged = key;
  }
  if (bestLogged) return bestLogged;

  const floor = rt.floor ?? addDays(today, -LAST_DOSE_LOOKBACK_DAYS);
  for (let back = 1; back <= LAST_DOSE_LOOKBACK_DAYS; back++) {
    const day = addDays(today, -back);
    if (day < floor) break;
    if (slotsAt(rt, day).due) return dayKey(day);
  }
  return null;
}

/** Predecessor doses inside the transition window that are retired, not moved. */
function removedDoseDates(p: ShiftProtocolInput, rt: Runtime, today: Date, start: Date): string[] {
  const logged = new Set(p.loggedDayKeys);
  const out: string[] = [];
  for (let day = startOfDay(today); day < start; day = addDays(day, 1)) {
    const key = dayKey(day);
    if (!logged.has(key) && slotsAt(rt, day).due) out.push(key);
  }
  return out;
}

function perTimeCounts(
  before: Walk[],
  after: Walk[],
): { perTime: ShiftSuggestion["perTime"]; sameTimeDays: { before: number; after: number } } {
  const tally = (walks: Walk[]) => {
    const map = new Map<string, number[]>();
    let days = 0;
    for (let i = 0; i < 7; i++) {
      const onDay = new Map<string, number>();
      for (const w of walks) for (const t of w.times[i]) onDay.set(t, (onDay.get(t) ?? 0) + 1);
      let shared = false;
      for (const [t, n] of onDay) {
        if (!map.has(t)) map.set(t, [0, 0, 0, 0, 0, 0, 0]);
        (map.get(t) as number[])[i] = n;
        if (n > 1) shared = true;
      }
      if (shared) days += 1;
    }
    return { map, days };
  };

  const b = tally(before);
  const a = tally(after);
  const times = [...new Set([...b.map.keys(), ...a.map.keys()])].sort(cmpTime);
  const zero = () => [0, 0, 0, 0, 0, 0, 0];
  return {
    perTime: times.map((time) => ({
      time,
      before: b.map.get(time) ?? zero(),
      after: a.map.get(time) ?? zero(),
    })),
    sameTimeDays: { before: b.days, after: a.days },
  };
}

/**
 * The card's grid rows, taken from the very walks the two strips are summed
 * from — so Σ rows equals the strip on every day by construction, rather than
 * by a second calculation that could drift from it.
 *
 * The mover is row 0 unconditionally: the UI pins it, labels it, and draws its
 * before/after on one set of cells, so it is present even in the corner case
 * where its course ends before the strip week and both its vectors are zero.
 * Every OTHER active protocol earns a row only by having at least one dose in
 * the week, before or after; the rest would draw seven empty cells. Non-movers
 * are walked on an unchanged runtime, so their `after` is their `before`.
 */
function shiftRow(
  actives: ShiftProtocolInput[],
  beforeWalks: Walk[],
  afterWalks: Walk[],
  i: number,
  moved: boolean,
  /** The mover's own stored times — the fallback for the corner case below. */
  moverEntryTimes: string[],
): ShiftRow {
  const row: ShiftRow = {
    protocolId: actives[i].id,
    peptideName: actives[i].peptideName,
    protocolName: actives[i].name,
    // The week's own timed slots, not the stored rule: `Walk.times` already
    // excludes untimed slots (they never collide), so an untimed protocol
    // reports [] and a two-a-day one reports both of its times.
    times: [...new Set([...beforeWalks[i].times.flat(), ...afterWalks[i].times.flat()])].sort(cmpTime),
    moved,
    before: [...beforeWalks[i].days],
    after: [...afterWalks[i].days],
  };
  // A mover is ALWAYS included (see above), even in the corner case where its
  // course clears `ends_soon` at, say, day 8 but ends before the strip week
  // opens — then both its walks are zero for the whole week and the union
  // above is `[]`, silently dropping the time the card's own rotation line
  // already shows. Falling back to the protocol's stored times keeps the two
  // lines agreeing in exactly that case, without changing anything when the
  // mover has a real dose in the strip week.
  if (moved && row.times.length === 0 && moverEntryTimes.length > 0) {
    row.times = [...moverEntryTimes].sort(cmpTime);
  }
  return row;
}

function buildRows(
  actives: ShiftProtocolInput[],
  beforeWalks: Walk[],
  afterWalks: Walk[],
  movedIdx: number,
  moverEntryTimes: string[],
): ShiftRow[] {
  const rows: ShiftRow[] = [
    shiftRow(actives, beforeWalks, afterWalks, movedIdx, true, moverEntryTimes),
  ];
  for (let i = 0; i < actives.length; i++) {
    if (i === movedIdx) continue;
    if (doseCount(beforeWalks[i]) === 0 && doseCount(afterWalks[i]) === 0) continue;
    rows.push(shiftRow(actives, beforeWalks, afterWalks, i, false, []));
  }
  return rows;
}

/**
 * The combined grid's rows: the same split, with one moved row PER MOVE and in
 * `moves` order, so the UI can draw − ○ ● for each protocol that is going
 * somewhere before it lists the ones that are staying put. Σ over the rows is
 * the plan's `before`/`after` on every day for the same reason a card's is —
 * both come off the very walks the strips are summed from.
 */
function buildCombinedRows(
  actives: ShiftProtocolInput[],
  beforeWalks: Walk[],
  afterWalks: Walk[],
  movers: { idx: number; entryTimes: string[] }[],
): ShiftRow[] {
  const moving = new Set(movers.map((m) => m.idx));
  const rows = movers.map((m) => shiftRow(actives, beforeWalks, afterWalks, m.idx, true, m.entryTimes));
  for (let i = 0; i < actives.length; i++) {
    if (moving.has(i)) continue;
    if (doseCount(beforeWalks[i]) === 0 && doseCount(afterWalks[i]) === 0) continue;
    rows.push(shiftRow(actives, beforeWalks, afterWalks, i, false, []));
  }
  return rows;
}

// ── Plan ───────────────────────────────────────────────────────────────────

interface Option {
  k: number;
  toDays: WeekdayCode[];
  start: Date;
  /** Successor as it really runs — drives the strip and the transition facts. */
  realRt: Runtime;
  /** Successor on the steady-state basis — drives `walk`, hence the objective. */
  steadyRt: Runtime;
  walk: Walk;
}

interface Candidate {
  /** Index into the active-protocol arrays. */
  idx: number;
  p: ShiftProtocolInput;
  entry: ScheduleEntry;
  byDays: WeekdayCode[];
  options: Option[];
}

/**
 * Every candidate's best strictly-improving single rotation against `state`,
 * in the order cards are listed: score (peak → Σ² → collisions), then lower k,
 * then input order. `legal` is the candidate's count-preserving options, indexed by
 * POSITION in `candidates` (not by `Candidate.idx`, which indexes the active
 * arrays); `taken` positions are left out, which is how the greedy chain stops
 * a protocol moving twice.
 *
 * One implementation for both readers: `computeShiftPlan` renders this list as
 * `suggestions`, and the combined search's greedy chain repeatedly takes its
 * head. That is what makes the chain's first step byte-for-byte `suggestions[0]`
 * rather than merely usually equal to it.
 */
function bestSingleMoves(
  candidates: Candidate[],
  legal: Option[][],
  state: Walk[],
  taken?: ReadonlySet<number>,
): { pos: number; opt: Option; score: Score }[] {
  const base = scoreWalks(state, SHIFT_HORIZON_DAYS);
  const trial = state.slice();
  const picks: { pos: number; opt: Option; score: Score }[] = [];

  for (let pos = 0; pos < candidates.length; pos++) {
    if (taken?.has(pos)) continue;
    const idx = candidates[pos].idx;
    let best: { opt: Option; score: Score } | null = null;
    for (const opt of legal[pos]) {
      trial[idx] = opt.walk;
      const score = scoreWalks(trial, SHIFT_HORIZON_DAYS);
      // Tie-break 4 is "fewest protocols moved", so a move must beat standing
      // still outright on peak → Σ² → collisions to be worth suggesting.
      if (cmpScore(score, base) >= 0) continue;
      // Strictly `<`: options are built k = 1..6 in order, so the first option
      // to reach a given score is already this candidate's lowest such k.
      if (best === null || cmpScore(score, best.score) < 0) best = { opt, score };
    }
    trial[idx] = state[idx];
    if (best) picks.push({ pos, opt: best.opt, score: best.score });
  }

  picks.sort((a, b) => cmpScore(a.score, b.score) || a.opt.k - b.opt.k || a.pos - b.pos);
  return picks;
}

// ── Combined plan ──────────────────────────────────────────────────────────

/**
 * Above this many candidates the exhaustive search stops being affordable:
 * 7⁵ = 16,807 scored states is the bound the design accepted, 7⁶ = 117,649 is
 * not. Beyond it the greedy chain runs instead and `method` says so.
 */
const MAX_EXHAUSTIVE_CANDIDATES = 5;

/** One candidate's chosen rotation inside a combined plan. */
interface Chosen {
  cand: Candidate;
  opt: Option;
}

/**
 * The plan-level objective: standing still, and the same 28 days with every
 * move in the plan applied at once — both on the steady-state basis the search
 * itself minimised, so the two numbers the panel prints are the two numbers the
 * engine compared.
 */
function combinedScore(walks: Walk[], chosen: Chosen[]): CombinedPlan["score"] {
  const after = walks.slice();
  for (const ch of chosen) after[ch.cand.idx] = ch.opt.walk;
  return {
    before: scoreWalks(walks, SHIFT_HORIZON_DAYS),
    after: scoreWalks(after, SHIFT_HORIZON_DAYS),
  };
}

/**
 * The odometer's scorer, with everything that does NOT vary across combinations
 * lifted out of the loop.
 *
 * `scoreWalks` re-sums every active protocol's 28 days and re-tallies a fresh
 * per-day time Map on every one of the ≤ 7⁵ = 16,807 combinations, so its cost
 * scaled with the user's TOTAL protocol count on the two hottest pages
 * (/today and /protocols both call `getShiftPanelData` synchronously —
 * measured: 41 ms for the five candidates alone, 165 ms with
 * ten other actives, 495 ms with forty-five). Only the ≤ 5 candidates' walks
 * change between combinations, so the non-candidates are summed and tallied
 * ONCE here and the loop pays for the candidates alone.
 *
 * The two things that make that exact rather than approximate: a rotation never
 * moves the clock (D-day sets rotate, `times` are copied through), so the set of
 * times a candidate can ever contribute is its own entry's times whatever k it
 * takes; and a time NO candidate can contribute to has a fixed count on a given
 * day, so its collisions are a constant of that day. Everything else — the
 * movable times' base counts — is carried per day and topped up per
 * combination. Result: identical scores to `scoreWalks`, in
 * O(combinations × 28 × candidates) independent of how many other protocols
 * the user has.
 */
function combinationScorer(
  candidates: Candidate[],
  walks: Walk[],
  length: number,
): (picked: Walk[]) => Score {
  const isCandidate = new Set(candidates.map((c) => c.idx));
  const movable = [...new Set(candidates.flatMap((c) => c.entry.times))].filter((t) => !!t);
  const slot = new Map(movable.map((t, j) => [t, j]));

  const baseDays = new Int32Array(length);
  const baseFixedCollisions = new Int32Array(length);
  const baseMovable: Int32Array[] = [];
  for (let i = 0; i < length; i++) {
    const tally = new Map<string, number>();
    let n = 0;
    for (let w = 0; w < walks.length; w++) {
      if (isCandidate.has(w)) continue;
      n += walks[w].days[i];
      for (const t of walks[w].times[i]) tally.set(t, (tally.get(t) ?? 0) + 1);
    }
    const row = new Int32Array(movable.length);
    let fixed = 0;
    for (const [t, c] of tally) {
      const j = slot.get(t);
      if (j === undefined) {
        if (c > 1) fixed += c - 1;
      } else {
        row[j] = c;
      }
    }
    baseDays[i] = n;
    baseFixedCollisions[i] = fixed;
    baseMovable.push(row);
  }

  // One reused row rather than one per day per combination — the whole point.
  const row = new Int32Array(movable.length);
  return (picked: Walk[]): Score => {
    let peak = 0;
    let sumsq = 0;
    let collisions = baseFixedCollisions.reduce((a, b) => a + b, 0);
    for (let i = 0; i < length; i++) {
      let n = baseDays[i];
      row.set(baseMovable[i]);
      for (const w of picked) {
        n += w.days[i];
        for (const t of w.times[i]) {
          const j = slot.get(t);
          // A candidate's walk only ever carries its own entry's times, so
          // `j` is defined; the guard is belt-and-braces, not a live branch.
          if (j !== undefined) row[j] += 1;
        }
      }
      if (n > peak) peak = n;
      sumsq += n * n;
      for (let j = 0; j < row.length; j++) if (row[j] > 1) collisions += row[j] - 1;
    }
    return { peak, sumsq, collisions };
  };
}

/**
 * Every combination of rotate-or-stay across the candidates, scored on the same
 * steady-state walks a single move is scored on, keeping peak → Σ² →
 * collisions → fewest moves.
 *
 * `choices[c]` is `[stay, ...legal rotations ascending in k]`, so an odometer
 * whose LAST index moves fastest walks the combinations in ascending k-vector
 * order with the all-stay vector first. Accepting only a strict improvement
 * therefore leaves the lexicographically smallest winning vector standing,
 * which is the combined plan's tie-break, without sorting or storing anything: the running
 * state is one reused `trial` array plus the odometer itself.
 */
function exhaustiveCombination(candidates: Candidate[], legal: Option[][], walks: Walk[]): Chosen[] {
  const choices: (Option | null)[][] = legal.map((opts) => [null, ...opts]);
  const at = choices.map(() => 0);
  // Only the candidates' walks are handed to the scorer; every other active
  // protocol's contribution is baked into it once, above.
  const score = combinationScorer(candidates, walks, SHIFT_HORIZON_DAYS);
  const trial: Walk[] = candidates.map((cand) => walks[cand.idx]);
  let bestAt: number[] = at.slice();
  let bestScore: Score | null = null;
  let bestMoves = 0;

  for (;;) {
    let moves = 0;
    for (let c = 0; c < choices.length; c++) {
      const opt = choices[c][at[c]];
      trial[c] = opt ? opt.walk : walks[candidates[c].idx];
      if (opt) moves += 1;
    }
    const trialScore = score(trial);
    const rank = bestScore === null ? -1 : cmpScore(trialScore, bestScore);
    if (rank < 0 || (rank === 0 && moves < bestMoves)) {
      bestScore = trialScore;
      bestMoves = moves;
      bestAt = at.slice();
    }

    let c = choices.length - 1;
    for (; c >= 0; c--) {
      at[c] += 1;
      if (at[c] < choices[c].length) break;
      at[c] = 0;
    }
    if (c < 0) break;
  }

  const chosen: Chosen[] = [];
  for (let c = 0; c < choices.length; c++) {
    const opt = choices[c][bestAt[c]];
    if (opt) chosen.push({ cand: candidates[c], opt });
  }
  return chosen;
}

/**
 * The greedy chain, kept for the sets the exhaustive search cannot afford:
 * take the best strictly-improving single move, apply it, ask again. A
 * candidate that has already moved is excluded, so the chain terminates in at
 * most one pass per candidate and every protocol ends up with a single k — the
 * shape a combined plan has to have.
 *
 * Capped at MAX_PLAN_MOVES: this path runs only past five candidates, so
 * without the cap a user with fourteen Monday-only protocols got a twelve-move
 * plan and an "Apply all 12 changes" button that `applyShiftPlan` refused
 * wholesale, before attempting anything, every time it was pressed. The chain
 * takes its steps best-first, so stopping early keeps the moves that bought the
 * most.
 */
function greedyChain(candidates: Candidate[], legal: Option[][], walks: Walk[]): Chosen[] {
  const state = walks.slice();
  const taken = new Set<number>();
  const picked = new Map<number, Option>();

  for (let step = 0; step < candidates.length && picked.size < MAX_PLAN_MOVES; step++) {
    const [head] = bestSingleMoves(candidates, legal, state, taken);
    if (!head) break;
    state[candidates[head.pos].idx] = head.opt.walk;
    taken.add(head.pos);
    picked.set(head.pos, head.opt);
  }

  const chosen: Chosen[] = [];
  for (let pos = 0; pos < candidates.length; pos++) {
    const opt = picked.get(pos);
    if (opt) chosen.push({ cand: candidates[pos], opt });
  }
  return chosen;
}

/**
 * The order the plan's moves are shown — and therefore applied — in.
 *
 * Apply-all lands them ONE AT A TIME through the single-move path and stops at the
 * first failure, so every PREFIX of the list is a state the user can be left
 * in, permanently: there is no un-revise. Engine order does not make
 * those prefixes safe. The exhaustive search returns a JOINT optimum, not a
 * chain, and a joint optimum has no prefix property at all — measured on four
 * Monday-anchored protocols, a two-move plan whose full application took the
 * week from peak 3 / Σ² 136 to peak 3 / Σ² 120 went through peak 4 / Σ² 144
 * after its first move alone, strictly WORSE than standing still. (Across 263
 * random multi-move exhaustive plans, 41 had a non-improving prefix.)
 *
 * So the set the search chose is kept exactly as it is and only re-ordered:
 * repeatedly take the remaining move that scores lowest on top of the moves
 * already ahead of it. Every prefix is then the best state reachable from the
 * one before it, which is the most a sequence of independent revisions can
 * promise. Ties keep the lower k; the scan runs in engine order, so equal
 * moves keep it.
 */
function orderByBestPrefix(chosen: Chosen[], walks: Walk[]): Chosen[] {
  const remaining = chosen.slice();
  const state = walks.slice();
  const out: Chosen[] = [];

  while (remaining.length > 0) {
    let bestAt = 0;
    let bestScore: Score | null = null;
    for (let r = 0; r < remaining.length; r++) {
      const idx = remaining[r].cand.idx;
      const keep = state[idx];
      state[idx] = remaining[r].opt.walk;
      const score = scoreWalks(state, SHIFT_HORIZON_DAYS);
      state[idx] = keep;
      const rank = bestScore === null ? -1 : cmpScore(score, bestScore);
      if (rank < 0 || (rank === 0 && remaining[r].opt.k < remaining[bestAt].opt.k)) {
        bestScore = score;
        bestAt = r;
      }
    }
    const [next] = remaining.splice(bestAt, 1);
    state[next.cand.idx] = next.opt.walk;
    out.push(next);
  }
  return out;
}

/**
 * The user-facing whole-plan view. `before`/`after` and the rows are
 * walked on the REAL runtimes over one week — the first full Mon–Sun week on or
 * after the LATEST move's own first dose, so every move in the plan is already
 * running by the Monday the grid is labelled with and the totals are honest for
 * all of them at once.
 *
 * Each move's transition facts are the STANDALONE ones: its successor start,
 * removed doses and gap are computed as if it were the only move, because Apply-all
 * lands the moves one at a time through the single-move path and each of them
 * has to stand alone when it does. `standaloneAfter` is that honesty carried
 * into the grid — the plan's own week with only that move applied.
 */
function buildCombinedPlan(
  picked: Chosen[],
  method: CombinedPlan["method"],
  states: Runtime[],
  actives: ShiftProtocolInput[],
  walks: Walk[],
  today: Date,
): CombinedPlan {
  // The SET is the search's; the ORDER is chosen here, so that a partial apply
  // (Apply-all stops at the first failure) can only ever leave the user on a rung of
  // a descent — see orderByBestPrefix.
  const chosen = orderByBestPrefix(picked, walks);

  let latest = chosen[0].opt.start;
  for (const ch of chosen) if (ch.opt.start > latest) latest = ch.opt.start;
  const weekStart = firstMondayOnOrAfter(latest);
  const strip = datesFrom(weekStart, 7);

  const beforeWalks = states.map((rt) => walk(rt, strip));
  const afterStates = states.slice();
  for (const ch of chosen) afterStates[ch.cand.idx] = ch.opt.realRt;
  const afterWalks = afterStates.map((rt) => walk(rt, strip));
  const { perTime, sameTimeDays } = perTimeCounts(beforeWalks, afterWalks);

  const moves: CombinedMove[] = chosen.map((ch) => {
    // Only this mover's week changes; every other walk is the one `before` is
    // summed from, so the two vectors differ in exactly this protocol's cells.
    const only = beforeWalks.slice();
    only[ch.cand.idx] = afterWalks[ch.cand.idx];

    const predecessor = states[ch.cand.idx];
    const last = lastDoseDate(ch.cand.p, predecessor, today);
    const gapDays = last === null ? null : daysBetween(parseDayKey(last), ch.opt.start);
    const usual = usualGapDays(ch.cand.byDays);

    return {
      protocolId: ch.cand.p.id,
      protocolName: ch.cand.p.name,
      peptideName: ch.cand.p.peptideName,
      k: ch.opt.k,
      fromDays: ch.cand.byDays,
      toDays: ch.opt.toDays,
      times: ch.cand.entry.times,
      startDate: dayKey(ch.opt.start),
      removedDoseDates: removedDoseDates(ch.cand.p, predecessor, today, ch.opt.start),
      lastDoseDate: last,
      gapDays,
      usualGapDays: usual,
      shorterThanUsual: gapDays !== null && gapDays < usual,
      fingerprint: shiftFingerprint({
        protocolId: ch.cand.p.id,
        scheduleRule: ch.cand.p.scheduleRule,
        startDate: ch.cand.p.startDate,
        k: ch.opt.k,
      }),
      protocolStartDate: ch.cand.p.startDate ? dayKey(ch.cand.p.startDate) : null,
      // opt.realRt.end IS courseEnd(ch.cand.p) — computed once per candidate
      // and carried onto every option's runtime.
      courseEndDate: ch.opt.realRt.end ? dayKey(ch.opt.realRt.end) : null,
      standaloneAfter: dayCounts(only, 7),
    };
  });

  return {
    moves,
    weekStart: dayKey(weekStart),
    before: dayCounts(beforeWalks, 7),
    after: dayCounts(afterWalks, 7),
    rows: buildCombinedRows(
      actives,
      beforeWalks,
      afterWalks,
      chosen.map((ch) => ({ idx: ch.cand.idx, entryTimes: ch.cand.entry.times })),
    ),
    perTime,
    sameTimeDays,
    score: combinedScore(walks, chosen),
    method,
  };
}

/**
 * The plan: for every candidate, its best STRICTLY-IMPROVING single rotation,
 * scored against the CURRENT state only. Nothing is chained — `states`
 * and `walks` are never mutated between cards — so every card's `before` is
 * the week the user is in now and its `after` is that same week with only that
 * one move applied. Each card therefore delivers exactly what it shows when it
 * is applied on its own, which is the only thing the panel ever does with one.
 *
 * Within a candidate, options are tried k = 1..6 and ties keep the lower k.
 * Across candidates, cards are ordered by score (peak → Σ² → collisions), then
 * lower k, then input order — the same comparison the old greedy chain's first
 * step used, so the first card is unchanged. After an Apply the caller
 * re-runs this function; the descent terminates because every applied card
 * strictly lowers the objective.
 *
 * Alongside the cards it also computes `combined`: the joint choice of
 * rotate-or-stay across every candidate, exhaustive up to five candidates and
 * greedy beyond, null when standing still wins. The two are independent views
 * of the same options — a card answers "what is the best single move", the plan
 * answers "what is the flattest week" — and both read the same count-preserving option
 * lists, so a rotation can never be offered by one and be illegal in the other.
 */
export function computeShiftPlan(args: { protocols: ShiftProtocolInput[]; today: Date }): ShiftPlan {
  const today = startOfDay(args.today);
  const horizon = datesFrom(today, SHIFT_HORIZON_DAYS);

  const skipped: { protocolId: string; reason: SkipReason }[] = [];
  const pinned: string[] = [];
  const actives: ShiftProtocolInput[] = [];
  const states: Runtime[] = [];
  const walks: Walk[] = [];
  const candidates: Candidate[] = [];

  for (const p of args.protocols) {
    const el = eligibility(p, today);
    if (!el.ok) {
      skipped.push({ protocolId: p.id, reason: el.reason });
      if (el.reason === "pinned") pinned.push(p.id);
      // Inactive protocols are reported for the caller's benefit but contribute
      // no doses — they are not part of the load at all.
      if (el.reason === "inactive") continue;
    }
    const idx = actives.length;
    actives.push(p);
    states.push(realRuntime(p));
    const steady = steadyRuntime(p, today);
    walks.push(walk(steady, horizon));
    if (!el.ok) continue;

    const todayLogged = p.loggedDayKeys.includes(dayKey(today));
    const end = courseEnd(p);
    const latestStart = addDays(today, SHIFT_MAX_START_DAYS);
    const options: Option[] = [];
    for (let k = 1; k <= 6; k++) {
      const toDays = rotateDays(el.byDays, k);
      const start = successorStartDate({
        toDays,
        today,
        protocolStartDate: p.startDate,
        todayLogged,
      });
      // Never offer a move the Apply boundary must refuse. `successorStartDate`
      // is floored at the protocol's own start + 1, so a protocol whose start
      // is itself more than a fortnight out produces successor starts past the
      // raw today+14 bound `validateShiftMove` enforces — and the Apply-all
      // sheet, unlike the single-move one, has no date field to edit down.
      // Measured: an MWF protocol starting 2026-09-21 was offered a move
      // starting 2026-09-22 on a today of 2026-09-07, and the whole plan was
      // then refused before any move was attempted.
      if (start > latestStart) continue;
      // The successor carries the times, the course end and the cycle plan; only
      // the weekday set and the start move. The scored runtime keeps the
      // protocol's own steady window — only `schedule` differs from `steady`.
      const steadyRt = rotatedSteadyRuntime(p, el.entry, toDays, today);
      const realRt: Runtime = { schedule: steadyRt.schedule, anchor: start, floor: start, end };
      options.push({ k, toDays, start, realRt, steadyRt, walk: walk(steadyRt, horizon) });
    }
    candidates.push({ idx, p, entry: el.entry, byDays: el.byDays, options });
  }

  const currentWeek = firstMondayOnOrAfter(today);
  const current = dayCounts(
    states.map((rt) => walk(rt, datesFrom(currentWeek, 7))),
    7,
  );

  // A rotation that drops (or adds) a dose inside the horizon is not a
  // legal move at all — the objective must only ever re-shape the week — so
  // the illegal options are filtered out once, here, and both searches below
  // read the very same list.
  const legal = candidates.map((cand) =>
    cand.options.filter((opt) => doseCount(opt.walk) === doseCount(walks[cand.idx])),
  );

  // Cards: every candidate's best single move, measured against the state as it
  // stands today and never against a state another card would produce.
  const picks = bestSingleMoves(candidates, legal, walks);
  const suggestions = picks.map((pick) =>
    buildSuggestion(candidates[pick.pos], pick.opt, states, actives, today),
  );

  // The whole-plan alternative. No chosen move means the all-stay vector
  // won, which is exactly when there is no plan to offer.
  const exhaustive = candidates.length <= MAX_EXHAUSTIVE_CANDIDATES;
  const chosen = exhaustive
    ? exhaustiveCombination(candidates, legal, walks)
    : greedyChain(candidates, legal, walks);
  const combined =
    chosen.length === 0
      ? null
      : buildCombinedPlan(chosen, exhaustive ? "exhaustive" : "greedy", states, actives, walks, today);

  return { current, weekStart: dayKey(currentWeek), suggestions, combined, skipped, pinned };
}

/**
 * The Apply boundary's own dose-count check. `computeShiftPlan` refuses to OFFER a
 * rotation that changes the candidate's dose count inside the 28-day horizon,
 * but a hand-crafted Apply request (a valid fingerprint paired with a k the
 * plan never offered for that protocol) skips the engine entirely — so
 * `applyShiftSuggestion` calls this, on the SAME basis the loop's own dose-count check
 * uses (`rotatedSteadyRuntime` + `walk` + `doseCount`, above), immediately
 * before it builds the revision. Returns false for a protocol that is not
 * itself an eligible candidate at all (never a legal rotation), so the caller
 * does not also need to special-case eligibility here.
 */
export function rotationPreservesCount(args: { protocol: ShiftProtocolInput; k: number; today: Date }): boolean {
  const today = startOfDay(args.today);
  const el = eligibility(args.protocol, today);
  if (!el.ok) return false;

  const horizon = datesFrom(today, SHIFT_HORIZON_DAYS);
  const baseCount = doseCount(walk(steadyRuntime(args.protocol, today), horizon));
  const toDays = rotateDays(el.byDays, args.k);
  const rotatedRt = rotatedSteadyRuntime(args.protocol, el.entry, toDays, today);
  return doseCount(walk(rotatedRt, horizon)) === baseCount;
}

/**
 * The user-facing facts for one card. `before`/`after` are measured over the
 * SAME seven dates — the first full Mon–Sun week starting on or after the
 * successor's first dose, reported as `weekStart` so the panel can label the
 * strip by its Monday — so the two strips are directly comparable, and
 * every active protocol is counted, not just the one that moves.
 *
 * `states` is the CURRENT state and is never mutated by the caller:
 * `before` is that state and `after` is that state with this one rotation
 * applied, so the card's promise holds when it is applied on its own.
 * `actives` runs parallel to it — same index, same protocol — and carries the
 * names `rows` needs, which a Runtime alone does not hold.
 *
 * Unlike the objective, the strip is walked on the REAL runtimes: it is a
 * display of a specific week, and that week lies entirely on or after the
 * successor's first dose, so the real and steady-state bases agree on it.
 */
function buildSuggestion(
  cand: Candidate,
  opt: Option,
  states: Runtime[],
  actives: ShiftProtocolInput[],
  today: Date,
): ShiftSuggestion {
  const stripWeek = firstMondayOnOrAfter(opt.start);
  const strip = datesFrom(stripWeek, 7);
  const beforeWalks = states.map((rt) => walk(rt, strip));
  const afterStates = states.slice();
  afterStates[cand.idx] = opt.realRt;
  const afterWalks = afterStates.map((rt) => walk(rt, strip));
  const { perTime, sameTimeDays } = perTimeCounts(beforeWalks, afterWalks);

  const predecessor = states[cand.idx];
  const last = lastDoseDate(cand.p, predecessor, today);
  const gapDays = last === null ? null : daysBetween(parseDayKey(last), opt.start);
  const usual = usualGapDays(cand.byDays);

  return {
    protocolId: cand.p.id,
    protocolName: cand.p.name,
    peptideName: cand.p.peptideName,
    k: opt.k,
    fromDays: cand.byDays,
    toDays: opt.toDays,
    times: cand.entry.times,
    startDate: dayKey(opt.start),
    removedDoseDates: removedDoseDates(cand.p, predecessor, today, opt.start),
    lastDoseDate: last,
    gapDays,
    usualGapDays: usual,
    shorterThanUsual: gapDays !== null && gapDays < usual,
    before: dayCounts(beforeWalks, 7),
    after: dayCounts(afterWalks, 7),
    rows: buildRows(actives, beforeWalks, afterWalks, cand.idx, cand.entry.times),
    perTime,
    sameTimeDays,
    weekStart: dayKey(stripWeek),
    protocolStartDate: cand.p.startDate ? dayKey(cand.p.startDate) : null,
    // opt.realRt.end IS courseEnd(cand.p) — the loop already computed it once
    // per candidate and carried it onto every option's runtime.
    courseEndDate: opt.realRt.end ? dayKey(opt.realRt.end) : null,
    fingerprint: shiftFingerprint({
      protocolId: cand.p.id,
      scheduleRule: cand.p.scheduleRule,
      startDate: cand.p.startDate,
      k: opt.k,
    }),
  };
}
