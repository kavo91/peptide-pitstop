import { describe, it, expect } from "vitest";
import { parseSchedule, slotsOn, slotsInRange } from "./entries";
import { appendIntervalAnchor } from "./interval-anchor";

/**
 * Catch-up rolling for interval schedules (example scenario): every-3-days
 * anchored at startDate 2026-06-18 → … Jul 6, Jul 9, Jul 12. Thu Jul 9 missed,
 * taken Fri Jul 10; the user confirms the roll prompt → an anchor "2026-07-10" is
 * appended INSIDE the rule. Grid semantics are piecewise: days before an
 * anchor use the previous segment's grid, days on/after use the anchor's —
 * so history stays exact across any number of rolls.
 */
const EVERY_3D_RULE = JSON.stringify([{ dayPattern: { kind: "interval", everyDays: 3 }, times: [] }]);
const START = new Date("2026-06-18T00:00:00");
const local = (d: string) => new Date(d + "T00:00:00");
const dueOn = (rule: string, d: string) => slotsOn(parseSchedule(rule), local(d), START).length > 0;

describe("appendIntervalAnchor", () => {
  it("appends a roll anchor into the interval entry and returns the rewritten rule", () => {
    const rolled = appendIntervalAnchor(EVERY_3D_RULE, local("2026-07-10"));
    expect(rolled).not.toBeNull();
    const entry = parseSchedule(rolled!)[0];
    expect(entry.dayPattern).toEqual({ kind: "interval", everyDays: 3, anchors: ["2026-07-10"] });
  });

  it("is idempotent for the same day and append-only for later rolls", () => {
    const once = appendIntervalAnchor(EVERY_3D_RULE, local("2026-07-10"))!;
    expect(appendIntervalAnchor(once, local("2026-07-10"))).toBe(once);
    const twice = appendIntervalAnchor(once, local("2026-07-21"))!;
    expect((parseSchedule(twice)[0].dayPattern as { anchors?: string[] }).anchors).toEqual([
      "2026-07-10",
      "2026-07-21",
    ]);
  });

  it("returns null for rules without an interval entry", () => {
    const weekly = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO"] }, times: [] }]);
    expect(appendIntervalAnchor(weekly, local("2026-07-10"))).toBeNull();
    expect(appendIntervalAnchor("not-json", local("2026-07-10"))).toBeNull();
    expect(appendIntervalAnchor(null, local("2026-07-10"))).toBeNull();
  });
});

describe("interval grid with roll anchors", () => {
  const ROLLED = appendIntervalAnchor(EVERY_3D_RULE, local("2026-07-10"))!;

  it("rolls the future: Jul 10/13/16 due, old-grid Jul 12 no longer due", () => {
    expect(dueOn(ROLLED, "2026-07-10")).toBe(true);
    expect(dueOn(ROLLED, "2026-07-12")).toBe(false);
    expect(dueOn(ROLLED, "2026-07-13")).toBe(true);
    expect(dueOn(ROLLED, "2026-07-16")).toBe(true);
  });

  it("preserves the past exactly: pre-roll days keep the startDate grid", () => {
    expect(dueOn(ROLLED, "2026-07-06")).toBe(true);
    expect(dueOn(ROLLED, "2026-07-09")).toBe(true); // the missed Thursday
    expect(dueOn(ROLLED, "2026-07-07")).toBe(false);
  });

  it("keeps every segment exact across a second roll", () => {
    // Anchor-1 grid: 10, 13, 16, 19. Slip again: Jul 19 missed, taken Jul 21.
    const twice = appendIntervalAnchor(ROLLED, local("2026-07-21"))!;
    expect(dueOn(twice, "2026-07-09")).toBe(true); // segment 0 (startDate grid)
    expect(dueOn(twice, "2026-07-19")).toBe(true); // segment 1 (Jul 10 anchor)
    expect(dueOn(twice, "2026-07-22")).toBe(false); // old segment-1 projection gone
    expect(dueOn(twice, "2026-07-21")).toBe(true); // segment 2 (Jul 21 anchor)
    expect(dueOn(twice, "2026-07-24")).toBe(true);
  });

  it("slotsInRange projects the rolled cadence forward", () => {
    const dates = slotsInRange(parseSchedule(ROLLED), local("2026-07-11"), local("2026-07-20"), START).map(
      (s) => s.date.toDateString(),
    );
    expect(dates).toEqual([
      local("2026-07-13").toDateString(),
      local("2026-07-16").toDateString(),
      local("2026-07-19").toDateString(),
    ]);
  });

  it("ignores anchors before startDate and never marks pre-start days due", () => {
    const bad = appendIntervalAnchor(EVERY_3D_RULE, local("2026-06-01"))!;
    expect(dueOn(bad, "2026-06-01")).toBe(false); // before the window
    expect(dueOn(bad, "2026-06-18")).toBe(true); // startDate grid unaffected
    expect(dueOn(bad, "2026-06-21")).toBe(true);
  });
});
