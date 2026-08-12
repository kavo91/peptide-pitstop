/**
 * Regression: a fixed_anchor rebase must not steal a grid day that already has
 * its own delivered dose.
 *
 * Real prod case (GHK-Cu, week of 19–25 Jul 2026). Grid is MO/TU/TH/FR/SU and
 * The user dosed on all five grid days PLUS an extra off-grid Wednesday. The
 * Wednesday dose picked Tuesday as its "satisfied" anchor — nearest grid day —
 * even though Tuesday had already been dosed. `droppedKeys` then removed Tuesday
 * and every grid day after it, so the Tuesday and Thursday doses lost their slots
 * and a phantom Saturday appeared.
 *
 * An anchor must be a grid day that is still UNSATISFIED. When every grid day is
 * already dosed there is nothing to re-anchor onto, so the week keeps its plain
 * grid and the genuinely extra dose renders as off-schedule — which is the honest
 * reading: five scheduled doses taken, one unscheduled extra.
 */
import { describe, it, expect } from "vitest";
import { resolveTitration } from "./resolve";
import type { ResolveInput } from "./types";

const d = (s: string) => new Date(s + "T00:00:00");

const MO_TU_TH_FR_SU = JSON.stringify([
  { dayPattern: { kind: "weekly", byDays: ["MO", "TU", "TH", "FR", "SU"] }, times: ["20:00"] },
]);

// Representative rows from a real GHK-Cu protocol.
const DOSES = [
  { id: "sun19", takenAt: new Date(1784453783658), localDay: "2026-07-19" },
  { id: "mon20", takenAt: new Date(1784543909575), localDay: "2026-07-20" },
  { id: "tue21", takenAt: new Date(1784627590395), localDay: "2026-07-21" }, // lost its slot
  { id: "wed22", takenAt: new Date(1784715894982), localDay: "2026-07-22" }, // off-grid trigger
  { id: "thu23", takenAt: new Date(1784805650363), localDay: "2026-07-23" }, // lost its slot
  { id: "fri24", takenAt: new Date(1784904991344), localDay: "2026-07-24" },
];

function input(over: Partial<ResolveInput> = {}): ResolveInput {
  return {
    doseBasis: "per_injection", steps: [], fallbackDose: "2", fallbackUnit: "mg",
    scheduleRule: MO_TU_TH_FR_SU, rebaseMode: "fixed_anchor",
    startDate: new Date(1782259200000), endDate: null, injectionsPerWeek: 5,
    delivered: DOSES, skipped: [],
    range: { start: d("2026-07-19"), end: d("2026-07-26") },
    now: new Date("2026-07-25T09:45:00Z"), adherenceWindowMin: 120,
    ...over,
  };
}

const day = (dte: Date) => dte.getDate();

describe("fixed_anchor rebase anchor selection", () => {
  it("keeps the Tuesday slot, taken by the Tuesday dose", () => {
    const slots = resolveTitration(input()).slots;
    const tue = slots.find((s) => day(s.date) === 21);
    expect(tue, "Tuesday 21 slot must exist").toBeDefined();
    expect(tue!.status).toBe("taken");
    expect(tue!.matchedLogId).toBe("tue21");
  });

  it("keeps the Thursday slot, taken by the Thursday dose", () => {
    const thu = resolveTitration(input()).slots.find((s) => day(s.date) === 23);
    expect(thu!.status).toBe("taken");
    expect(thu!.matchedLogId).toBe("thu23");
  });

  it("renders the plain grid — no rebase, no phantom Saturday", () => {
    const slots = resolveTitration(input()).slots;
    // 26th is the next week's Sunday grid day, still inside the queried range.
    expect(slots.map((s) => day(s.date))).toEqual([19, 20, 21, 23, 24, 26]);
    expect(slots.some((s) => s.rebased)).toBe(false);
  });

  it("the extra Wednesday dose is off-schedule, not occupying a grid slot", () => {
    const slots = resolveTitration(input()).slots;
    expect(slots.some((s) => s.matchedLogId === "wed22")).toBe(false);
  });

  it("still rebases when the nearest grid day is genuinely unsatisfied", () => {
    // Only the off-grid Wednesday dose exists — Tuesday is free, so it anchors there.
    const slots = resolveTitration(input({ delivered: [DOSES[3]] })).slots;
    expect(slots.some((s) => s.rebased)).toBe(true);
    expect(slots.find((s) => s.matchedLogId === "wed22")).toBeDefined();
  });
});
