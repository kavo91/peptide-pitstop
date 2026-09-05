import { describe, it, expect } from "vitest";
import type { WeekdayCode } from "./schedule";
import { DAY_ORDER, parseSchedule, slotsInRange } from "./entries";
import {
  computeShiftPlan,
  courseEnd,
  dayKey,
  eligibility,
  rotateDays,
  rotatedRule,
  rotationPreservesCount,
  shiftFingerprint,
  successorStartDate,
  MAX_PLAN_MOVES,
  SHIFT_HORIZON_DAYS,
  SHIFT_MAX_START_DAYS,
  type ShiftProtocolInput,
} from "./shift-suggest";
import type { CombinedPlan, ShiftPlan, ShiftRow, ShiftSuggestion } from "./shift-suggest";
import { addDays } from "./schedule";
import { parseDayKey, transitionPreview } from "./shift-transition";

// Local-midnight construction (vitest pins TZ=Australia/Brisbane) — same house
// style as rebase-suggest.test.ts / evenly-spaced.test.ts.
const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);

const weeklyRule = (byDays: WeekdayCode[], times: string[] = []) =>
  JSON.stringify([{ dayPattern: { kind: "weekly", byDays }, times }]);

const proto = (over: Partial<ShiftProtocolInput> & { id: string }): ShiftProtocolInput => ({
  name: over.id,
  peptideName: over.id,
  status: "active",
  scheduleRule: null,
  startDate: null,
  endDate: null,
  cycleOnWeeks: null,
  cycleOffWeeks: null,
  cycleAnchor: null,
  stackId: null,
  shiftPinned: false,
  loggedDayKeys: [],
  ...over,
});

// ── The worked example ─────────────────────────────────────────────────────
// Fri 2026-09-04. Two Mon–Fri protocols and two Mon/Wed/Fri protocols give a
// week of 4,2,4,2,4,0,0.
const FRI_4_SEP = D(2026, 9, 4);

const P1 = proto({
  id: "P1",
  name: "MF-7",
  peptideName: "MF-7",
  scheduleRule: weeklyRule(["MO", "TU", "WE", "TH", "FR"], ["07:00"]),
  startDate: D(2026, 8, 31),
  endDate: D(2026, 10, 25),
  cycleOnWeeks: 8,
  // 8 on / 4 off. Because cycleOffWeeks is set the cycle REPEATS, so its
  // plan end no longer bounds the course — P1 is
  // bounded by its own endDate (2026-10-25) instead, which is the very same
  // day cyclePlanEnd(2026-08-31, 8) used to return, so every number below is
  // unchanged. P2 has no endDate and so is now unbounded; its plan end was
  // 2026-10-25 too, far outside the 28-day horizon either way.
  cycleOffWeeks: 4,
  cycleAnchor: D(2026, 8, 31),
  loggedDayKeys: ["2026-09-03"],
});
const P2 = proto({
  id: "P2",
  name: "MF-21",
  peptideName: "MF-21",
  scheduleRule: weeklyRule(["MO", "TU", "WE", "TH", "FR"], ["21:00"]),
  startDate: D(2026, 8, 31),
  cycleOnWeeks: 8,
  cycleOffWeeks: 4,
  loggedDayKeys: ["2026-09-03"],
});
const P3 = proto({
  id: "P3",
  name: "MWF-6",
  peptideName: "MWF-6",
  scheduleRule: weeklyRule(["MO", "WE", "FR"], ["06:00"]),
  startDate: D(2026, 8, 3),
  cycleOnWeeks: 10,
  cycleAnchor: D(2026, 8, 3),
  loggedDayKeys: ["2026-09-02"],
});
const P4 = proto({
  id: "P4",
  name: "MWF-7",
  peptideName: "MWF-7",
  scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]),
  startDate: D(2026, 9, 3),
  loggedDayKeys: ["2026-09-03"],
});

describe("computeShiftPlan — worked example 4,2,4,2,4,0,0", () => {
  it("first suggestion rotates MWF-7 by one day onto Tue/Thu/Sat", () => {
    const plan = computeShiftPlan({ protocols: [P1, P2, P3, P4], today: FRI_4_SEP });

    expect(plan.current).toEqual([4, 2, 4, 2, 4, 0, 0]);
    // today is Fri 2026-09-04, so the strip is the first FULL Mon–Sun
    // week on/after it — Mon 2026-09-07, not the calendar week today sits in.
    expect(plan.weekStart).toBe("2026-09-07");
    expect(plan.skipped).toEqual([]);
    expect(plan.pinned).toEqual([]);

    const s = plan.suggestions[0];
    // P4 rather than P3: both give the same peak and sum of squares, but moving
    // the 07:00 protocol removes more same-time days (tie-break 3).
    expect(s.protocolId).toBe("P4");
    expect(s.protocolName).toBe("MWF-7");
    expect(s.peptideName).toBe("MWF-7");
    expect(s.k).toBe(1);
    expect(s.fromDays).toEqual(["MO", "WE", "FR"]);
    expect(s.toDays).toEqual(["TU", "TH", "SA"]);
    expect(s.times).toEqual(["07:00"]);
    expect(s.startDate).toBe("2026-09-05");
    expect(s.removedDoseDates).toEqual(["2026-09-04"]);
    expect(s.lastDoseDate).toBe("2026-09-03");
    expect(s.gapDays).toBe(2);
    expect(s.usualGapDays).toBe(2);
    expect(s.shorterThanUsual).toBe(false);
    expect(s.before).toEqual([4, 2, 4, 2, 4, 0, 0]);
    expect(s.after).toEqual([3, 3, 3, 3, 3, 1, 0]);
    expect(s.sameTimeDays).toEqual({ before: 3, after: 2 });
    // The card's own strip week: firstMondayOnOrAfter(2026-09-05) — the same
    // Monday plan.current is measured over, so before === plan.current below.
    expect(s.weekStart).toBe("2026-09-07");
    expect(s.fingerprint).toBe(
      shiftFingerprint({ protocolId: "P4", scheduleRule: P4.scheduleRule, startDate: P4.startDate, k: 1 }),
    );
  });

  it("every candidate gets its own best single move, measured against the CURRENT week", () => {
    // Derived by hand over the 28-day horizon (Fri 2026-09-04 … Thu 2026-10-01
    // is exactly four whole weeks, so each weekday occurs 4x and per-week
    // figures scale by 4). Base [4,2,4,2,4,0,0]: peak 4, Σ² 56/week (224),
    // 3 same-time days/week at 07:00 (12 collisions).
    //
    //   P4 (MWF 07:00) k=1 → TU/TH/SA  [3,3,3,3,3,1,0]  peak 3, Σ² 46, coll 2/wk
    //   P3 (MWF 06:00) k=1 → TU/TH/SA  [3,3,3,3,3,1,0]  peak 3, Σ² 46, coll 3/wk
    //   P1 (M–F 07:00) k=2 → WE–SU     [3,1,4,2,4,1,1]  peak 4, Σ² 48, coll 2/wk
    //   P2 (M–F 21:00) k=2 → WE–SU     [3,1,4,2,4,1,1]  peak 4, Σ² 48, coll 3/wk
    //
    // P4 and P3 tie on peak and Σ² and separate on collisions (moving the
    // 07:00 protocol clears one of A's shared mornings); P1/P2 tie the same
    // way. Within each candidate k=2..5 (P1/P2) and k=1/k=6 (P3/P4) tie on all
    // three terms, so the LOWER k is kept. Ordering is score, then k, then
    // input order.
    const plan = computeShiftPlan({ protocols: [P1, P2, P3, P4], today: FRI_4_SEP });
    expect(plan.suggestions.map((s) => [s.protocolId, s.k])).toEqual([
      ["P4", 1],
      ["P3", 1],
      ["P1", 2],
      ["P2", 2],
    ]);
    expect(plan.suggestions.map((s) => s.after)).toEqual([
      [3, 3, 3, 3, 3, 1, 0],
      [3, 3, 3, 3, 3, 1, 0],
      [3, 1, 4, 2, 4, 1, 1],
      [3, 1, 4, 2, 4, 1, 1],
    ]);
    // NOT a chain: every card's `before` is the CURRENT week, never the
    // previous card's `after`. Every successor here starts on 09-04 or 09-05,
    // so every strip week is the same Mon 2026-09-07 that plan.current spans.
    for (const s of plan.suggestions) {
      expect(s.weekStart).toBe(plan.weekStart);
      expect(s.before).toEqual(plan.current);
    }
    // One card per candidate, at most.
    expect(new Set(plan.suggestions.map((s) => s.protocolId)).size).toBe(4);
  });

  it("today already logged → same start date, nothing removed, shorter gap", () => {
    // Others pinned so MWF-7 is the only candidate — this isolates the
    // transition arithmetic from the greedy's choice of which protocol to move.
    const protocols = [
      { ...P1, shiftPinned: true },
      { ...P2, shiftPinned: true },
      { ...P3, shiftPinned: true },
      { ...P4, loggedDayKeys: ["2026-09-04"] },
    ];
    const plan = computeShiftPlan({ protocols, today: FRI_4_SEP });
    expect(plan.suggestions).toHaveLength(1);
    const s = plan.suggestions[0];
    expect(s.protocolId).toBe("P4");
    expect(s.k).toBe(1);
    expect(s.toDays).toEqual(["TU", "TH", "SA"]);
    expect(s.startDate).toBe("2026-09-05");
    expect(s.removedDoseDates).toEqual([]); // today's dose is logged — nothing retired
    expect(s.lastDoseDate).toBe("2026-09-04");
    expect(s.gapDays).toBe(1);
    expect(s.usualGapDays).toBe(2);
    expect(s.shorterThanUsual).toBe(true);
    expect(s.before).toEqual([4, 2, 4, 2, 4, 0, 0]);
    expect(s.after).toEqual([3, 3, 3, 3, 3, 1, 0]);
    expect(s.sameTimeDays).toEqual({ before: 3, after: 2 });
  });

  it("a dose logged today moves the transition facts, never the objective", () => {
    // With all four candidates and MWF-7's Friday dose already logged, the
    // objective is unchanged — it is measured on steady-state vectors, and a
    // logged dose is a fact about the transition, not about the week's shape.
    // So MWF-7 still leads on the same peak/Σ²/collision grounds as the base
    // worked example; only its gap sentence changes.
    const p4Logged = { ...P4, loggedDayKeys: ["2026-09-04"] };
    const plan = computeShiftPlan({ protocols: [P1, P2, P3, p4Logged], today: FRI_4_SEP });
    const s = plan.suggestions[0];
    expect(s.protocolId).toBe("P4");
    expect(s.k).toBe(1);
    expect(s.toDays).toEqual(["TU", "TH", "SA"]);
    expect(s.startDate).toBe("2026-09-05");
    expect(s.removedDoseDates).toEqual([]); // today's dose is logged, not retired
    expect(s.lastDoseDate).toBe("2026-09-04");
    expect(s.gapDays).toBe(1);
    expect(s.usualGapDays).toBe(2);
    expect(s.shorterThanUsual).toBe(true);
    expect(s.after).toEqual([3, 3, 3, 3, 3, 1, 0]);
  });
});

// ── transitionPreview reproduces the engine's own transition ────────────────
// shift-transition.ts is the one shared module `successorStartDate` (above),
// `applyShiftSuggestion` and the confirm sheet's live preview all snap
// through. These two tests prove `transitionPreview({ earliest: today, ... })`
// reproduces the worked example's own startDate/removedDoseDates/gapDays/
// shorterThanUsual exactly, for both the unlogged and today-logged variants.
describe("transitionPreview matches computeShiftPlan's own transition, earliest = today", () => {
  it("worked example, today not logged", () => {
    const plan = computeShiftPlan({ protocols: [P1, P2, P3, P4], today: FRI_4_SEP });
    const s = plan.suggestions[0]; // P4, k=1, MWF -> TU/TH/SA
    const preview = transitionPreview({
      fromDays: s.fromDays,
      toDays: s.toDays,
      today: FRI_4_SEP,
      earliest: FRI_4_SEP,
      todayLogged: false,
      lastDoseDate: s.lastDoseDate,
      usualGapDays: s.usualGapDays,
      protocolStartDate: P4.startDate,
    });
    expect(preview.startDate).toBe(s.startDate);
    expect(preview.removedDoseDates).toEqual(s.removedDoseDates);
    expect(preview.gapDays).toBe(s.gapDays);
    expect(preview.shorterThanUsual).toBe(s.shorterThanUsual);
  });

  it("worked example, today already logged", () => {
    const p4Logged = { ...P4, loggedDayKeys: ["2026-09-04"] };
    const plan = computeShiftPlan({ protocols: [P1, P2, P3, p4Logged], today: FRI_4_SEP });
    const s = plan.suggestions[0];
    const preview = transitionPreview({
      fromDays: s.fromDays,
      toDays: s.toDays,
      today: FRI_4_SEP,
      earliest: FRI_4_SEP,
      todayLogged: true,
      lastDoseDate: s.lastDoseDate,
      usualGapDays: s.usualGapDays,
      protocolStartDate: P4.startDate,
    });
    expect(preview.startDate).toBe(s.startDate);
    expect(preview.removedDoseDates).toEqual(s.removedDoseDates);
    expect(preview.gapDays).toBe(s.gapDays);
    expect(preview.shorterThanUsual).toBe(s.shorterThanUsual);
  });
});

// ── Rotation legality ──────────────────────────────────────────────────────
const cyclicGaps = (days: WeekdayCode[]): number[] => {
  const idx = days.map((d) => DAY_ORDER.indexOf(d)).sort((a, b) => a - b);
  return idx
    .map((v, i) => (i === idx.length - 1 ? idx[0] + 7 - v : idx[i + 1] - v))
    .sort((a, b) => a - b);
};

describe("rotateDays / rotatedRule", () => {
  const sets: WeekdayCode[][] = [
    ["MO"],
    ["MO", "TH"],
    ["MO", "WE", "FR"],
    ["MO", "TU", "WE", "TH", "FR"],
    ["TU", "SA", "SU"],
    ["MO", "TU", "WE", "TH", "FR", "SA"],
  ];

  it("preserves dose count and the cyclic gap pattern for every k", () => {
    for (const set of sets) {
      const gaps = cyclicGaps(set);
      for (let k = 1; k <= 6; k++) {
        const out = rotateDays(set, k);
        expect(out).toHaveLength(set.length);
        expect(cyclicGaps(out)).toEqual(gaps);
        // Sorted by DAY_ORDER.
        expect(out).toEqual([...out].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)));
      }
    }
  });

  it("k=7 is the identity (wraps the wheel)", () => {
    expect(rotateDays(["MO", "WE", "FR"], 7)).toEqual(["MO", "WE", "FR"]);
  });

  it("rotatedRule changes only byDays and round-trips through parseSchedule", () => {
    const rule = weeklyRule(["MO", "WE", "FR"], ["07:00", "19:00"]);
    const next = rotatedRule(rule, 2);
    const parsed = parseSchedule(next);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].times).toEqual(["07:00", "19:00"]);
    expect(parsed[0].dayPattern).toEqual({ kind: "weekly", byDays: ["WE", "FR", "SU"] });
    // Canonical stored form — JSON.stringify(parseSchedule(rule)).
    expect(next).toBe(JSON.stringify(parseSchedule(next)));
  });
});

// ── Dedupe by date ─────────────────────────────────────────────────────────
const MON_7_SEP = D(2026, 9, 7);

describe("counting", () => {
  it("a two-time protocol counts once per day but appears under both times", () => {
    const twice = proto({
      id: "D",
      scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00", "19:00"]),
      startDate: D(2026, 1, 1),
      shiftPinned: true,
    });
    const cand = proto({
      id: "C",
      scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]),
      startDate: D(2026, 1, 1),
    });
    const plan = computeShiftPlan({ protocols: [twice, cand], today: MON_7_SEP });
    expect(plan.current).toEqual([2, 0, 2, 0, 2, 0, 0]); // NOT 3 on Mon/Wed/Fri
    const s = plan.suggestions[0];
    expect(s.protocolId).toBe("C");
    expect(s.before).toEqual([2, 0, 2, 0, 2, 0, 0]);
    expect(s.after).toEqual([1, 1, 1, 1, 1, 1, 0]);
    expect(s.perTime.map((t) => t.time)).toEqual(["07:00", "19:00"]);
    expect(s.perTime[0]).toEqual({
      time: "07:00",
      before: [2, 0, 2, 0, 2, 0, 0],
      after: [1, 1, 1, 1, 1, 1, 0],
    });
    expect(s.perTime[1]).toEqual({
      time: "19:00",
      before: [1, 0, 1, 0, 1, 0, 0],
      after: [1, 0, 1, 0, 1, 0, 0],
    });
    expect(s.sameTimeDays).toEqual({ before: 3, after: 0 });
  });

  it("truncates at the course end — cyclePlanEnd and endDate both bite", () => {
    // cyclePlanEnd(2026-09-03, 1 week) = 2026-09-09 (Wed) — Thu/Fri drop out.
    const byCycle = proto({
      id: "E",
      scheduleRule: weeklyRule(["MO", "TU", "WE", "TH", "FR"]),
      startDate: D(2026, 8, 31),
      cycleOnWeeks: 1,
      cycleAnchor: D(2026, 9, 3),
      shiftPinned: true,
    });
    expect(courseEnd(byCycle)).toEqual(D(2026, 9, 9));
    expect(
      computeShiftPlan({ protocols: [byCycle], today: MON_7_SEP }).current,
    ).toEqual([1, 1, 1, 0, 0, 0, 0]);

    const byEnd = proto({
      id: "F",
      scheduleRule: weeklyRule(["MO", "TU", "WE", "TH", "FR"]),
      startDate: D(2026, 8, 31),
      endDate: D(2026, 9, 8),
      shiftPinned: true,
    });
    expect(
      computeShiftPlan({ protocols: [byEnd], today: MON_7_SEP }).current,
    ).toEqual([1, 1, 0, 0, 0, 0, 0]);
  });

  it("a course ending within 7 days is ends_soon — never moved, still counted", () => {
    const soon = proto({
      id: "G",
      scheduleRule: weeklyRule(["MO", "TU", "WE"]),
      startDate: D(2026, 8, 31),
      endDate: D(2026, 9, 10), // today + 3
    });
    const plan = computeShiftPlan({ protocols: [soon], today: MON_7_SEP });
    expect(plan.skipped).toEqual([{ protocolId: "G", reason: "ends_soon" }]);
    expect(plan.suggestions).toEqual([]);
    expect(plan.current).toEqual([1, 1, 1, 0, 0, 0, 0]);
  });
});

// ── Objective ──────────────────────────────────────────────────────────────
const pinnedOn = (id: string, byDays: WeekdayCode[], times: string[] = []) =>
  proto({ id, scheduleRule: weeklyRule(byDays, times), startDate: D(2026, 1, 1), shiftPinned: true });

describe("lexicographic objective", () => {
  it("peak ties across every k → sum of squares decides (and lower k breaks the tie)", () => {
    // Background: Mon 3, Tue 1, Wed 1 — the peak of 3 is pinned and unreachable,
    // so every rotation of C ties on peak. k=1 (→WE) keeps Σ² at 14/week; k=2..5
    // spread onto an empty day for 12/week. Lowest k of the winners is 2.
    const protocols = [
      pinnedOn("M1", ["MO"]),
      pinnedOn("M2", ["MO"]),
      pinnedOn("M3", ["MO"]),
      pinnedOn("T", ["TU"]),
      pinnedOn("W", ["WE"]),
      proto({ id: "C", scheduleRule: weeklyRule(["TU"]), startDate: D(2026, 1, 1) }),
    ];
    const plan = computeShiftPlan({ protocols, today: MON_7_SEP });
    expect(plan.suggestions[0].protocolId).toBe("C");
    expect(plan.suggestions[0].k).toBe(2);
    expect(plan.suggestions[0].toDays).toEqual(["TH"]);
    expect(plan.suggestions[0].before).toEqual([3, 2, 1, 0, 0, 0, 0]);
    expect(plan.suggestions[0].after).toEqual([3, 1, 1, 1, 0, 0, 0]);
  });

  it("peak and Σ² tie → same-time collisions decide which protocol moves", () => {
    // X and Y have identical patterns, so moving either gives the same counts.
    // X shares 07:00 with the pinned A; Y sits alone at 06:00. Moving X clears
    // three collision days a week, moving Y clears none.
    const protocols = [
      pinnedOn("A", ["MO", "WE", "FR"], ["07:00"]),
      proto({ id: "Y", scheduleRule: weeklyRule(["MO", "WE", "FR"], ["06:00"]), startDate: D(2026, 1, 1) }),
      proto({ id: "X", scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]), startDate: D(2026, 1, 1) }),
    ];
    const plan = computeShiftPlan({ protocols, today: MON_7_SEP });
    expect(plan.suggestions[0].protocolId).toBe("X"); // not Y, despite Y coming first
    expect(plan.suggestions[0].k).toBe(1);
  });

  it("every rotation ties on all three terms → fewest-moved wins, so no suggestion", () => {
    const alone = proto({ id: "S", scheduleRule: weeklyRule(["MO"]), startDate: D(2026, 1, 1) });
    const plan = computeShiftPlan({ protocols: [alone], today: MON_7_SEP });
    expect(plan.suggestions).toEqual([]);
    expect(plan.current).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });
});

// ── Steady-state basis ─────────────────────────────────────────────────────
describe("steady-state objective basis", () => {
  const fill = (id: string, day: WeekdayCode, startDate = D(2026, 1, 1)) =>
    proto({ id, scheduleRule: weeklyRule([day]), startDate, shiftPinned: true });

  // Monday carries three protocols and every other weekday exactly one, so
  // moving the single candidate off Monday always drops the peak from 3 to 2
  // and the only open question is which day it lands on. Wednesday's occupant
  // is the one whose start date moves between the two cases.
  const weekOf = (wedStart: Date): ShiftProtocolInput[] => [
    fill("mon-a", "MO"),
    fill("mon-b", "MO"),
    fill("tue", "TU"),
    fill("wed", "WE", wedStart),
    fill("thu", "TH"),
    fill("fri", "FR"),
    fill("sat", "SA"),
    fill("sun", "SU"),
    proto({ id: "C", scheduleRule: weeklyRule(["MO"]), startDate: D(2026, 1, 1) }),
  ];

  it("a start 10 days out contributes only its real slots", () => {
    // 2026-09-17 is today + 10, so the Wednesday protocol misses the first two
    // Wednesdays of the 28-day horizon. Wednesday is therefore the emptiest
    // target and the candidate rotates two days rather than one.
    const plan = computeShiftPlan({ protocols: weekOf(D(2026, 9, 17)), today: MON_7_SEP });
    expect(plan.suggestions.map((s) => [s.protocolId, s.k, s.toDays])).toEqual([["C", 2, ["WE"]]]);
  });

  it("a start 3 days out counts as already running", () => {
    // 2026-09-10 is today + 3, inside the week, so the Wednesday protocol
    // counts across the whole horizon. Tuesday and Wednesday now tie and the
    // lower k wins.
    const plan = computeShiftPlan({ protocols: weekOf(D(2026, 9, 10)), today: MON_7_SEP });
    expect(plan.suggestions.map((s) => [s.protocolId, s.k, s.toDays])).toEqual([["C", 1, ["TU"]]]);
    // The strip is still walked on the REAL runtimes: this week's Wednesday is
    // 2026-09-09, one day before that protocol starts, so it shows zero.
    expect(plan.current).toEqual([3, 1, 0, 1, 1, 1, 1]);
  });
});

// ── Standalone cards, apply/re-run termination, idempotence ────────────────
/**
 * Apply exactly ONE card, the way `applyShiftSuggestion` → `reviseProtocol`
 * does and the way the panel's Apply button does: the rotated rule and the
 * successor's start, every other course field carried through, the dose
 * history left alone. Nothing else in the set moves — that is the whole point
 * of scoring each card against the current state.
 */
const applyOne = (
  protocols: ShiftProtocolInput[],
  s: { protocolId: string; k: number; startDate: string },
): ShiftProtocolInput[] =>
  protocols.map((p) => {
    if (p.id !== s.protocolId || !p.scheduleRule) return p;
    const [y, m, d] = s.startDate.split("-").map(Number);
    return { ...p, scheduleRule: rotatedRule(p.scheduleRule, s.k), startDate: new Date(y, m - 1, d) };
  });

/**
 * Re-run the engine after applying one card and return the plan whose strip
 * spans that card's OWN week.
 *
 * `plan.current` is measured over the first full Mon–Sun week on/after the day
 * it is computed for, while a card's strip is the first such week on/after the
 * SUCCESSOR's first dose. Those usually coincide (the successor starts within
 * the same window), and when they do the re-run is done at `today` — exactly
 * what the panel does. When the successor starts after that Monday its strip is
 * the following week, so the re-run is done at the successor's own start date,
 * whose first Monday on/after is that same week by construction. Either way
 * `current` is a plain seven-date walk of the real runtimes — the same thing
 * `after` is — so all that is being aligned is WHICH seven.
 */
const replanAfterApplying = (
  protocols: ShiftProtocolInput[],
  s: ShiftSuggestion,
  today: Date,
): ShiftPlan => {
  const applied = applyOne(protocols, s);
  const atToday = computeShiftPlan({ protocols: applied, today });
  return atToday.weekStart === s.weekStart
    ? atToday
    : computeShiftPlan({ protocols: applied, today: parseDayKey(s.startDate) });
};

// Two more sets alongside the worked example, deliberately unlike it: uneven
// weekly sizes, a pinned and a stacked protocol that count but never move, an
// end date, and cycle plans of both kinds. Every cycle carries an explicit
// anchor so applying a card cannot move a course end and muddy what the
// property below is actually testing.
const FIXTURE_B: ShiftProtocolInput[] = [
  proto({ id: "B1", scheduleRule: weeklyRule(["MO", "TH"], ["08:00"]), startDate: D(2026, 3, 2) }),
  proto({
    id: "B2",
    scheduleRule: weeklyRule(["MO", "TH"], ["08:00"]),
    startDate: D(2026, 4, 6),
    loggedDayKeys: ["2026-09-03"],
  }),
  proto({ id: "B3", scheduleRule: weeklyRule(["TU", "FR"], ["20:00"]), startDate: D(2026, 5, 4), shiftPinned: true }),
  proto({
    id: "B4",
    scheduleRule: weeklyRule(["MO"], ["08:00"]),
    startDate: D(2026, 6, 1),
    cycleOnWeeks: 26,
    cycleOffWeeks: 2,
    cycleAnchor: D(2026, 6, 1),
  }),
];

const FIXTURE_C: ShiftProtocolInput[] = [
  proto({
    id: "C1",
    scheduleRule: weeklyRule(["WE", "SA"], ["06:30"]),
    startDate: D(2026, 7, 1),
    endDate: D(2026, 12, 1),
  }),
  proto({ id: "C2", scheduleRule: weeklyRule(["WE", "SA"], ["06:30"]), startDate: D(2026, 7, 8) }),
  proto({
    id: "C3",
    scheduleRule: weeklyRule(["MO", "TU", "WE", "TH"], ["19:00"]),
    startDate: D(2026, 8, 10),
    stackId: "stack-1",
  }),
  proto({
    id: "C4",
    scheduleRule: weeklyRule(["WE"], ["06:30"]),
    startDate: D(2026, 8, 24),
    cycleOnWeeks: 12,
    cycleAnchor: D(2026, 8, 24),
  }),
];

describe("a card's promise holds when it is applied ALONE", () => {
  // The problem this guards against: under the greedy chain, card n's `after` was
  // only reachable if cards 1..n-1 had been applied first, yet each card has
  // its own Apply. Card 3 of the worked example promised [2,2,2,2,3,3,2] and
  // delivered [4,2,3,1,4,1,1] when applied on its own.
  const cases: [string, ShiftProtocolInput[], Date][] = [
    ["the worked example", [P1, P2, P3, P4], FRI_4_SEP],
    ["uneven weekly sizes, one pinned protocol", FIXTURE_B, MON_7_SEP],
    ["twice-weekly courses, an end date and a stacked protocol", FIXTURE_C, D(2026, 9, 10)],
  ];

  it.each(cases)("%s — every card delivers exactly its own `after`", (_label, protocols, today) => {
    const plan = computeShiftPlan({ protocols, today });
    expect(plan.suggestions.length).toBeGreaterThan(0);
    for (const s of plan.suggestions) {
      const re = replanAfterApplying(protocols, s, today);
      expect(re.weekStart).toBe(s.weekStart);
      expect(re.current).toEqual(s.after);
    }
  });
});

describe("apply → re-run → apply", () => {
  it("the worked example settles in three rounds and stays settled", () => {
    // The loop the UI performs: apply the FIRST card, re-run, repeat. By hand
    // over the same four-whole-week horizon (per-week Σ² in brackets):
    //   round 0  [4,2,4,2,4,0,0] (56) → P4 k=1
    //   round 1  [3,3,3,3,3,1,0] (46) → P1 k=2   (P2 k=2 and P3 k=2 also
    //                                             improve; P1 wins on input
    //                                             order at an equal score)
    //   round 2  [2,2,3,3,3,2,1] (40) → P2 k=4   (the only improving move left)
    //   round 3  [2,2,2,2,3,3,2] (38) → nothing improves; peak 3 with five 2s
    // Bounded by one move per candidate, so at most four rounds for four
    // candidates.
    let protocols: ShiftProtocolInput[] = [P1, P2, P3, P4];
    const applied: [string, number][] = [];
    let rounds = 0;
    for (; rounds <= 4; rounds++) {
      const plan = computeShiftPlan({ protocols, today: FRI_4_SEP });
      if (plan.suggestions.length === 0) break;
      const first = plan.suggestions[0];
      applied.push([first.protocolId, first.k]);
      protocols = applyOne(protocols, first);
    }
    expect(rounds).toBeLessThanOrEqual(4);
    expect(applied).toEqual([
      ["P4", 1],
      ["P1", 2],
      ["P2", 4],
    ]);

    const settled = computeShiftPlan({ protocols, today: FRI_4_SEP });
    expect(settled.suggestions).toEqual([]);
    expect(settled.current).toEqual([2, 2, 2, 2, 3, 3, 2]);

    // And it stays a fixed point as today advances — the horizon is always
    // four whole weeks, so a rotation can only re-shape the week, never shrink
    // it, and nothing can win back what it lost in a transition window.
    for (const offset of [1, 3, 9]) {
      const today = new Date(2026, 8, 4 + offset);
      expect(computeShiftPlan({ protocols, today }).suggestions).toEqual([]);
    }
  });

  it("the flip-flop case settles in one round (regression)", () => {
    // Under the old gated objective this pair oscillated for ever — round 0
    // k=1, round 1 k=5, round 2 k=2 — because each rotation could lower Σ² by
    // dropping the doses between today and the successor's start.
    const protocols: ShiftProtocolInput[] = [
      pinnedOn("A", ["MO", "WE", "FR"], ["07:00"]),
      proto({ id: "C", scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]), startDate: D(2026, 1, 1) }),
    ];
    const round0 = computeShiftPlan({ protocols, today: MON_7_SEP });
    expect(round0.suggestions.map((s) => [s.protocolId, s.k])).toEqual([["C", 1]]);

    const round1 = computeShiftPlan({
      protocols: applyOne(protocols, round0.suggestions[0]),
      today: MON_7_SEP,
    });
    expect(round1.suggestions).toEqual([]);
  });

  it("a pathological all-Monday set offers at most one card per protocol", () => {
    const protocols = Array.from({ length: 6 }, (_, i) =>
      proto({ id: `p${i}`, scheduleRule: weeklyRule(["MO"]), startDate: D(2026, 1, 1) }),
    );
    const plan = computeShiftPlan({ protocols, today: MON_7_SEP });
    expect(plan.current).toEqual([6, 0, 0, 0, 0, 0, 0]);
    expect(plan.suggestions.length).toBeLessThanOrEqual(6);
    expect(new Set(plan.suggestions.map((s) => s.protocolId)).size).toBe(plan.suggestions.length);
  });
});

// ── Skip rules ─────────────────────────────────────────────────────────────
describe("eligibility", () => {
  const base = { startDate: D(2026, 1, 1) };

  it("inactive", () => {
    const p = proto({ id: "x", status: "completed", scheduleRule: weeklyRule(["MO"]), ...base });
    expect(eligibility(p, MON_7_SEP)).toEqual({ ok: false, reason: "inactive" });
  });

  it("no_rule — null, blank and unparseable rules", () => {
    for (const rule of [null, "", "   ", "[[[not json"]) {
      const p = proto({ id: "x", scheduleRule: rule, ...base });
      expect(eligibility(p, MON_7_SEP)).toEqual({ ok: false, reason: "no_rule" });
    }
  });

  it("not_weekly — daily, interval, cycle, two entries, 7-day and 0-day weekly", () => {
    const rules = [
      JSON.stringify([{ dayPattern: { kind: "daily" }, times: [] }]),
      JSON.stringify([{ dayPattern: { kind: "interval", everyDays: 3 }, times: [] }]),
      JSON.stringify([{ dayPattern: { kind: "cycle", onDays: 5, offDays: 2 }, times: [] }]),
      JSON.stringify([
        { dayPattern: { kind: "weekly", byDays: ["MO"] }, times: [] },
        { dayPattern: { kind: "weekly", byDays: ["TH"] }, times: [] },
      ]),
      weeklyRule(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]),
      weeklyRule([]),
      "FREQ=DAILY", // legacy RRULE upgrades to a daily entry
    ];
    for (const rule of rules) {
      const p = proto({ id: "x", scheduleRule: rule, ...base });
      expect(eligibility(p, MON_7_SEP)).toEqual({ ok: false, reason: "not_weekly" });
    }
  });

  it("stack, then pinned, then ends_soon — checked in that order", () => {
    const p = proto({ id: "x", scheduleRule: weeklyRule(["MO"]), stackId: "s1", ...base });
    expect(eligibility(p, MON_7_SEP)).toEqual({ ok: false, reason: "stack" });
    expect(eligibility({ ...p, stackId: null, shiftPinned: true }, MON_7_SEP)).toEqual({
      ok: false,
      reason: "pinned",
    });
    // Exactly today + 7 is still too soon; today + 8 is fine.
    const soon = { ...p, stackId: null, endDate: D(2026, 9, 14) };
    expect(eligibility(soon, MON_7_SEP)).toEqual({ ok: false, reason: "ends_soon" });
    const ok = eligibility({ ...soon, endDate: D(2026, 9, 15) }, MON_7_SEP);
    expect(ok.ok).toBe(true);
  });

  it("an eligible protocol returns its entry and DAY_ORDER-sorted byDays", () => {
    const p = proto({ id: "x", scheduleRule: weeklyRule(["FR", "MO", "WE"], ["07:00"]), ...base });
    const res = eligibility(p, MON_7_SEP);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.byDays).toEqual(["MO", "WE", "FR"]);
      expect(res.entry.times).toEqual(["07:00"]);
    }
  });
});

describe("skip reporting", () => {
  it("pinned protocols are listed in skipped and in pinned, and still count", () => {
    const plan = computeShiftPlan({
      protocols: [
        pinnedOn("pin", ["MO", "WE", "FR"]),
        proto({ id: "stk", scheduleRule: weeklyRule(["MO"]), startDate: D(2026, 1, 1), stackId: "s1" }),
        proto({ id: "dead", status: "completed", scheduleRule: weeklyRule(["MO"]), startDate: D(2026, 1, 1) }),
      ],
      today: MON_7_SEP,
    });
    expect(plan.pinned).toEqual(["pin"]);
    expect(plan.skipped).toEqual([
      { protocolId: "pin", reason: "pinned" },
      { protocolId: "stk", reason: "stack" },
      { protocolId: "dead", reason: "inactive" },
    ]);
    // pinned + stacked count (2 on Mon); the completed protocol does not.
    expect(plan.current).toEqual([2, 0, 1, 0, 1, 0, 0]);
  });

  it("an unparseable rule does not throw — the protocol is skipped as no_rule", () => {
    expect(() =>
      computeShiftPlan({
        protocols: [proto({ id: "bad", scheduleRule: "[{oops", startDate: D(2026, 1, 1) })],
        today: MON_7_SEP,
      }),
    ).not.toThrow();
    const plan = computeShiftPlan({
      protocols: [proto({ id: "bad", scheduleRule: "[{oops", startDate: D(2026, 1, 1) })],
      today: MON_7_SEP,
    });
    expect(plan.skipped).toEqual([{ protocolId: "bad", reason: "no_rule" }]);
    expect(plan.current).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

// ── Transition ─────────────────────────────────────────────────────────────
describe("transition", () => {
  it("a rotation that lands on today (unlogged) starts today and removes nothing", () => {
    // Background makes Wed the emptiest day; C on MO rotates k=2 → WE, and today
    // IS a Wednesday, so the successor starts today.
    const WED_9_SEP = D(2026, 9, 9);
    const protocols = [
      pinnedOn("M1", ["MO"]),
      pinnedOn("M2", ["MO"]),
      pinnedOn("M3", ["MO"]),
      pinnedOn("T", ["TU"]),
      pinnedOn("W", ["WE"]),
      proto({ id: "C", scheduleRule: weeklyRule(["TU"]), startDate: D(2026, 1, 1) }),
    ];
    const plan = computeShiftPlan({ protocols, today: WED_9_SEP });
    const s = plan.suggestions[0];
    expect(s.protocolId).toBe("C");
    expect(s.toDays).toEqual(["TH"]);
    expect(s.startDate).toBe("2026-09-10");
    expect(s.removedDoseDates).toEqual([]); // no predecessor dose in [Wed, Thu)
  });

  it("k landing on today with today unlogged → startDate is today, nothing removed", () => {
    expect(
      dayKey(
        successorStartDate({
          toDays: ["MO", "WE", "FR"],
          today: MON_7_SEP,
          protocolStartDate: D(2026, 1, 1),
          todayLogged: false,
        }),
      ),
    ).toBe("2026-09-07");
  });

  it("a protocol whose startDate is today cannot revise onto today", () => {
    expect(
      dayKey(
        successorStartDate({
          toDays: ["MO", "WE", "FR"],
          today: MON_7_SEP,
          protocolStartDate: MON_7_SEP,
          todayLogged: false,
        }),
      ),
    ).toBe("2026-09-09");
  });
});

describe("successorStartDate", () => {
  it("first matching day on or after today", () => {
    const out = successorStartDate({
      toDays: ["TU", "TH", "SA"],
      today: MON_7_SEP,
      protocolStartDate: D(2026, 1, 1),
      todayLogged: false,
    });
    expect(dayKey(out)).toBe("2026-09-08");
  });

  it("today logged → search starts tomorrow", () => {
    const out = successorStartDate({
      toDays: ["MO", "WE", "FR"],
      today: MON_7_SEP,
      protocolStartDate: D(2026, 1, 1),
      todayLogged: true,
    });
    expect(dayKey(out)).toBe("2026-09-09");
  });

  it("a future protocol start pushes the successor past it", () => {
    const out = successorStartDate({
      toDays: ["MO"],
      today: MON_7_SEP,
      protocolStartDate: D(2026, 9, 21),
      todayLogged: false,
    });
    expect(dayKey(out)).toBe("2026-09-28");
  });

  it("null protocol start imposes no lower bound", () => {
    const out = successorStartDate({
      toDays: ["MO"],
      today: MON_7_SEP,
      protocolStartDate: null,
      todayLogged: false,
    });
    expect(dayKey(out)).toBe("2026-09-07");
  });
});

describe("courseEnd", () => {
  const nil = {
    startDate: null,
    endDate: null,
    cycleOnWeeks: null,
    cycleOffWeeks: null,
    cycleAnchor: null,
  };
  it("neither → null", () => {
    expect(courseEnd(nil)).toBeNull();
  });
  it("endDate only", () => {
    expect(courseEnd({ ...nil, endDate: D(2026, 10, 1) })).toEqual(D(2026, 10, 1));
  });
  it("cycle only — anchor + onWeeks, last dosing day inclusive", () => {
    expect(courseEnd({ ...nil, cycleAnchor: D(2026, 9, 7), cycleOnWeeks: 2 })).toEqual(D(2026, 9, 20));
  });
  it("cycle anchor falls back to startDate", () => {
    expect(courseEnd({ ...nil, startDate: D(2026, 9, 7), cycleOnWeeks: 2 })).toEqual(D(2026, 9, 20));
  });
  it("both → the earlier of the two", () => {
    expect(
      courseEnd({ ...nil, endDate: D(2026, 9, 10), cycleAnchor: D(2026, 9, 7), cycleOnWeeks: 2 }),
    ).toEqual(D(2026, 9, 10));
    expect(
      courseEnd({ ...nil, endDate: D(2026, 12, 10), cycleAnchor: D(2026, 9, 7), cycleOnWeeks: 2 }),
    ).toEqual(D(2026, 9, 20));
  });

  // Only a TERMINAL plan (no off-weeks) ends the course, mirroring
  // forecast-slots' `repeats` gate.
  it("a TERMINAL cycle (no off-weeks) ends the course at its plan end", () => {
    expect(courseEnd({ ...nil, cycleAnchor: D(2026, 9, 7), cycleOnWeeks: 2, cycleOffWeeks: null })).toEqual(
      D(2026, 9, 20),
    );
    expect(courseEnd({ ...nil, cycleAnchor: D(2026, 9, 7), cycleOnWeeks: 2, cycleOffWeeks: 0 })).toEqual(
      D(2026, 9, 20),
    );
  });
  it("a REPEATING cycle with an endDate ends at the endDate, never the plan end", () => {
    expect(
      courseEnd({
        ...nil,
        endDate: D(2026, 12, 10),
        cycleAnchor: D(2026, 9, 7),
        cycleOnWeeks: 2,
        cycleOffWeeks: 4,
      }),
    ).toEqual(D(2026, 12, 10));
  });
  it("a REPEATING cycle with no endDate never ends", () => {
    expect(
      courseEnd({ ...nil, cycleAnchor: D(2026, 9, 7), cycleOnWeeks: 2, cycleOffWeeks: 4 }),
    ).toBeNull();
  });
});

describe("a repeating cycle is not a course end", () => {
  // MWF, 8 on / 4 off, no anchor, started 2026-01-05, no endDate, today Mon
  // 2026-09-07. cyclePlanEnd(2026-01-05, 8) is 2026-02-29 — eight months in the
  // past — so under the old unconditional truncation this protocol contributed
  // ZERO doses to the objective and read "course ends within a week" for ever,
  // however long it had actually been running.
  const repeating = proto({
    id: "R",
    scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]),
    startDate: D(2026, 1, 5),
    endDate: null,
    cycleOnWeeks: 8,
    cycleOffWeeks: 4,
    cycleAnchor: null,
  });

  it("courseEnd is null, so it is neither ends_soon nor truncated", () => {
    expect(courseEnd(repeating)).toBeNull();
    const el = eligibility(repeating, MON_7_SEP);
    expect(el.ok).toBe(true);
  });

  it("contributes its normal three doses a week and is a candidate", () => {
    const plan = computeShiftPlan({
      protocols: [repeating, pinnedOn("M1", ["MO"]), pinnedOn("M2", ["MO"])],
      today: MON_7_SEP,
    });
    expect(plan.skipped).toEqual([
      { protocolId: "M1", reason: "pinned" },
      { protocolId: "M2", reason: "pinned" },
    ]);
    expect(plan.current).toEqual([3, 0, 1, 0, 1, 0, 0]);
    expect(plan.suggestions.map((s) => s.protocolId)).toContain("R");
  });
});

describe("shiftFingerprint", () => {
  const args = { protocolId: "p1", scheduleRule: weeklyRule(["MO"]), startDate: D(2026, 9, 7), k: 1 };
  it("is stable for the same inputs", () => {
    expect(shiftFingerprint(args)).toBe(shiftFingerprint({ ...args }));
    expect(shiftFingerprint(args)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("changes when any component changes", () => {
    const seen = new Set([
      shiftFingerprint(args),
      shiftFingerprint({ ...args, protocolId: "p2" }),
      shiftFingerprint({ ...args, scheduleRule: weeklyRule(["TU"]) }),
      shiftFingerprint({ ...args, scheduleRule: null }),
      shiftFingerprint({ ...args, startDate: D(2026, 9, 8) }),
      shiftFingerprint({ ...args, startDate: null }),
      shiftFingerprint({ ...args, k: 2 }),
    ]);
    expect(seen.size).toBe(7);
  });
});

describe("dayKey", () => {
  it("zero-pads the local calendar day", () => {
    expect(dayKey(D(2026, 1, 5))).toBe("2026-01-05");
    expect(dayKey(new Date(2026, 8, 4, 23, 59))).toBe("2026-09-04");
  });
});

it("SHIFT_HORIZON_DAYS is 28", () => {
  expect(SHIFT_HORIZON_DAYS).toBe(28);
});


describe("eligibility reason order", () => {
  it("a stack component on a DAILY rule reads 'stack', not 'not_weekly' (the panel's copy depends on it)", () => {
    const p: ShiftProtocolInput = {
      id: "s", name: "s", peptideName: "x", status: "active",
      scheduleRule: JSON.stringify([{ dayPattern: { kind: "daily" }, times: [] }]),
      startDate: new Date(2026, 7, 28), endDate: null, cycleOnWeeks: null, cycleOffWeeks: null, cycleAnchor: null,
      stackId: "stack-1", shiftPinned: false, loggedDayKeys: [],
    };
    expect(eligibility(p, new Date(2026, 8, 4))).toEqual({ ok: false, reason: "stack" });
    expect(eligibility({ ...p, stackId: null, shiftPinned: true }, new Date(2026, 8, 4))).toEqual({ ok: false, reason: "pinned" });
    expect(eligibility({ ...p, stackId: null }, new Date(2026, 8, 4))).toEqual({ ok: false, reason: "not_weekly" });
  });
});

describe("a rotation must preserve the dose count inside the horizon", () => {
  // The shape that motivates this rule: a Mon–Fri course with two weeks
  // left can be rotated to Sat–Wed, and its Σ² win comes from the dose that falls
  // past its own end date — not from a flatter week.
  const FRI = new Date(2026, 8, 4);
  const mf = (times: string[]) =>
    JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "TU", "WE", "TH", "FR"] }, times }]);
  const daily = JSON.stringify([{ dayPattern: { kind: "daily" }, times: ["07:00"] }]);
  const base = {
    status: "active",
    cycleOnWeeks: null,
    cycleOffWeeks: null,
    cycleAnchor: null,
    stackId: null,
    shiftPinned: false,
    loggedDayKeys: [] as string[],
    peptideName: "x",
  };
  const protocols: ShiftProtocolInput[] = [
    // Mon–Fri ending on a Friday 14 days out: every rotation drops one dose.
    { ...base, id: "short", name: "short", scheduleRule: mf(["07:00"]), startDate: new Date(2026, 7, 25), endDate: new Date(2026, 8, 18) },
    // Mon–Fri with the whole horizon ahead of it: every rotation is count-preserving.
    { ...base, id: "long", name: "long", scheduleRule: mf(["21:00"]), startDate: new Date(2026, 7, 26), endDate: new Date(2026, 9, 20) },
    // Mon–Fri ending on a Wednesday: only some k keep the count.
    { ...base, id: "mid", name: "mid", scheduleRule: mf(["21:00"]), startDate: new Date(2026, 7, 11), endDate: new Date(2026, 8, 30) },
    { ...base, id: "daily", name: "daily", scheduleRule: daily, startDate: new Date(2026, 7, 16), endDate: null },
  ];

  it("offers a Friday-ending Mon–Fri course only the rotations that keep every dose (k=1..4)", () => {
    // Re-derived by hand, window Fri 09-04 … Thu 10-01, course end Fri 09-18.
    // Base Mon–Fri days in that window and on/before the end: 09-04; 09-07..11;
    // 09-14..18 = 11 doses. Rotated:
    //   k=1 Tue–Sat  09-04,05 · 09-08..12 · 09-15..18            = 11 ✓
    //   k=2 Wed–Sun  09-04,05,06 · 09-09..13 · 09-16,17,18       = 11 ✓
    //   k=3 Thu–Mon  09-04,05,06,07 · 09-10..14 · 09-17,18       = 11 ✓
    //   k=4 Fri–Tue  09-04..08 · 09-11..15 · 09-18               = 11 ✓
    //   k=5 Sat–Wed  09-05..09 · 09-12..16                       = 10 ✗
    //   k=6 Sun–Thu  09-06..10 · 09-13..17                       = 10 ✗
    // (An earlier version of this comment claimed 10 for k=1 and k=2; the
    // counts above are the ones both the hand walk and the engine agree on —
    // the two extra weekend days a forward rotation picks up before the end
    // exactly replace the weekdays it loses after it. Only k=5 and k=6 push a
    // dose past 09-18 without compensation.) Before this rule the engine picked k=5
    // for exactly this shape, banking the dropped dose as Σ².
    const plan = computeShiftPlan({ protocols, today: FRI });
    // Still a candidate (ends more than 7 days out).
    expect(plan.skipped.find((s) => s.protocolId === "short")).toBeUndefined();
    for (const s of plan.suggestions.filter((x) => x.protocolId === "short")) {
      expect([1, 2, 3, 4]).toContain(s.k);
    }
    // All three Mon–Fri courses have the same best move (k=2, Wed–Sun), so they
    // tie on peak and Σ² and fall back to input order — `long` first.
    expect(plan.suggestions.map((s) => [s.protocolId, s.k])).toEqual([
      ["long", 2],
      ["mid", 2],
      ["short", 2],
    ]);
  });

  it("every suggestion keeps the candidate's dose count over the 28-day horizon", () => {
    const plan = computeShiftPlan({ protocols, today: FRI });
    expect(plan.suggestions.length).toBeGreaterThan(0);
    const horizonEnd = addDays(FRI, SHIFT_HORIZON_DAYS - 1);
    for (const s of plan.suggestions) {
      const p = protocols.find((x) => x.id === s.protocolId)!;
      const end = courseEnd(p);
      const count = (rule: string) =>
        new Set(slotsInRange(parseSchedule(rule), FRI, horizonEnd, p.startDate, end).map((sl) => dayKey(sl.date))).size;
      expect(count(rotatedRule(p.scheduleRule as string, s.k))).toBe(count(p.scheduleRule as string));
    }
  });

  // The Apply boundary's own re-check, on the SAME "short" fixture — a
  // Mon–Fri course ending on a Friday 14 days out (09-18, from today 09-04).
  // By the by-hand count above (11 doses now), k=5 (Sat–Wed, 10) drops one;
  // k=3 (Thu–Mon, 11) does not, and neither does k=1 (Tue–Sat, 11).
  it("rotationPreservesCount is false for k=5 (drops a dose) and true for k=3 (count-preserving)", () => {
    const short = protocols.find((p) => p.id === "short")!;
    expect(rotationPreservesCount({ protocol: short, k: 5, today: FRI })).toBe(false);
    expect(rotationPreservesCount({ protocol: short, k: 6, today: FRI })).toBe(false);
    expect(rotationPreservesCount({ protocol: short, k: 3, today: FRI })).toBe(true);
    expect(rotationPreservesCount({ protocol: short, k: 1, today: FRI })).toBe(true);
  });
});

// ── Per-protocol grid rows ─────────────────────────────────────────────────
/**
 * The rows ARE the strips, split per protocol — they are read off the same
 * walks `before`/`after` are summed from, so anything that recomputed them
 * independently could drift from the totals the card also prints. These are
 * the invariants the UI's week grid is drawn on.
 */
const expectRowInvariants = (s: ShiftSuggestion) => {
  expect(s.rows.length).toBeGreaterThan(0);
  // Exactly one mover, and it leads.
  expect(s.rows.filter((r) => r.moved).map((r) => r.protocolId)).toEqual([s.protocolId]);
  expect(s.rows[0].moved).toBe(true);
  for (const r of s.rows) {
    expect(r.before).toHaveLength(7);
    expect(r.after).toHaveLength(7);
    // One dose per protocol per calendar day — a cell is 0 or 1, never 2.
    for (const v of [...r.before, ...r.after]) expect([0, 1]).toContain(v);
    // A non-mover's runtime is untouched, so its week cannot change.
    if (!r.moved) expect(r.after).toEqual(r.before);
  }
  const column = (pick: (r: ShiftRow) => number[]) =>
    Array.from({ length: 7 }, (_, i) => s.rows.reduce((n, r) => n + pick(r)[i], 0));
  expect(column((r) => r.before)).toEqual(s.before);
  expect(column((r) => r.after)).toEqual(s.after);
};

// A pinned two-times-a-day protocol under a single-time candidate: the pinned
// row must stay one cell a day while carrying both of its times.
const ROWS_TWICE: ShiftProtocolInput[] = [
  proto({
    id: "T1",
    name: "Morning and evening",
    peptideName: "Twice",
    scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00", "19:00"]),
    startDate: D(2026, 1, 1),
    shiftPinned: true,
  }),
  proto({
    id: "T2",
    name: "Morning",
    peptideName: "Once",
    scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]),
    startDate: D(2026, 1, 1),
  }),
];

// Today is a TUESDAY, so every successor starts inside 09-08..09-14 and the
// strip week is Mon 2026-09-14 whichever option wins. "L4" starts on the
// Wednesday of that very week — its row is the one with leading zeros.
const TUE_8_SEP = D(2026, 9, 8);
const ROWS_LATE_START: ShiftProtocolInput[] = [
  proto({ id: "L1", name: "MWF-a", peptideName: "MWF-a", scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]), startDate: D(2026, 1, 1), shiftPinned: true }),
  proto({ id: "L2", name: "MWF-b", peptideName: "MWF-b", scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]), startDate: D(2026, 1, 1), shiftPinned: true }),
  proto({ id: "L3", name: "MWF-c", peptideName: "MWF-c", scheduleRule: weeklyRule(["MO", "WE", "FR"], ["08:00"]), startDate: D(2026, 1, 1) }),
  proto({ id: "L4", name: "Weekdays", peptideName: "Late", scheduleRule: weeklyRule(["MO", "TU", "WE", "TH", "FR"], ["20:00"]), startDate: D(2026, 9, 16), shiftPinned: true }),
];

describe("per-protocol rows", () => {
  it("the worked example's first card pins P4 as the mover, Mon/Wed/Fri onto Tue/Thu/Sat", () => {
    const plan = computeShiftPlan({ protocols: [P1, P2, P3, P4], today: FRI_4_SEP });
    const mover = plan.suggestions[0].rows[0];
    expect(mover.protocolId).toBe("P4");
    expect(mover.peptideName).toBe("MWF-7");
    expect(mover.protocolName).toBe("MWF-7");
    expect(mover.times).toEqual(["07:00"]);
    expect(mover.moved).toBe(true);
    expect(mover.before).toEqual([1, 0, 1, 0, 1, 0, 0]);
    expect(mover.after).toEqual([0, 1, 0, 1, 0, 1, 0]);
  });

  it("the mover leads and every other active protocol follows in input order", () => {
    const plan = computeShiftPlan({ protocols: [P1, P2, P3, P4], today: FRI_4_SEP });
    expect(plan.suggestions[0].rows.map((r) => r.protocolId)).toEqual(["P4", "P1", "P2", "P3"]);
    expect(plan.suggestions.map((s) => s.rows[0].protocolId)).toEqual(["P4", "P3", "P1", "P2"]);
  });

  it("every card of the worked example splits its own strips exactly", () => {
    const plan = computeShiftPlan({ protocols: [P1, P2, P3, P4], today: FRI_4_SEP });
    expect(plan.suggestions).toHaveLength(4);
    for (const s of plan.suggestions) expectRowInvariants(s);
  });

  it("a two-times-a-day protocol is one cell a day and carries both of its times", () => {
    const plan = computeShiftPlan({ protocols: ROWS_TWICE, today: MON_7_SEP });
    const s = plan.suggestions[0];
    expect(s.protocolId).toBe("T2");
    expectRowInvariants(s);
    expect(s.rows.map((r) => r.protocolId)).toEqual(["T2", "T1"]);
    expect(s.rows[0].times).toEqual(["07:00"]);
    const twice = s.rows[1];
    expect(twice.protocolName).toBe("Morning and evening");
    expect(twice.peptideName).toBe("Twice");
    expect(twice.times).toEqual(["07:00", "19:00"]);
    expect(twice.before).toEqual([1, 0, 1, 0, 1, 0, 0]); // one cell, not two
    expect(twice.after).toEqual(twice.before);
  });

  it("an active protocol with no dose in the strip week gets no row at all", () => {
    // Counted as load (only "inactive" is ignored outright) but its course
    // ends 2026-09-09, five days before the strip week opens — seven empty
    // cells are not a row.
    const finished = proto({
      id: "T0",
      name: "Finished",
      peptideName: "Finished",
      scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]),
      startDate: D(2026, 1, 1),
      endDate: D(2026, 9, 9),
    });
    const plan = computeShiftPlan({ protocols: [finished, ...ROWS_TWICE], today: MON_7_SEP });
    expect(plan.skipped).toContainEqual({ protocolId: "T0", reason: "ends_soon" });
    const s = plan.suggestions.find((x) => x.protocolId === "T2") as ShiftSuggestion;
    expect(s.weekStart).toBe("2026-09-14");
    expect(s.rows.map((r) => r.protocolId)).toEqual(["T2", "T1"]);
    expectRowInvariants(s);
  });

  it("a protocol starting inside the strip week shows only the days it really runs", () => {
    const plan = computeShiftPlan({ protocols: ROWS_LATE_START, today: TUE_8_SEP });
    const s = plan.suggestions[0];
    expect(s.protocolId).toBe("L3");
    expect(s.weekStart).toBe("2026-09-14");
    expectRowInvariants(s);
    const late = s.rows.find((r) => r.protocolId === "L4") as ShiftRow;
    // L4 starts Wed 2026-09-16 — Mon and Tue of the strip week are before it.
    expect(late.before).toEqual([0, 0, 1, 1, 1, 0, 0]);
    expect(late.after).toEqual(late.before);
    expect(late.times).toEqual(["20:00"]);
  });

  it("rows never enter the fingerprint — an extra non-candidate adds a row, Apply is unchanged", () => {
    // A pinned Sunday protocol changes what the grid draws (one more row, and
    // a dose on the Sunday column) without touching anything the Apply request
    // is bound to: protocol id, stored rule, start date, k.
    const sunday = proto({
      id: "P5",
      name: "SU-12",
      peptideName: "SU-12",
      scheduleRule: weeklyRule(["SU"], ["12:00"]),
      startDate: D(2026, 1, 1),
      shiftPinned: true,
    });
    const without = computeShiftPlan({ protocols: [P1, P2, P3, P4], today: FRI_4_SEP });
    const with_ = computeShiftPlan({ protocols: [P1, P2, P3, P4, sunday], today: FRI_4_SEP });
    const a = without.suggestions.find((s) => s.protocolId === "P4") as ShiftSuggestion;
    const b = with_.suggestions.find((s) => s.protocolId === "P4") as ShiftSuggestion;
    expect(b.k).toBe(a.k);
    expect(b.rows.map((r) => r.protocolId)).toEqual([...a.rows.map((r) => r.protocolId), "P5"]);
    expect(b.rows).not.toEqual(a.rows);
    expect(b.before).not.toEqual(a.before); // the grid really did change
    expect(b.fingerprint).toBe(a.fingerprint);
  });
});

// ── The combined plan ──────────────────────────────────────────────────────
/**
 * An INDEPENDENT brute force for the combined search, sharing no code with the
 * engine's own: it counts with `slotsInRange` and a Set of day keys rather than
 * the engine's `Uint8Array` walks, rotates its own weekday sets, and
 * re-implements the four-term objective and the odometer from scratch.
 * Only `courseEnd` is borrowed — it is a primitive with its own describe
 * block above, and what is being cross-checked here is the SEARCH.
 *
 * If the two ever disagree, one of them is wrong, and the failure message says
 * which combination each of them picked.
 */
interface OracleWalk {
  days: number[];
  times: string[][];
}
interface OracleScore {
  peak: number;
  sumsq: number;
  collisions: number;
  moves: number;
}

const oracleWalk = (p: ShiftProtocolInput, k: number, today: Date): OracleWalk => {
  const entry = parseSchedule(p.scheduleRule)[0];
  const byDays = (entry.dayPattern as { kind: "weekly"; byDays: WeekdayCode[] }).byDays;
  const toDays = byDays.map((d) => DAY_ORDER[(DAY_ORDER.indexOf(d) + k) % 7]);
  // Steady-state basis: a start inside the next week counts as already
  // running, so only a further-out one floors the window.
  const floor = p.startDate && p.startDate > addDays(today, 7) ? p.startDate : null;
  const days = Array.from({ length: SHIFT_HORIZON_DAYS }, () => 0);
  const times: string[][] = Array.from({ length: SHIFT_HORIZON_DAYS }, () => []);
  const index = new Map<string, number>();
  for (let i = 0; i < SHIFT_HORIZON_DAYS; i++) index.set(dayKey(addDays(today, i)), i);
  const slots = slotsInRange(
    parseSchedule(weeklyRule(toDays, entry.times)),
    today,
    addDays(today, SHIFT_HORIZON_DAYS - 1),
    floor,
    courseEnd(p),
  );
  for (const slot of slots) {
    const i = index.get(dayKey(slot.date));
    if (i === undefined) continue;
    days[i] = 1; // one dose per protocol per calendar day
    if (slot.time !== null) times[i].push(slot.time);
  }
  return { days, times };
};

const oracleScore = (walks: OracleWalk[], moves: number): OracleScore => {
  let peak = 0;
  let sumsq = 0;
  let collisions = 0;
  for (let i = 0; i < SHIFT_HORIZON_DAYS; i++) {
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
  return { peak, sumsq, collisions, moves };
};

const cmpOracle = (a: OracleScore, b: OracleScore) =>
  a.peak - b.peak || a.sumsq - b.sumsq || a.collisions - b.collisions || a.moves - b.moves;

/** Each candidate's legal options, k = 0 (stay) first and then ascending k. */
const oracleOptions = (protocols: ShiftProtocolInput[], candidateIds: string[], today: Date) => {
  const base = protocols.map((p) => oracleWalk(p, 0, today));
  const total = (w: OracleWalk) => w.days.reduce((a, b) => a + b, 0);
  const at = candidateIds.map((id) => protocols.findIndex((p) => p.id === id));
  const choices = at.map((i) => {
    const legal: { k: number; walk: OracleWalk }[] = [{ k: 0, walk: base[i] }];
    for (let k = 1; k <= 6; k++) {
      const w = oracleWalk(protocols[i], k, today);
      if (total(w) === total(base[i])) legal.push({ k, walk: w }); // count-preserving rotations only
    }
    return legal;
  });
  return { base, at, choices };
};

const oracleBest = (
  protocols: ShiftProtocolInput[],
  candidateIds: string[],
  today: Date,
): { ks: number[]; score: OracleScore } => {
  const { base, at, choices } = oracleOptions(protocols, candidateIds, today);
  const cursor = choices.map(() => 0);
  let best: { ks: number[]; score: OracleScore } | null = null;
  for (;;) {
    const walks = base.slice();
    let moves = 0;
    for (let c = 0; c < choices.length; c++) {
      const opt = choices[c][cursor[c]];
      walks[at[c]] = opt.walk;
      if (opt.k !== 0) moves += 1;
    }
    const score = oracleScore(walks, moves);
    // Ascending k-vector order (last index fastest) plus a strict `<` leaves
    // the lexicographically smallest winner standing — the combined plan's tie-break.
    if (best === null || cmpOracle(score, best.score) < 0) {
      best = { ks: choices.map((o, c) => o[cursor[c]].k), score };
    }
    let c = choices.length - 1;
    for (; c >= 0; c--) {
      cursor[c] += 1;
      if (cursor[c] < choices[c].length) break;
      cursor[c] = 0;
    }
    if (c < 0) break;
  }
  return best as { ks: number[]; score: OracleScore };
};

/** The greedy chain: best strictly-improving single move, apply, repeat. */
const oracleGreedy = (
  protocols: ShiftProtocolInput[],
  candidateIds: string[],
  today: Date,
): { steps: [string, number][]; score: OracleScore } => {
  const { base, at, choices } = oracleOptions(protocols, candidateIds, today);
  const state = base.slice();
  const taken = new Set<number>();
  const steps: [string, number][] = [];

  for (let round = 0; round < choices.length; round++) {
    const stand = oracleScore(state, 0);
    let best: { c: number; k: number; walk: OracleWalk; score: OracleScore } | null = null;
    for (let c = 0; c < choices.length; c++) {
      if (taken.has(c)) continue;
      let candBest: { k: number; walk: OracleWalk; score: OracleScore } | null = null;
      for (const opt of choices[c]) {
        if (opt.k === 0) continue;
        const trial = state.slice();
        trial[at[c]] = opt.walk;
        const score = oracleScore(trial, 0);
        if (cmpOracle(score, stand) >= 0) continue;
        if (candBest === null || cmpOracle(score, candBest.score) < 0) {
          candBest = { k: opt.k, walk: opt.walk, score };
        }
      }
      if (!candBest) continue;
      // Score, then lower k, then input order — the card order.
      const rank = best === null ? -1 : cmpOracle(candBest.score, best.score);
      if (best === null || rank < 0 || (rank === 0 && candBest.k < best.k)) {
        best = { c: c, k: candBest.k, walk: candBest.walk, score: candBest.score };
      }
    }
    if (!best) break;
    state[at[best.c]] = best.walk;
    taken.add(best.c);
    steps.push([candidateIds[best.c], best.k]);
  }
  return { steps, score: oracleScore(state, steps.length) };
};

// Six protocols piled onto Monday at six different times: the smallest set the
// exhaustive search refuses (7⁶), so it takes the greedy path.
const SIX_MONDAYS: ShiftProtocolInput[] = Array.from({ length: 6 }, (_, i) =>
  proto({
    id: `M${i}`,
    name: `Monday ${i}`,
    peptideName: `Monday ${i}`,
    scheduleRule: weeklyRule(["MO"], [`0${i + 4}:00`]),
    startDate: D(2026, 1, 1),
  }),
);

const COMBINED_CASES: [string, ShiftProtocolInput[], Date][] = [
  ["the worked example", [P1, P2, P3, P4], FRI_4_SEP],
  ["uneven weekly sizes, one pinned protocol", FIXTURE_B, MON_7_SEP],
  ["twice-weekly courses, an end date and a stacked protocol", FIXTURE_C, D(2026, 9, 10)],
  ["six protocols piled onto Monday (greedy path)", SIX_MONDAYS, MON_7_SEP],
];

/** Apply every move of a plan, one at a time, exactly as Apply-all does. */
const applyAll = (
  protocols: ShiftProtocolInput[],
  moves: { protocolId: string; k: number; startDate: string }[],
): ShiftProtocolInput[] => moves.reduce((acc, m) => applyOne(acc, m), protocols);

describe("combined plan", () => {
  it("the worked example — the exhaustive search finds what an independent brute force finds", () => {
    const protocols = [P1, P2, P3, P4];
    const ids = ["P1", "P2", "P3", "P4"];
    const plan = computeShiftPlan({ protocols, today: FRI_4_SEP });
    const c = plan.combined as CombinedPlan;
    expect(c).not.toBeNull();

    const oracle = oracleBest(protocols, ids, FRI_4_SEP);
    const engineKs = ids.map((id) => c.moves.find((m) => m.protocolId === id)?.k ?? 0);
    const chose = `engine ${JSON.stringify(c.moves.map((m) => [m.protocolId, m.k, m.startDate]))}` +
      ` / oracle k-vector ${JSON.stringify(oracle.ks)} score ${JSON.stringify(oracle.score)}`;

    expect(c.method).toBe("exhaustive");
    expect(engineKs, chose).toEqual(oracle.ks);
    expect(c.moves.length, chose).toBe(oracle.score.moves);
    expect(c.score.after, chose).toEqual({
      peak: oracle.score.peak,
      sumsq: oracle.score.sumsq,
      collisions: oracle.score.collisions,
    });

    // The same answer written out, so the numbers are readable without running
    // the oracle. Base [4,2,4,2,4,0,0]: peak 4, Σ² 224 over the 28 days, 12
    // same-time collisions. P1 stays; P2 (M–F 21:00) → Wed–Sun, P3 (MWF 06:00)
    // → Mon/Thu/Sat, P4 (MWF 07:00) → Tue/Fri/Sun gives [2,2,2,3,3,2,2]: peak
    // 3, Σ² 152, 8 collisions. The greedy chain reaches the same three numbers
    // with a different vector; the combined plan keeps the lexicographically smaller one.
    //
    // The SET is that k-vector; the ORDER is best-prefix-first
    // (`orderByBestPrefix`), because Apply-all applies the moves one at a time and
    // stops at the first failure — so P4 leads, then P3, then P2, which is the
    // descent the prefix test below pins.
    expect(c.moves.map((m) => [m.protocolId, m.k])).toEqual([
      ["P4", 4],
      ["P3", 3],
      ["P2", 2],
    ]);
    expect(c.moves.map((m) => m.toDays)).toEqual([
      ["TU", "FR", "SU"],
      ["MO", "TH", "SA"],
      ["WE", "TH", "FR", "SA", "SU"],
    ]);
    expect(c.weekStart).toBe("2026-09-07");
    expect(c.before).toEqual([4, 2, 4, 2, 4, 0, 0]);
    expect(c.after).toEqual([2, 2, 2, 3, 3, 2, 2]);
    expect(c.score).toEqual({
      before: { peak: 4, sumsq: 224, collisions: 12 },
      after: { peak: 3, sumsq: 152, collisions: 8 },
    });
    expect(c.sameTimeDays).toEqual({ before: 3, after: 2 });

    // Transition facts are each move's own, computed as if it were the only one.
    expect(c.moves.map((m) => m.startDate)).toEqual(["2026-09-04", "2026-09-05", "2026-09-04"]);
    expect(c.moves.map((m) => m.removedDoseDates)).toEqual([[], ["2026-09-04"], []]);
    expect(c.moves.map((m) => m.lastDoseDate)).toEqual(["2026-09-03", "2026-09-02", "2026-09-03"]);
    expect(c.moves.map((m) => m.gapDays)).toEqual([1, 3, 1]);
    expect(c.moves.map((m) => m.usualGapDays)).toEqual([2, 2, 1]);
    expect(c.moves.map((m) => m.shorterThanUsual)).toEqual([true, false, false]);
    expect(c.moves.map((m) => m.protocolStartDate)).toEqual(["2026-09-03", "2026-08-03", "2026-08-31"]);
    // And each move's own week, which is NOT the plan's week — three movers.
    expect(c.moves.map((m) => m.standaloneAfter)).toEqual([
      [3, 3, 3, 2, 4, 0, 1],
      [4, 2, 3, 3, 3, 1, 0],
      [3, 1, 4, 2, 4, 1, 1],
    ]);
  });

  it.each(COMBINED_CASES)(
    "%s — rows sum to the strips, movers lead, fingerprints match the single-move ones",
    (_label, protocols, today) => {
      const plan = computeShiftPlan({ protocols, today });
      expect(plan.combined).not.toBeNull();
      const c = plan.combined as CombinedPlan;
      expect(c.moves.length).toBeGreaterThan(0);

      // One moved row per move, in `moves` order, and they lead.
      const movers = c.moves.map((m) => m.protocolId);
      expect(c.rows.filter((r) => r.moved).map((r) => r.protocolId)).toEqual(movers);
      expect(c.rows.slice(0, movers.length).map((r) => r.protocolId)).toEqual(movers);

      for (const r of c.rows) {
        expect(r.before).toHaveLength(7);
        expect(r.after).toHaveLength(7);
        // One dose per protocol per calendar day — a cell is 0 or 1.
        for (const v of [...r.before, ...r.after]) expect([0, 1]).toContain(v);
        // A non-mover's runtime is untouched, so its week cannot change.
        if (!r.moved) expect(r.after).toEqual(r.before);
      }
      const column = (pick: (r: ShiftRow) => number[]) =>
        Array.from({ length: 7 }, (_, i) => c.rows.reduce((n, r) => n + pick(r)[i], 0));
      expect(column((r) => r.before)).toEqual(c.before);
      expect(column((r) => r.after)).toEqual(c.after);

      // The plan is an improvement on standing still, on the search's own basis.
      const b = c.score.before;
      const a = c.score.after;
      const better =
        a.peak < b.peak ||
        (a.peak === b.peak && (a.sumsq < b.sumsq || (a.sumsq === b.sumsq && a.collisions < b.collisions)));
      expect(better).toBe(true);

      for (const m of c.moves) {
        const p = protocols.find((x) => x.id === m.protocolId) as ShiftProtocolInput;
        expect(m.k).toBeGreaterThanOrEqual(1);
        expect(m.k).toBeLessThanOrEqual(6);
        expect(m.toDays).toEqual(rotateDays(m.fromDays, m.k));
        // Identical to the standalone card's, so Apply is bound to the same
        // protocol state whichever button the user presses.
        expect(m.fingerprint).toBe(
          shiftFingerprint({ protocolId: p.id, scheduleRule: p.scheduleRule, startDate: p.startDate, k: m.k }),
        );
        expect(m.standaloneAfter).toHaveLength(7);
        // "Apply just this" must show the week that button really gives,
        // which is the plan's week only when the plan is a single move.
        if (c.moves.length > 1) expect(m.standaloneAfter).not.toEqual(c.after);
        else expect(m.standaloneAfter).toEqual(c.after);
      }
    },
  );

  it("a one-move plan's standaloneAfter IS the plan's after", () => {
    // Everything but MWF-7 pinned, so the only combination on offer is P4's.
    const protocols = [
      { ...P1, shiftPinned: true },
      { ...P2, shiftPinned: true },
      { ...P3, shiftPinned: true },
      P4,
    ];
    const c = computeShiftPlan({ protocols, today: FRI_4_SEP }).combined as CombinedPlan;
    expect(c.moves.map((m) => [m.protocolId, m.k])).toEqual([["P4", 1]]);
    expect(c.after).toEqual([3, 3, 3, 3, 3, 1, 0]);
    expect(c.moves[0].standaloneAfter).toEqual(c.after);
  });

  // ── Best-prefix-first order (partial apply) ──────────────────────────────
  // Apply-all lands the moves one at a time and stops at the first failure, and no
  // un-revise exists, so every PREFIX of `moves` is a state the user can
  // be left in permanently. The exhaustive search returns a JOINT optimum,
  // which has no prefix property at all — the engine therefore re-orders the
  // set it chose so each prefix is the best state reachable from the one
  // before it (`orderByBestPrefix`).
  it.each(COMBINED_CASES)(
    "%s — each move is the best of the ones still to come, measured on the search's own basis",
    (_label, protocols, today) => {
      const c = computeShiftPlan({ protocols, today }).combined as CombinedPlan;
      const applied = new Map<string, number>();
      // Scored by the independent oracle walk, not the engine's own arrays.
      const scoreWith = (extra: { protocolId: string; k: number }) =>
        oracleScore(
          protocols.map((p) =>
            oracleWalk(p, extra.protocolId === p.id ? extra.k : applied.get(p.id) ?? 0, today),
          ),
          0,
        );

      for (let n = 0; n < c.moves.length; n++) {
        const taken = scoreWith(c.moves[n]);
        for (const other of c.moves.slice(n + 1)) {
          const rank = cmpOracle(taken, scoreWith(other));
          expect(
            rank,
            `move ${n} (${c.moves[n].protocolId} k=${c.moves[n].k}) is beaten by ${other.protocolId} k=${other.k}`,
          ).toBeLessThanOrEqual(0);
        }
        applied.set(c.moves[n].protocolId, c.moves[n].k);
      }
    },
  );

  it("the move that raises the peak on its own goes LAST", () => {
    // Four Monday-anchored protocols on Mon 2026-09-07. The joint optimum moves
    // two of them (P2 k=3, P3 k=3): standing still is peak 3 / Σ² 136 / 16
    // collisions, the whole plan peak 3 / Σ² 120 / 8. In input order the FIRST
    // move applied alone gave peak 4 / Σ² 144 / 12 — a strictly worse week than
    // standing still, and permanent if the second move then raced. Ordered
    // best-prefix-first the peak-raising move goes second instead.
    const start = D(2026, 1, 5);
    const protocols = [
      proto({ id: "R0", scheduleRule: weeklyRule(["TU", "TH", "SA"], ["06:00"]), startDate: start }),
      proto({ id: "R1", scheduleRule: weeklyRule(["MO", "TH", "FR", "SA", "SU"], ["07:00"]), startDate: start }),
      proto({ id: "R2", scheduleRule: weeklyRule(["MO", "TU", "SA", "SU"], ["07:00"]), startDate: start }),
      proto({ id: "R3", scheduleRule: weeklyRule(["TH", "FR"], ["06:00"]), startDate: start }),
    ];
    const c = computeShiftPlan({ protocols, today: MON_7_SEP }).combined as CombinedPlan;

    expect(c.score).toEqual({
      before: { peak: 3, sumsq: 136, collisions: 16 },
      after: { peak: 3, sumsq: 120, collisions: 8 },
    });
    expect(c.moves.map((m) => [m.protocolId, m.k])).toEqual([
      ["R3", 3],
      ["R2", 3],
    ]);

    // What the order buys, stated as the two prefixes: R3 alone keeps the peak
    // at 3, R2 alone raises it to 4. Neither is an improvement on standing
    // still here — a joint optimum need not have one, which is exactly why the
    // confirm sheet says a partial apply can leave a day busier — but the
    // ordered prefix is the better of the two available.
    const alone = (id: string, k: number) =>
      oracleScore(protocols.map((p) => oracleWalk(p, p.id === id ? k : 0, MON_7_SEP)), 0);
    expect(alone("R3", 3)).toEqual({ peak: 3, sumsq: 144, collisions: 12, moves: 0 });
    expect(alone("R2", 3)).toEqual({ peak: 4, sumsq: 144, collisions: 12, moves: 0 });
  });

  it.each(COMBINED_CASES)("%s — applying every move settles the plan", (_label, protocols, today) => {
    const c = computeShiftPlan({ protocols, today }).combined as CombinedPlan;
    const applied = applyAll(protocols, c.moves);
    // Idempotence, at plan scale: the joint optimum is a fixed
    // point, and stays one as today advances (the horizon is always four whole
    // weeks, so a rotation can only re-shape the week, never shrink it).
    expect(computeShiftPlan({ protocols: applied, today }).combined).toBeNull();
    expect(computeShiftPlan({ protocols: applied, today: addDays(today, 3) }).combined).toBeNull();
  });

  it("combined is null when no combination improves on standing still", () => {
    // Seven protocols, one weekday each, one time each: peak 1 everywhere, so
    // every rotation collides something onto something else.
    const flat = (["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as WeekdayCode[]).map((day, i) =>
      proto({ id: day, scheduleRule: weeklyRule([day], [`0${i + 3}:00`]), startDate: D(2026, 1, 1) }),
    );
    const flatPlan = computeShiftPlan({ protocols: flat, today: MON_7_SEP });
    expect(flatPlan.current).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(flatPlan.suggestions).toEqual([]);
    expect(flatPlan.combined).toBeNull();

    // And a lone protocol, where every rotation ties on all three terms.
    const alone = proto({ id: "alone", scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]), startDate: D(2026, 1, 1) });
    expect(computeShiftPlan({ protocols: [alone], today: MON_7_SEP }).combined).toBeNull();
  });

  it("more than five candidates takes the greedy chain, still strictly improving and count-preserving", () => {
    const plan = computeShiftPlan({ protocols: SIX_MONDAYS, today: MON_7_SEP });
    const c = plan.combined as CombinedPlan;
    expect(c.method).toBe("greedy");
    expect(plan.current).toEqual([6, 0, 0, 0, 0, 0, 0]);
    // Five of the six move off Monday; the sixth staying is tie-break 4.
    expect(c.moves.map((m) => [m.protocolId, m.k])).toEqual([
      ["M0", 1],
      ["M1", 2],
      ["M2", 3],
      ["M3", 4],
      ["M4", 5],
    ]);
    expect(c.after).toEqual([1, 1, 1, 1, 1, 1, 0]);
    expect(c.score).toEqual({
      before: { peak: 6, sumsq: 144, collisions: 0 },
      after: { peak: 1, sumsq: 24, collisions: 0 },
    });
    for (const m of c.moves) {
      const p = SIX_MONDAYS.find((x) => x.id === m.protocolId) as ShiftProtocolInput;
      expect(rotationPreservesCount({ protocol: p, k: m.k, today: MON_7_SEP })).toBe(true);
    }
  });

  it("the greedy chain never emits more moves than the Apply-all boundary accepts", () => {
    // Fourteen Monday-only protocols took the greedy path and produced a
    // TWELVE-move plan, which `applyShiftPlan` refuses wholesale (1..10) before
    // attempting anything — an "Apply all 12 changes" button that could only
    // ever fail. The chain stops at the cap instead.
    const many = Array.from({ length: 14 }, (_, i) =>
      proto({
        id: `C${i}`,
        scheduleRule: weeklyRule(["MO"], [`${String(i + 6).padStart(2, "0")}:00`]),
        startDate: D(2026, 1, 5),
      }),
    );
    const c = computeShiftPlan({ protocols: many, today: MON_7_SEP }).combined as CombinedPlan;
    expect(c.method).toBe("greedy");
    expect(c.moves.length).toBe(MAX_PLAN_MOVES);
    expect(new Set(c.moves.map((m) => m.protocolId)).size).toBe(MAX_PLAN_MOVES);
  });

  it("never offers a move whose first dose falls past the Apply boundary's own start bound", () => {
    // `successorStartDate` is floored at the protocol's own start + 1, so a
    // protocol starting more than a fortnight out had every k pushed past the
    // today+14 bound `validateShiftMove` enforces on the RAW date — and the
    // Apply-all sheet has no date field to edit it down with, so the whole plan
    // was unappliable.
    const today = MON_7_SEP;
    const soon = proto({
      id: "SOON",
      scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]),
      startDate: D(2026, 1, 5),
    });
    const later = proto({
      id: "LATER",
      scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]),
      startDate: D(2026, 9, 21),
    });
    const plan = computeShiftPlan({ protocols: [soon, later], today });
    const maxKey = dayKey(addDays(today, SHIFT_MAX_START_DAYS));

    expect(plan.suggestions.some((sg) => sg.protocolId === "LATER")).toBe(false);
    for (const sg of plan.suggestions) expect(sg.startDate <= maxKey).toBe(true);
    for (const m of plan.combined?.moves ?? []) {
      expect(m.protocolId).not.toBe("LATER");
      expect(m.startDate <= maxKey).toBe(true);
    }
  });

  it("the greedy chain opens on the panel's first card, and ties the exhaustive search on the worked example", () => {
    // The chain's head is `bestSingleMoves`' head, which is what the panel
    // renders as `suggestions[0]` — one implementation, so the two views open
    // on the same move. Visible on the set that actually takes the chain.
    const greedy = computeShiftPlan({ protocols: SIX_MONDAYS, today: MON_7_SEP });
    const gc = greedy.combined as CombinedPlan;
    const head = greedy.suggestions[0];
    expect(gc.method).toBe("greedy");
    expect(gc.moves[0].protocolId).toBe(head.protocolId);
    expect(gc.moves[0].k).toBe(head.k);
    expect(oracleGreedy(SIX_MONDAYS, SIX_MONDAYS.map((p) => p.id), MON_7_SEP).steps[0]).toEqual([
      head.protocolId,
      head.k,
    ]);

    // The worked example has four candidates, so only the exhaustive path runs
    // there and the chain has to come from the oracle. The two paths reach the
    // SAME objective and both move P4; where they part is the tie-break —
    // the chain lands [P1 2, P2 4, P4 1] and the combined plan keeps the lexicographically
    // smaller [P2 2, P3 3, P4 4].
    const protocols = [P1, P2, P3, P4];
    const worked = computeShiftPlan({ protocols, today: FRI_4_SEP });
    const wc = worked.combined as CombinedPlan;
    const chain = oracleGreedy(protocols, ["P1", "P2", "P3", "P4"], FRI_4_SEP);
    expect(chain.steps[0]).toEqual([worked.suggestions[0].protocolId, worked.suggestions[0].k]);
    expect(chain.steps[0]).toEqual(["P4", 1]);
    expect(chain.steps.map(([id]) => id)).toContain("P4");
    expect(wc.moves.map((m) => m.protocolId)).toContain("P4");
    expect({ ...wc.score.after, moves: wc.moves.length }).toEqual(chain.score);
  });

  it.each(COMBINED_CASES)("%s — every move preserves its protocol's dose count", (_label, protocols, today) => {
    const c = computeShiftPlan({ protocols, today }).combined as CombinedPlan;
    expect(c.moves.length).toBeGreaterThan(0);
    for (const m of c.moves) {
      const p = protocols.find((x) => x.id === m.protocolId) as ShiftProtocolInput;
      expect(rotationPreservesCount({ protocol: p, k: m.k, today })).toBe(true);
      // Same statement re-derived from slotsInRange, the way the single-move
      // dose-count test does it — the engine's own basis is not the only witness.
      const horizonEnd = addDays(today, SHIFT_HORIZON_DAYS - 1);
      const end = courseEnd(p);
      const count = (rule: string) =>
        new Set(slotsInRange(parseSchedule(rule), today, horizonEnd, p.startDate, end).map((sl) => dayKey(sl.date))).size;
      expect(count(rotatedRule(p.scheduleRule as string, m.k))).toBe(count(p.scheduleRule as string));
    }
  });
});
