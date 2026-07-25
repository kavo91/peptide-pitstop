/**
 * Regression: a fixed_anchor rebase must not steal a grid day that already has
 * its own delivered dose.
 *
 * A five-day weekly grid (Sun/Mon/Tue/Thu/Fri) dosed on all five grid days PLUS
 * one extra off-grid Wednesday. The Wednesday dose picked Tuesday as its
 * "satisfied" anchor — the nearest grid day — even though Tuesday had already
 * been dosed. `droppedKeys` then removed Tuesday and every grid day after it, so
 * the Tuesday and Thursday doses lost their slots and a phantom Saturday appeared.
 *
 * An anchor must be a grid day that is still UNSATISFIED. When every grid day is
 * already dosed there is nothing to re-anchor onto, so the week keeps its plain
 * grid and the extra dose renders as off-schedule — the honest reading: five
 * scheduled doses taken, one unscheduled extra.
 */
import { describe, it, expect } from "vitest";
import { resolveTitration } from "./resolve";
import type { ResolveInput } from "./types";

const d = (s: string) => new Date(s + "T00:00:00");
const at = (iso: string, localDay: string, id: string) => ({ id, takenAt: new Date(iso), localDay });

const SUN_MON_TUE_THU_FRI = JSON.stringify([
  { dayPattern: { kind: "weekly", byDays: ["MO", "TU", "TH", "FR", "SU"] }, times: ["20:00"] },
]);

const DOSES = [
  at("2027-03-07T10:00:00Z", "2027-03-07", "dose-sun"),
  at("2027-03-08T10:00:00Z", "2027-03-08", "dose-mon"),
  at("2027-03-09T10:00:00Z", "2027-03-09", "dose-tue"), // lost its slot
  at("2027-03-10T10:00:00Z", "2027-03-10", "dose-wed"), // off-grid extra, the trigger
  at("2027-03-11T10:00:00Z", "2027-03-11", "dose-thu"), // lost its slot
  at("2027-03-12T10:00:00Z", "2027-03-12", "dose-fri"),
];

function input(over: Partial<ResolveInput> = {}): ResolveInput {
  return {
    doseBasis: "per_injection", steps: [], fallbackDose: "2", fallbackUnit: "mg",
    scheduleRule: SUN_MON_TUE_THU_FRI, rebaseMode: "fixed_anchor",
    startDate: d("2027-03-01"), endDate: null, injectionsPerWeek: 5,
    delivered: DOSES, skipped: [],
    range: { start: d("2027-03-07"), end: d("2027-03-14") },
    now: new Date("2027-03-13T09:45:00Z"), adherenceWindowMin: 120,
    ...over,
  };
}

const day = (dte: Date) => dte.getDate();

describe("fixed_anchor rebase anchor selection", () => {
  it("keeps the Tuesday slot, taken by the Tuesday dose", () => {
    const tue = resolveTitration(input()).slots.find((s) => day(s.date) === 9);
    expect(tue, "Tuesday slot must exist").toBeDefined();
    expect(tue!.status).toBe("taken");
    expect(tue!.matchedLogId).toBe("dose-tue");
  });

  it("keeps the Thursday slot, taken by the Thursday dose", () => {
    const thu = resolveTitration(input()).slots.find((s) => day(s.date) === 11);
    expect(thu!.status).toBe("taken");
    expect(thu!.matchedLogId).toBe("dose-thu");
  });

  it("renders the plain grid — no rebase, no phantom Saturday", () => {
    const slots = resolveTitration(input()).slots;
    // 14th is the next week's Sunday grid day, still inside the queried range.
    expect(slots.map((s) => day(s.date))).toEqual([7, 8, 9, 11, 12, 14]);
    expect(slots.some((s) => s.rebased)).toBe(false);
  });

  it("the extra Wednesday dose is off-schedule, not occupying a grid slot", () => {
    expect(resolveTitration(input()).slots.some((s) => s.matchedLogId === "dose-wed")).toBe(false);
  });

  it("still rebases when the nearest grid day is genuinely unsatisfied", () => {
    // Only the off-grid Wednesday dose exists — Tuesday is free, so it anchors there.
    const slots = resolveTitration(input({ delivered: [DOSES[3]] })).slots;
    expect(slots.some((s) => s.rebased)).toBe(true);
    expect(slots.find((s) => s.matchedLogId === "dose-wed")).toBeDefined();
  });
});
