/**
 * Regression: a traveller's dose must not delete the slot it belongs to.
 *
 * A dose was logged at 22:54 in America/Santiago on Friday 24 July 2026. That
 * instant is SATURDAY 12:54 in the container zone (Australia/Brisbane, +14 h).
 * The protocol is Mon–Fri, so
 * judging the dose off-grid by its raw instant made `reconstructRebasedSlots`
 * fire a fixed_anchor rebase that dropped the Friday slot and minted a phantom
 * rebased Saturday one — then the localDay matcher (which correctly reads
 * "2026-07-24") found nothing to attach to. The dose vanished from the protocol
 * while still appearing under "logged today".
 *
 * The two day bases must agree: both the on-grid test and the week bucket now
 * use the frozen localDay, matching the slot matcher.
 */
import { describe, it, expect } from "vitest";
import { resolveTitration } from "./resolve";
import type { ResolveInput } from "./types";

const d = (s: string) => new Date(s + "T00:00:00");

// Weekly MO–FR protocol, fixed_anchor.
const MON_FRI = JSON.stringify([
  { dayPattern: { kind: "weekly", byDays: ["MO", "TU", "WE", "TH", "FR"] }, times: ["21:00"] },
]);

// Dose rows (DoseLog.takenAt is an absolute instant; localDay is frozen on the device).
const DOSE_A = { id: "DOSE_A", takenAt: new Date("2026-07-24T05:03:46Z"), localDay: "2026-07-23" }; // Bne Fri 15:03 / SCL Thu tracking day
const DOSE_B = { id: "DOSE_B", takenAt: new Date("2026-07-25T02:54:48Z"), localDay: "2026-07-24" }; // Bne SAT 12:54 / SCL Fri 22:54

function input(over: Partial<ResolveInput> = {}): ResolveInput {
  return {
    doseBasis: "per_injection",
    steps: [],
    fallbackDose: "800",
    fallbackUnit: "mcg",
    scheduleRule: MON_FRI,
    rebaseMode: "fixed_anchor",
    startDate: d("2026-07-06"),
    endDate: null,
    injectionsPerWeek: 5,
    delivered: [DOSE_A, DOSE_B],
    skipped: [],
    range: { start: d("2026-07-19"), end: d("2026-07-26") },
    now: new Date("2026-07-25T03:00:00Z"), // Bne Sat 13:00
    adherenceWindowMin: 120,
    ...over,
  };
}

const dayOf = (dte: Date) => dte.getDate();

describe("traveller dose whose runtime-TZ instant lands off-grid", () => {
  it("keeps the Friday slot and marks it taken by the Chile-Friday dose", () => {
    const r = resolveTitration(input());
    const friday = r.slots.find((s) => dayOf(s.date) === 24);
    expect(friday, "Friday 24 July slot must still exist").toBeDefined();
    expect(friday!.status).toBe("taken");
    expect(friday!.matchedLogId).toBe("DOSE_B");
  });

  it("does not invent a phantom Saturday slot", () => {
    const r = resolveTitration(input());
    expect(r.slots.some((s) => dayOf(s.date) === 25)).toBe(false);
  });

  it("does not rebase at all — every dose is on-grid by its frozen day", () => {
    const r = resolveTitration(input());
    expect(r.slots.some((s) => s.rebased)).toBe(false);
  });

  it("still attaches the late-night dose to its own frozen (Thursday) day", () => {
    const r = resolveTitration(input());
    const thursday = r.slots.find((s) => dayOf(s.date) === 23);
    expect(thursday!.status).toBe("taken");
    expect(thursday!.matchedLogId).toBe("DOSE_A");
  });

  it("legacy rows without localDay keep the old instant-based behaviour", () => {
    // Same instant, no frozen day → Brisbane Saturday → genuinely off-grid → rebase fires.
    const legacy = { id: "LEGACY", takenAt: DOSE_B.takenAt };
    const r = resolveTitration(input({ delivered: [legacy] }));
    expect(r.slots.some((s) => s.rebased)).toBe(true);
  });
});
