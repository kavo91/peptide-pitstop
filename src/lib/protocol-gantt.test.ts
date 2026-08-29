import { describe, expect, it } from "vitest";

import {
  ganttWindow,
  ganttRow,
  segmentPercents,
  dayCentrePercent,
  concurrencyByDay,
  weekTicks,
  type GanttProtocolInput,
  type GanttWindow,
} from "./protocol-gantt";

/**
 * Every date below is hand-derived on a calendar, not computed with the
 * functions under test. Weekday sanity: 2026-08-12 is a WEDNESDAY;
 * 2026-07-05 (the MOTS-c anchor shape) is a SUNDAY.
 */
const D = (iso: string) => new Date(`${iso}T00:00:00`);
const TODAY = D("2026-08-12"); // Wednesday

const base: GanttProtocolInput = {
  id: "p1",
  name: "Course",
  peptideName: "Peptide",
  status: "active",
  startDate: null,
  endDate: null,
  cycleAnchor: null,
  cycleOnWeeks: null,
  cycleOffWeeks: null,
};

const W = ganttWindow(TODAY);

describe("ganttWindow", () => {
  it("snaps to whole Sunday→Saturday weeks around today", () => {
    // today − (21 + weekday 3) = 24 days back → Sun 19 Jul.
    expect(W.start).toEqual(D("2026-07-19"));
    expect(W.start.getDay()).toBe(0);
    // today + 112 = Wed 2 Dec, snapped forward to Sat 5 Dec.
    expect(W.end).toEqual(D("2026-12-05"));
    expect(W.end.getDay()).toBe(6);
    // 19 Jul → 5 Dec inclusive = exactly 20 weeks.
    expect(W.days).toBe(140);
  });
});

describe("ganttRow — continuous (no cycle plan)", () => {
  it("renders one committed segment between its dates", () => {
    const row = ganttRow({ ...base, startDate: D("2026-08-01"), endDate: D("2026-09-15") }, W, TODAY)!;
    expect(row.segments).toEqual([{ from: D("2026-08-01"), to: D("2026-09-15"), kind: "on" }]);
    expect(row.openEnded).toBe(false);
    expect(row.onToday).toBe(true);
  });

  it("clips to the window and reports open-ended when there is no stop", () => {
    const row = ganttRow({ ...base, startDate: D("2026-06-01") }, W, TODAY)!;
    expect(row.segments).toEqual([{ from: D("2026-07-19"), to: D("2026-12-05"), kind: "on" }]);
    expect(row.openEnded).toBe(true);
  });

  it("drops a course that never intersects the window", () => {
    expect(ganttRow({ ...base, startDate: D("2026-01-01"), endDate: D("2026-02-01") }, W, TODAY)).toBeNull();
    expect(ganttRow({ ...base, startDate: D("2027-01-01") }, W, TODAY)).toBeNull();
  });

  it("keeps a future (scheduled) start inside the window", () => {
    const row = ganttRow({ ...base, startDate: D("2026-09-28"), endDate: D("2026-11-22") }, W, TODAY)!;
    expect(row.segments).toEqual([{ from: D("2026-09-28"), to: D("2026-11-22"), kind: "on" }]);
    expect(row.onToday).toBe(false);
  });
});

describe("ganttRow — repeating cycle (the MOTS-c 8-on/4-off shape)", () => {
  // Anchor Sun 5 Jul, 8 on / 4 off, endDate 29 Aug — which IS the block-1 end:
  // 5 Jul + 55 days = 29 Aug (inclusive of the anchor day). Off-block
  // 30 Aug → 26 Sep (28 days). Block 2 starts 27 Sep (anchor + 84) and would
  // run to 27 Sep + 55 = 21 Nov; its off-block runs into the window edge.
  const motsc: GanttProtocolInput = {
    ...base,
    id: "motsc",
    startDate: D("2026-07-05"),
    endDate: D("2026-08-29"),
    cycleAnchor: D("2026-07-05"),
    cycleOnWeeks: 8,
    cycleOffWeeks: 4,
  };

  it("emits on, off, then PROJECTED blocks past the committed end", () => {
    const row = ganttRow(motsc, W, TODAY)!;
    expect(row.segments).toEqual([
      { from: D("2026-07-19"), to: D("2026-08-29"), kind: "on" }, // clipped at window start
      { from: D("2026-08-30"), to: D("2026-09-26"), kind: "off" },
      { from: D("2026-09-27"), to: D("2026-11-21"), kind: "projected" },
      { from: D("2026-11-22"), to: D("2026-12-05"), kind: "off" }, // clipped at window end
    ]);
    expect(row.onToday).toBe(true); // 12 Aug is day 39 of the on-block
    expect(row.openEnded).toBe(false); // committed stop exists at 29 Aug
  });

  it("an endDate shortened below the block end turns the remainder into projection", () => {
    const row = ganttRow({ ...motsc, endDate: D("2026-08-20") }, W, TODAY)!;
    expect(row.segments[0]).toEqual({ from: D("2026-07-19"), to: D("2026-08-20"), kind: "on" });
    expect(row.segments[1]).toEqual({ from: D("2026-08-21"), to: D("2026-08-29"), kind: "projected" });
    expect(row.segments[2]).toEqual({ from: D("2026-08-30"), to: D("2026-09-26"), kind: "off" });
  });

  it("with no endDate at all the pattern is committed and open-ended", () => {
    const row = ganttRow({ ...motsc, endDate: null }, W, TODAY)!;
    expect(row.segments.map((s) => s.kind)).toEqual(["on", "off", "on", "off"]);
    expect(row.openEnded).toBe(true);
  });

  it("history before a moved anchor stays committed on", () => {
    // startNextCycle moves the anchor forward while startDate keeps history.
    const row = ganttRow(
      { ...motsc, startDate: D("2026-07-05"), cycleAnchor: D("2026-08-02"), endDate: null },
      W,
      TODAY,
    )!;
    // 19 Jul (window) → 1 Aug pre-anchor history, then the 2 Aug block runs
    // 8 weeks to 26 Sep — contiguous "on" merges into one segment.
    expect(row.segments[0]).toEqual({ from: D("2026-07-19"), to: D("2026-09-26"), kind: "on" });
    expect(row.segments[1]).toEqual({ from: D("2026-09-27"), to: D("2026-10-24"), kind: "off" });
  });
});

describe("ganttRow — terminal cycle (on-weeks, no break)", () => {
  it("stops at the block end even without an endDate", () => {
    // 10-day pulse style: 2 on-weeks from Sat 8 Aug → last day 21 Aug.
    const row = ganttRow(
      { ...base, startDate: D("2026-08-08"), cycleAnchor: D("2026-08-08"), cycleOnWeeks: 2 },
      W,
      TODAY,
    )!;
    expect(row.segments).toEqual([{ from: D("2026-08-08"), to: D("2026-08-21"), kind: "on" }]);
    expect(row.openEnded).toBe(false);
  });

  it("an earlier endDate wins over the block end", () => {
    const row = ganttRow(
      { ...base, startDate: D("2026-08-08"), cycleAnchor: D("2026-08-08"), cycleOnWeeks: 2, endDate: D("2026-08-15") },
      W,
      TODAY,
    )!;
    expect(row.segments).toEqual([{ from: D("2026-08-08"), to: D("2026-08-15"), kind: "on" }]);
  });
});

describe("ganttRow — status handling", () => {
  it("paused rows keep their shape but never read as dosing today", () => {
    const row = ganttRow({ ...base, status: "paused", startDate: D("2026-08-01") }, W, TODAY)!;
    expect(row.status).toBe("paused");
    expect(row.onToday).toBe(false);
  });

  it("a completed course with no endDate clips at today instead of running on", () => {
    const row = ganttRow({ ...base, status: "completed", startDate: D("2026-08-01") }, W, TODAY)!;
    expect(row.segments).toEqual([{ from: D("2026-08-01"), to: D("2026-08-12"), kind: "on" }]);
  });

  it("a completed repeating course does not project a restart", () => {
    const row = ganttRow(
      {
        ...base,
        status: "completed",
        startDate: D("2026-07-05"),
        cycleAnchor: D("2026-07-05"),
        cycleOnWeeks: 8,
        cycleOffWeeks: 4,
        endDate: D("2026-08-29"),
      },
      W,
      TODAY,
    )!;
    expect(row.segments).toEqual([{ from: D("2026-07-19"), to: D("2026-08-29"), kind: "on" }]);
  });
});

describe("geometry helpers", () => {
  it("segmentPercents spans the exact day fractions", () => {
    const win: GanttWindow = { start: D("2026-07-19"), end: D("2026-12-05"), days: 140 };
    const whole = segmentPercents(win, { from: win.start, to: win.end, kind: "on" });
    expect(whole).toEqual({ left: 0, width: 100 });
    const oneDay = segmentPercents(win, { from: D("2026-07-19"), to: D("2026-07-19"), kind: "on" });
    expect(oneDay.left).toBe(0);
    expect(oneDay.width).toBeCloseTo(100 / 140, 10);
  });

  it("dayCentrePercent puts today mid-cell", () => {
    // 19 Jul → 12 Aug is 24 days; centre of day 24 = 24.5 cells.
    expect(dayCentrePercent(W, TODAY)).toBeCloseTo((24.5 * 100) / 140, 10);
  });

  it("weekTicks lands on every Sunday of the window", () => {
    const ticks = weekTicks(W);
    expect(ticks).toHaveLength(20);
    expect(ticks[0]).toEqual(D("2026-07-19"));
    expect(ticks[19]).toEqual(D("2026-11-29"));
    expect(ticks.every((d) => d.getDay() === 0)).toBe(true);
  });
});

describe("concurrencyByDay", () => {
  it("counts committed AND projected exposure for active rows only", () => {
    const rows = [
      ganttRow({ ...base, id: "a", startDate: D("2026-08-01"), endDate: D("2026-08-31") }, W, TODAY)!,
      ganttRow(
        {
          ...base,
          id: "b",
          startDate: D("2026-07-05"),
          cycleAnchor: D("2026-07-05"),
          cycleOnWeeks: 8,
          cycleOffWeeks: 4,
          endDate: D("2026-08-29"),
        },
        W,
        TODAY,
      )!,
      ganttRow({ ...base, id: "c", status: "paused", startDate: D("2026-08-01") }, W, TODAY)!,
    ];
    const counts = concurrencyByDay(rows, W);
    const at = (iso: string) => counts[(D(iso).getTime() - W.start.getTime()) / 86_400_000];
    expect(at("2026-08-12")).toBe(2); // a + b on; c paused, never counted
    expect(at("2026-09-01")).toBe(0); // a ended 31 Aug, b in its off-block
    expect(at("2026-10-01")).toBe(1); // b's projected block 2 counts
  });
});
