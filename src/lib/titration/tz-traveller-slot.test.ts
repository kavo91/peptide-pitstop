/**
 * Regression: a dose logged while travelling must not delete the slot it belongs to.
 *
 * The runtime zone here is Australia/Brisbane (UTC+10, pinned in vitest.config).
 * A dose logged at 22:54 on Friday from a device 14 h behind (UTC−4) has an
 * instant that falls on SATURDAY 12:54 in the runtime zone. On a Mon–Fri grid the
 * Saturday reading looked off-grid, so a fixed_anchor rebase fired and dropped
 * every grid day from Friday onward — deleting the very slot the dose should have
 * filled — then minted a phantom rebased Saturday that the localDay matcher could
 * never match. The dose vanished from the protocol while still counting as logged.
 *
 * Both day bases must agree: the on-grid test and the week bucket now use the
 * frozen tracking day, the same basis the slot matcher already used.
 */
import { describe, it, expect } from "vitest";
import { resolveTitration } from "./resolve";
import type { ResolveInput } from "./types";

const d = (s: string) => new Date(s + "T00:00:00");

const MON_FRI = JSON.stringify([
  { dayPattern: { kind: "weekly", byDays: ["MO", "TU", "WE", "TH", "FR"] }, times: ["21:00"] },
]);

// Thu 2027-03-11 01:03 at UTC−4 → 15:03 Thu in the runtime zone: same day, on grid.
const LATE_NIGHT = { id: "dose-thu", takenAt: new Date("2027-03-11T05:03:00Z"), localDay: "2027-03-11" };
// Fri 2027-03-12 22:54 at UTC−4 → 12:54 SATURDAY in the runtime zone: off grid by instant.
const FRI_EVENING = { id: "dose-fri", takenAt: new Date("2027-03-13T02:54:00Z"), localDay: "2027-03-12" };

function input(over: Partial<ResolveInput> = {}): ResolveInput {
  return {
    doseBasis: "per_injection", steps: [], fallbackDose: "800", fallbackUnit: "mcg",
    scheduleRule: MON_FRI, rebaseMode: "fixed_anchor",
    startDate: d("2027-03-01"), endDate: null, injectionsPerWeek: 5,
    delivered: [LATE_NIGHT, FRI_EVENING], skipped: [],
    range: { start: d("2027-03-07"), end: d("2027-03-14") },
    now: new Date("2027-03-13T03:00:00Z"),
    adherenceWindowMin: 120,
    ...over,
  };
}

const day = (dte: Date) => dte.getDate();

describe("dose whose runtime-TZ instant lands off-grid", () => {
  it("keeps the Friday slot and marks it taken by the Friday-evening dose", () => {
    const fri = resolveTitration(input()).slots.find((s) => day(s.date) === 12);
    expect(fri, "Friday slot must still exist").toBeDefined();
    expect(fri!.status).toBe("taken");
    expect(fri!.matchedLogId).toBe("dose-fri");
  });

  it("does not invent a phantom Saturday slot", () => {
    expect(resolveTitration(input()).slots.some((s) => day(s.date) === 13)).toBe(false);
  });

  it("does not rebase — every dose is on-grid by its frozen day", () => {
    expect(resolveTitration(input()).slots.some((s) => s.rebased)).toBe(false);
  });

  it("attaches the late-night dose to its own frozen day", () => {
    const thu = resolveTitration(input()).slots.find((s) => day(s.date) === 11);
    expect(thu!.status).toBe("taken");
    expect(thu!.matchedLogId).toBe("dose-thu");
  });

  it("legacy rows without localDay keep the instant-based behaviour", () => {
    const legacy = { id: "legacy", takenAt: FRI_EVENING.takenAt };
    expect(resolveTitration(input({ delivered: [legacy] })).slots.some((s) => s.rebased)).toBe(true);
  });
});
