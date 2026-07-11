import { describe, it, expect, vi, beforeEach } from "vitest";

// computeRebaseSuggestion reads the protocol through prisma — mock the DB
// module so the suggestion logic runs against the prod-shaped protocols below.
const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { protocol: { findFirst } } }));

import { parseSchedule, slotsOn, slotsInRange } from "./entries";
import { rebaseWeek } from "./rebase";
import { computeRebaseSuggestion } from "./rebase-suggest";

/**
 * Example scenario: interval every-3-days anchored at
 * startDate 2026-06-18 → due … Jul 6, Jul 9, Jul 12. The Thu Jul 9 dose was
 * missed and logged ad-hoc on Fri Jul 10.
 *
 * Contract pinned here:
 *  - The grid NEVER shifts silently — without a confirmed roll, following
 *    doses stay on the startDate anchor (Jul 12/15/18).
 *  - A `rolling` interval protocol gets a catch-up ROLL PROMPT for the
 *    off-grid dose; confirming appends a rule anchor (see interval-anchor.ts).
 *  - A `fixed_anchor` interval protocol stays rigid: no shift, no prompt.
 */
const EVERY_3D_RULE = JSON.stringify([{ dayPattern: { kind: "interval", everyDays: 3 }, times: [] }]);
const START = new Date("2026-06-18T00:00:00");
const local = (d: string) => new Date(d + "T00:00:00");

describe("interval schedule — missed dose taken the next day", () => {
  const schedule = parseSchedule(EVERY_3D_RULE);

  it("keeps the startDate grid: Thu Jul 9 due, Fri Jul 10 not due, Sun Jul 12 due", () => {
    expect(slotsOn(schedule, local("2026-07-09"), START)).toHaveLength(1);
    expect(slotsOn(schedule, local("2026-07-10"), START)).toHaveLength(0);
    expect(slotsOn(schedule, local("2026-07-12"), START)).toHaveLength(1);
  });

  it("never shifts silently: without a confirmed roll the following doses stay Jul 12/15/18", () => {
    const dates = slotsInRange(schedule, local("2026-07-10"), local("2026-07-20"), START).map((s) =>
      s.date.toDateString(),
    );
    expect(dates).toEqual([
      local("2026-07-12").toDateString(),
      local("2026-07-15").toDateString(),
      local("2026-07-18").toDateString(),
    ]);
  });

  it("rebaseWeek (the weekly shifter) still offers nothing for rolling mode or non-weekly frequencies", () => {
    const slip = {
      weekStart: local("2026-07-05"),
      actual: { plannedDate: local("2026-07-09"), actualDate: local("2026-07-10") },
      today: local("2026-07-10"),
    };
    expect(
      rebaseWeek({ ...slip, rebaseMode: "rolling", freq: "WEEKLY", plannedDays: ["TH", "SA"] }),
    ).toEqual([]);
    expect(
      rebaseWeek({ ...slip, rebaseMode: "fixed_anchor", freq: "DAILY", plannedDays: [] }),
    ).toEqual([]);
  });

  describe("computeRebaseSuggestion (the prompt logDose offers)", () => {
    beforeEach(() => {
      findFirst.mockReset();
    });

    const fridayCatchUp = {
      protocolId: "proto-1",
      userId: "u1",
      takenAt: local("2026-07-10"),
      matchedPlanned: false,
    };
    const intervalProto = (rebaseMode: string) => ({
      id: "proto-1",
      scheduleRule: EVERY_3D_RULE,
      rebaseMode,
      startDate: START,
      endDate: null,
    });

    it("offers a catch-up ROLL prompt for a rolling interval protocol ", async () => {
      findFirst.mockResolvedValue(intervalProto("rolling"));
      const s = await computeRebaseSuggestion(fridayCatchUp);
      expect(s).toMatchObject({
        kind: "interval",
        protocolId: "proto-1",
        intervalDays: 3,
        plannedDateISO: local("2026-07-09").toISOString(),
        actualDateISO: local("2026-07-10").toISOString(),
      });
      expect(s?.nextDatesISO).toEqual([
        local("2026-07-13").toISOString(),
        local("2026-07-16").toISOString(),
      ]);
      expect(s?.suggestedDays).toEqual([]);
    });

    it("offers no prompt for a fixed_anchor interval protocol (rigid grid by choice)", async () => {
      findFirst.mockResolvedValue(intervalProto("fixed_anchor"));
      await expect(computeRebaseSuggestion(fridayCatchUp)).resolves.toBeUndefined();
    });

    it("offers no prompt when the dose lands on a grid day", async () => {
      findFirst.mockResolvedValue(intervalProto("rolling"));
      await expect(
        computeRebaseSuggestion({ ...fridayCatchUp, takenAt: local("2026-07-12") }),
      ).resolves.toBeUndefined();
    });

    it("offers no prompt when the roll's next dose would land past the end date", async () => {
      findFirst.mockResolvedValue({ ...intervalProto("rolling"), endDate: local("2026-07-11") });
      await expect(computeRebaseSuggestion(fridayCatchUp)).resolves.toBeUndefined();
    });

    it("control: a weekly fixed_anchor protocol still gets its within-week shift prompt", async () => {
      const weeklyRule = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "FR"] }, times: [] }]);
      findFirst.mockResolvedValue({
        id: "w1",
        scheduleRule: weeklyRule,
        rebaseMode: "fixed_anchor",
        startDate: null,
        endDate: null,
      });
      const suggestion = await computeRebaseSuggestion({
        protocolId: "w1",
        userId: "u1",
        takenAt: local("2026-07-07"),
        matchedPlanned: false,
      });
      expect(suggestion).toBeDefined();
      expect(suggestion?.kind ?? "weekly").toBe("weekly");
      expect(suggestion?.suggestedDays).toEqual(["SA"]);
    });
  });
});
